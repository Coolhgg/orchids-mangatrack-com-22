import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS } from '@/lib/prisma';
import { logActivity } from '@/lib/gamification/activity';
import { XP_PER_CHAPTER, calculateLevel, addXp } from '@/lib/gamification/xp';
import { calculateNewStreak, calculateStreakBonus } from '@/lib/gamification/streaks';
import { checkAchievements, UnlockedAchievement } from '@/lib/gamification/achievements';
import { calculateSeasonXpUpdate } from '@/lib/gamification/seasons';
import { validateReadTimeFromTimestamp, checkAndRecordPatternRepetition } from '@/lib/gamification/read-time-validation';
import { recordReadTelemetryAsync } from '@/lib/gamification/read-telemetry';
import { validateUUID, handleApiError, ApiError, validateOrigin, ErrorCodes, validateContentType, validateJsonSize } from '@/lib/api-utils';
import { z } from 'zod';
import { redisApi, REDIS_KEY_PREFIX } from '@/lib/redis';
import { Prisma } from '@prisma/client';
import { recordActivity as recordActivityEvent } from '@/lib/analytics/record';
import { antiAbuse } from '@/lib/anti-abuse';
import { logger } from '@/lib/logger';
import { notificationQueue } from '@/lib/queues';

const progressSchema = z.object({
  chapterNumber: z.number().min(0).max(100000).finite().nullable().optional(),
  chapterSlug: z.string().nullable().optional(),
  sourceId: z.string().uuid().optional(),
  isRead: z.boolean().optional().default(true),
  timestamp: z.string().datetime().optional(),
  deviceId: z.string().max(100).optional(),
  readingTimeSeconds: z.number().min(0).max(86400).optional(), // Optional explicit read time (max 24 hours)
});

/**
 * PATCH /api/library/[id]/progress
 * 
 * XP & READ-PROGRESS INTEGRITY RULES (LOCKED):
 * 
 * 1. XP_PER_CHAPTER = 1 (no multipliers for bulk)
 * 2. When marking chapter N as read, ALL chapters 1→N are marked as read (single transaction)
 * 3. XP is awarded ONLY ONCE per request, ONLY if chapterNumber > currentLastReadChapter
 * 4. Anti-abuse: jumping 1→500 gives XP=1, re-marking gives XP=0
 * 5. Transaction safety: progress + XP are atomic
 * 6. SEASONAL XP: XP gains update BOTH lifetime xp AND season_xp atomically
 * 
 * READ-TIME VALIDATION (SOFT - NEVER BLOCKS):
 * - Only validates INCREMENTAL reads (1-2 chapter jumps)
 * - SKIPS validation for bulk jumps (>2 chapters) - migrations/binge readers trusted
 * - SKIPS validation for first progress (currentLastRead = 0)
 * - Does NOT block marking as read
 * - Only affects trust_score if suspicious
 * - NO XP removal ever
 * 
 * BULK PROGRESS IS TRUSTED:
 * - Migration imports (0→98): XP=1, no flag, no validation
 * - Bulk mark as read (0→50): XP=1, no flag, no validation
 * - Binge reading (1→2→3→...→50): XP=1 per request, validated only for 1-2 chapter jumps
 * 
 * READ TELEMETRY (ANALYTICS - NEVER BLOCKS):
 * - Records read events for analytics and anti-cheat refinement
 * - INSERT ONLY, NEVER MUTATED
 * - Fire-and-forget (async, non-blocking)
 */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Validate origin
    validateOrigin(request);
    
    // Validate content type
    validateContentType(request);
    
    // Validate request size (prevent oversized payloads)
    await validateJsonSize(request.clone(), 1024); // 1KB max

    const params = await context.params;
    const entryId = params.id;

    // Validate entry ID is a valid UUID
    validateUUID(entryId);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const validated = progressSchema.parse(body);
    const { chapterNumber, chapterSlug, isRead, timestamp, sourceId, deviceId, readingTimeSeconds } = validated;

    // Parse timestamp with fallback - enforce UTC
    const targetTimestamp = timestamp ? new Date(timestamp) : new Date();

    // Run entire operation within a transaction (H1 FIX: ownership check inside transaction)
    const result = await prisma.$transaction(async (tx) => {
      // H1 FIX: Move entry validation INSIDE transaction to prevent TOCTOU race condition
      // QA FIX: Add SELECT FOR UPDATE via raw query to prevent concurrent XP double-grant
      const [entry] = await tx.$queryRaw<Array<{
        id: string;
        user_id: string;
        series_id: string | null;
        last_read_chapter: string | null;
        last_read_at: Date | null;
        deleted_at: Date | null;
      }>>`
        SELECT id, user_id, series_id, last_read_chapter, last_read_at, deleted_at
        FROM library_entries
        WHERE id = ${entryId}::uuid
        FOR UPDATE
      `;
      
      // Fetch series data separately (not locked)
      const seriesData = entry?.series_id ? await tx.series.findUnique({
        where: { id: entry.series_id },
        include: { sources: true }
      }) : null;

      if (!entry) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }
      
      // H1 FIX: Ownership check inside transaction
      if (entry.user_id !== user.id) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }

      // M5 FIX: Check soft delete status
      if (entry.deleted_at !== null) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }

      // Get fresh user profile inside transaction
      const userProfile = await tx.user.findUnique({
        where: { id: user.id },
        select: {
          xp: true,
          level: true,
          streak_days: true,
          last_read_at: true,
          longest_streak: true,
          chapters_read: true,
          current_season: true,
          season_xp: true,
          deleted_at: true,
        }
      });

      if (!userProfile || userProfile.deleted_at !== null) {
        throw new ApiError('User not found', 401, ErrorCodes.UNAUTHORIZED);
      }

      // Get current last_read_chapter for comparison
      const currentLastRead = Number(entry.last_read_chapter) || 0;
      
      // Determine target chapter number
      let targetChapter: number;
      if (chapterNumber !== undefined && chapterNumber !== null) {
        targetChapter = chapterNumber;
      } else if (chapterSlug) {
        // Look up chapter by slug if series is known
        if (entry.series_id) {
          const chapterBySlug = await tx.chapter.findFirst({
            where: {
              series_id: entry.series_id,
              chapter_slug: chapterSlug,
            },
            select: { chapter_number: true },
          });
          targetChapter = chapterBySlug ? parseFloat(chapterBySlug.chapter_number) : currentLastRead;
        } else {
          targetChapter = currentLastRead;
        }
      } else {
        targetChapter = currentLastRead;
      }

      // Determine if this is actually new progress
      const isNewProgress = targetChapter > currentLastRead;
      
      // Check if target chapter was already read
      let alreadyReadTarget = false;
      let targetLogicalChapter: { id: string; page_count: number | null } | null = null;
      
      if (entry.series_id) {
        targetLogicalChapter = await tx.chapter.findFirst({
          where: {
            series_id: entry.series_id,
            chapter_number: String(targetChapter),
          },
          select: { id: true, page_count: true },
        });
        
        if (targetLogicalChapter) {
          const existingRead = await tx.userChapterReadV2.findUnique({
            where: {
              user_id_chapter_id: {
                user_id: user.id,
                chapter_id: targetLogicalChapter.id,
              },
            },
          });
          alreadyReadTarget = existingRead?.is_read ?? false;
        }
      }

      // Get page count for read-time validation
      const targetChapterPageCount = targetLogicalChapter?.page_count ?? null;

        // ============================================================
        // READ-TIME VALIDATION (SOFT - NEVER BLOCKS)
        // ============================================================
        // ONLY validates incremental reads (1-2 chapters at a time)
        // SKIPS bulk progress (>2 chapters) - migrations/binge readers trusted
        // SKIPS first progress (currentLastRead = 0)
        // Does NOT block marking as read
        // Only affects trust_score if suspicious
        // ============================================================
        let readTimeValidation = null;
        const chapterJump = targetChapter - currentLastRead;
        const shouldValidateReadTime = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
        
        if (isRead && isNewProgress && targetLogicalChapter && shouldValidateReadTime) {
          // Use explicit reading time if provided, otherwise estimate from timestamps
          if (readingTimeSeconds !== undefined) {
            const { validateReadTime } = await import('@/lib/gamification/read-time-validation');
            readTimeValidation = await validateReadTime(
              user.id,
              targetLogicalChapter.id,
              readingTimeSeconds,
              targetChapterPageCount
            );
          } else {
            // Validate based on time since last read
            readTimeValidation = await validateReadTimeFromTimestamp(
              user.id,
              targetLogicalChapter.id,
              targetChapterPageCount
            );
          }
          
            // Log suspicious reads for monitoring (but don't block)
              if (readTimeValidation.isSuspicious) {
                logger.warn(`Suspicious read detected`, {
                  userId: user.id,
                  expectedMinSeconds: readTimeValidation.expectedMinSeconds,
                  actualSeconds: readTimeValidation.actualSeconds,
                  reason: readTimeValidation.reason
                });
              }
            }

          // ============================================================
          // PATTERN REPETITION DETECTION (ANTI-BOT HEURISTIC)
          // ============================================================
          // Detects suspiciously regular intervals between reads (bot-like behavior)
          // Affects trust_score ONLY, NEVER blocks XP or reading
          // ============================================================
          if (isRead && isNewProgress && targetLogicalChapter) {
              const patternCheck = await checkAndRecordPatternRepetition(user.id, targetLogicalChapter.id);
              if (patternCheck.detected) {
                logger.warn(`Pattern repetition detected`, {
                  userId: user.id,
                  trustScoreAffected: patternCheck.trustScoreAffected
                });
              }
            }

          // ============================================================
          // READ TELEMETRY (ANALYTICS - NEVER BLOCKS)
          // ============================================================
          // Records all read events for analytics and anti-cheat refinement
          // INSERT ONLY - data is never mutated
          // Fire-and-forget: async, non-blocking, errors don't affect response
          // ============================================================
          if (isRead && entry.series_id) {
            const actualReadTime = readingTimeSeconds ?? 
              (readTimeValidation?.actualSeconds) ?? 
              (targetChapterPageCount ? targetChapterPageCount * 8 : 144); // Default estimate
            
            recordReadTelemetryAsync({
              userId: user.id,
              seriesId: entry.series_id,
              chapterNumber: Math.floor(targetChapter),
              readDurationSeconds: actualReadTime,
              pageCount: targetChapterPageCount,
              deviceId: deviceId ?? null,
            });
          }

        // ============================================================
        // XP AWARD DECISION (CRITICAL - SINGLE XP ONLY)
        // ============================================================
        // XP is awarded:
        //   - ONLY ONCE per request (XP_PER_CHAPTER = 1)
        //   - ONLY if isRead=true AND isNewProgress=true AND !alreadyReadTarget
        //
        // ANTI-ABUSE:
        //   - Jumping 1→500: XP = 1 (not 500)
        //   - Re-marking chapter 50: XP = 0
        //   - Repeated PATCH on same chapter: XP = 0
        //   - Bot patterns detected: XP = 0 (progress still saved)
        //   - XP rate limit exceeded: XP = 0 (progress still saved)
        //   - Suspicious read time: XP is STILL awarded (trust_score affected instead)
        // ============================================================
        
        // Calculate streak (applies regardless of XP)
        const newStreak = calculateNewStreak(userProfile.streak_days, userProfile.last_read_at);
        const streakBonus = calculateStreakBonus(newStreak);
        
        // Bot detection (soft block XP only)
        const botCheck = await antiAbuse.detectProgressBotPatterns(
          user.id,
          entryId,
          chapterNumber,
          currentLastRead
        );
        
        // XP rate limit guard (5 XP grants per minute)
        const xpAllowed = await antiAbuse.canGrantXp(user.id);
        
        // XP awarded ONLY ONCE if progressing forward to a new chapter AND no abuse detected
        // NOTE: Suspicious read time does NOT block XP (only affects trust_score)
        const shouldAwardXp = isRead && isNewProgress && !alreadyReadTarget && !botCheck.isBot && xpAllowed;
        // LOCKED: XP = 1 per progress action, NO BULK MULTIPLIERS
        const baseXpGained = shouldAwardXp ? (XP_PER_CHAPTER + streakBonus) : 0;

      // 3. Update Library Entry (BUG 46: Monotonic constraint)
      // Only update last_read_chapter if it's newer and we are marking as READ
      const updatedEntry = await tx.libraryEntry.update({
        where: { id: entryId, user_id: user.id },
        data: {
          last_read_chapter: (isRead && isNewProgress) ? chapterNumber : entry.last_read_chapter,
          last_read_at: (isRead && isNewProgress) ? targetTimestamp : entry.last_read_at,
          updated_at: new Date(),
        },
      });

      // 4. Update User Profile (XP, Level, Streak, Season XP)
      const newXp = addXp(userProfile.xp || 0, baseXpGained);
      const newLevel = calculateLevel(newXp);
      const longestStreak = Math.max(userProfile.longest_streak || 0, newStreak);
      
      // SEASONAL XP: Calculate season XP update with automatic rollover
      const seasonUpdate = calculateSeasonXpUpdate(
        userProfile.season_xp,
        userProfile.current_season,
        baseXpGained
      );

      await tx.user.update({
        where: { id: user.id },
        data: {
          xp: newXp,
          level: newLevel,
          streak_days: newStreak,
          longest_streak: longestStreak,
          last_read_at: isRead ? targetTimestamp : userProfile.last_read_at,
          // Only increment chapters_read count if XP was awarded (prevents gaming)
          chapters_read: { increment: shouldAwardXp ? 1 : 0 },
          // SEASONAL XP: Update season_xp and current_season atomically
          season_xp: seasonUpdate.season_xp,
          current_season: seasonUpdate.current_season,
        },
      });

      // 5. Log Activity (Only if new XP awarded)
      if (shouldAwardXp) {
try {
              await logActivity(tx, user.id, 'chapter_read', {
                seriesId: entry.series_id ?? undefined,
                metadata: { 
                  chapter_number: chapterNumber,
                  xp_gained: baseXpGained,
                  streak: newStreak
                },
              });
          } catch (activityError) {
            logger.error('Failed to log activity', { error: activityError instanceof Error ? activityError.message : String(activityError) });
          }
      }

      // ============================================================
      // BULK MARK ALL CHAPTERS 1→N AS READ (READ PROGRESSION RULE)
      // ============================================================
      // When user marks chapter N as read:
      //   - ALL chapters 1 through N must be marked as read
      //   - This happens in the SAME transaction (atomic)
      //   - XP is NOT multiplied (already awarded once above)
      // ============================================================
      
        if (isRead && chapterNumber !== undefined && chapterNumber !== null && chapterNumber > 0) {
          const MAX_CHAPTERS_PER_BULK = 2000;
          
          const allPrecedingLogicalChapters = await tx.$queryRaw<{id: string, chapter_number: string}[]>`
              SELECT id, chapter_number
              FROM chapters
              WHERE series_id = ${entry.series_id || ""}::uuid
                AND CAST(chapter_number AS DECIMAL) > 0
                AND CAST(chapter_number AS DECIMAL) <= ${chapterNumber}
              ORDER BY CAST(chapter_number AS DECIMAL) ASC
              LIMIT ${MAX_CHAPTERS_PER_BULK}
            `;

      // Bulk upsert all chapters as read (V2 table)
          if (allPrecedingLogicalChapters.length > 0) {
            // Build VALUES clause for bulk insert
            const chapterIds = allPrecedingLogicalChapters.map(ch => ch.id);
            
            // M3 FIX: Handle null sourceId properly in raw SQL
            const safeSourceId = sourceId ?? null;
            
            // Use raw SQL for efficient bulk upsert with LWW semantics
            await tx.$executeRaw`
              INSERT INTO "user_chapter_reads_v2" 
                ("id", "user_id", "chapter_id", "is_read", "updated_at", "read_at", "source_used_id", "device_id", "server_received_at")
              SELECT 
                gen_random_uuid(), 
                ${user.id}::uuid, 
                ch.id::uuid, 
                true, 
                ${targetTimestamp}::timestamptz, 
                ${targetTimestamp}::timestamptz, 
                ${safeSourceId}::uuid, 
                ${deviceId}, 
                NOW()
              FROM unnest(${chapterIds}::uuid[]) AS ch(id)
              ON CONFLICT ("user_id", "chapter_id")
              DO UPDATE SET 
                "is_read" = true,
                "updated_at" = EXCLUDED."updated_at",
                "device_id" = EXCLUDED."device_id",
                "server_received_at" = EXCLUDED."server_received_at",
                "read_at" = EXCLUDED."updated_at",
                "source_used_id" = EXCLUDED."source_used_id"
              WHERE EXCLUDED."updated_at" >= "user_chapter_reads_v2"."updated_at"
            `;
          }

      // Legacy compatibility: mark all chapters 1→N in legacy table
          const allLegacyChapters = await tx.$queryRaw<{id: string}[]>`
              SELECT id
              FROM legacy_chapters
              WHERE series_id = ${entry.series_id || ""}::uuid
                AND chapter_number > 0
                AND chapter_number <= ${chapterNumber}
              LIMIT ${MAX_CHAPTERS_PER_BULK}
            `;

        // H2 FIX: Use bulk insert instead of loop to prevent timeout on large chapter counts
          if (allLegacyChapters.length > 0) {
            const legacyChapterIds = allLegacyChapters.map(ch => ch.id);
            
            await tx.$executeRaw`
              INSERT INTO "user_chapter_reads" ("user_id", "chapter_id", "read_at")
              SELECT 
                ${user.id}::uuid, 
                ch.id::uuid, 
                ${targetTimestamp}::timestamptz
              FROM unnest(${legacyChapterIds}::uuid[]) AS ch(id)
              ON CONFLICT ("user_id", "chapter_id")
              DO UPDATE SET "read_at" = EXCLUDED."read_at"
            `;
          }
        }

      // 6. Check Achievements (XP awarded internally by checkAchievements)
        // Collect all unlocked achievements for response
        const unlockedAchievements: UnlockedAchievement[] = [];
        let achievementCheckFailed = false;
        try {
            const chapterAchievements = await checkAchievements(tx, user.id, 'chapter_read');
            unlockedAchievements.push(...chapterAchievements);
            
            if (newStreak > userProfile.streak_days) {
              const streakAchievements = await checkAchievements(tx, user.id, 'streak_reached', { currentStreak: newStreak });
              unlockedAchievements.push(...streakAchievements);
            }
} catch (achievementError) {
              achievementCheckFailed = true;
              logger.error('Failed to check achievements', { 
                error: achievementError instanceof Error ? achievementError.message : String(achievementError),
                userId: user.id,
                entryId
              });
            }

        // 7. Invalidate Activity Feed Cache for this user
        // Inside transaction to ensure atomicity with database updates
        try {
          await redisApi.incr(`${REDIS_KEY_PREFIX}feed:v:${user.id}`);
        } catch (cacheError) {
          logger.error('Failed to invalidate feed cache', { error: cacheError instanceof Error ? cacheError.message : String(cacheError) });
        }

        // MANGATRACK PARITY: Update activity score (chapter_read: +50)
          if (entry.series_id) {
            await recordActivityEvent({ series_id: entry.series_id, event_type: 'chapter_read' });
          }

        return {
              entry: updatedEntry,
              xpGained: baseXpGained,
              achievements: unlockedAchievements.map(a => ({
                code: a.code,
                name: a.name,
                xp_reward: a.xp_reward,
                rarity: a.rarity,
              })),
              new_streak: newStreak,
              new_level: newLevel,
              chapters_marked_read: isRead && chapterNumber ? chapterNumber : 0,
              achievementCheckFailed,
            };
          }, { ...DEFAULT_TX_OPTIONS, timeout: 15000 });

      // M1 FIX: Queue achievement check retry if it failed during transaction
      if (result.achievementCheckFailed) {
        try {
          await notificationQueue.add(
            `achievement-retry-${user.id}-${Date.now()}`,
            {
              type: 'achievement_check_retry',
              userId: user.id,
              trigger: 'chapter_read',
              entryId,
              timestamp: new Date().toISOString(),
            },
            { delay: 5000 }
          );
        } catch (retryQueueError) {
          logger.warn('Failed to queue achievement retry', { 
            error: retryQueueError instanceof Error ? retryQueueError.message : String(retryQueueError)
          });
        }
      }

      return NextResponse.json(result);
    } catch (error: unknown) {
      logger.error('Progress update error', { error: error instanceof Error ? error.message : String(error) });
      return handleApiError(error);
    }
}
