import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS, TransactionClient } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { logActivity } from '@/lib/gamification/activity';
import { XP_SERIES_COMPLETED, calculateLevel } from '@/lib/gamification/xp';
import { checkAchievements, UnlockedAchievement } from '@/lib/gamification/achievements';
import { validateUUID, handleApiError, ApiError, validateOrigin, ErrorCodes, getClientIp, validateContentType, validateJsonSize, checkRateLimit } from '@/lib/api-utils';
import { recordSignal } from '@/lib/analytics/signals';
import { antiAbuse } from '@/lib/anti-abuse';
import { cancelJobsForLibraryEntry } from '@/lib/job-cleanup';
import { checkIdempotency, storeIdempotencyResult, extractIdempotencyKey } from '@/lib/idempotency';
import { logger } from '@/lib/logger';

// =============================================================================
// V5 AUDIT BUG 51: Import user assertion for transaction safety
// =============================================================================
import {
  assertUserExistsInTransaction,
  verifyOwnershipInTransaction,
} from '@/lib/bug-fixes/v5-audit-bugs-51-80';

/**
 * v5 Audit Bug 40 + 51: Verify ownership and user existence within transaction
 * Returns the library entry if ownership is verified, null otherwise
 */
async function verifyEntryOwnership(
  tx: TransactionClient,
  entryId: string,
  userId: string
): Promise<{
  valid: boolean;
  entry: Awaited<ReturnType<typeof tx.libraryEntry.findUnique>> | null;
  error?: string;
}> {
  // Bug 51: First assert user still exists and is not deleted/banned
  const userCheck = await assertUserExistsInTransaction(tx, userId);
  if (!userCheck.valid) {
    return { 
      valid: false, 
      entry: null, 
      error: userCheck.error || 'User validation failed' 
    };
  }

  // Bug 40: Use SELECT FOR UPDATE to lock the row during verification
  // This prevents race conditions where ownership might change between check and use
  const entry = await tx.$queryRaw<any[]>`
    SELECT * FROM library_entries 
    WHERE id = ${entryId}::uuid 
      AND user_id = ${userId}::uuid
      AND deleted_at IS NULL
    FOR UPDATE
  `;
  
  if (!entry || entry.length === 0) {
    return { 
      valid: false, 
      entry: null, 
      error: 'Library entry not found or access denied' 
    };
  }
  
  // Convert raw result to proper type
  const libraryEntry = await tx.libraryEntry.findUnique({
    where: { id: entryId, user_id: userId }
  });
  
  return { valid: true, entry: libraryEntry };
}

/**
 * PATCH /api/library/[id]
 * Updates a library entry status or rating
 * 
 * RESPONSE CONTRACT:
 * - xpGained: base XP only (NOT including achievement XP)
 * - achievements: array of unlocked achievements (empty if none)
 * 
 * v5 Audit Bug Fixes:
 * - Bug 40: Verify ownership within transaction using FOR UPDATE
 * - Bug 51: Re-assert user exists inside transaction
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CSRF Protection
    validateOrigin(req);

    // BUG FIX: Validate Content-Type
    validateContentType(req);

    // BUG FIX: Validate JSON Size
    await validateJsonSize(req);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const rateCheck = await antiAbuse.checkStatusRateLimit(user.id);
    if (!rateCheck.allowed) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const { id: entryId } = await params;
    
    // Validate UUID format
    validateUUID(entryId, 'entryId');

    let body;
    try {
      body = await req.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }
    
    const { status, rating, preferred_source } = body;

    // Validate status if provided
    if (status) {
      const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
      if (!validStatuses.includes(status)) {
        throw new ApiError('Invalid status', 400, ErrorCodes.VALIDATION_ERROR);
      }
    }

    // Validate rating if provided
    if (rating !== undefined && rating !== null) {
      const ratingNum = Number(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 10) {
        throw new ApiError('Rating must be between 1 and 10', 400, ErrorCodes.VALIDATION_ERROR);
      }
    }

    // Validate preferred_source if provided
    if (preferred_source !== undefined && preferred_source !== null) {
      if (typeof preferred_source !== 'string' || preferred_source.length > 50) {
        throw new ApiError('Invalid preferred source', 400, ErrorCodes.VALIDATION_ERROR);
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      // Bug 40 + 51: Verify ownership and user existence within transaction
      const ownershipCheck = await verifyEntryOwnership(tx, entryId, user.id);
      if (!ownershipCheck.valid || !ownershipCheck.entry) {
        throw new ApiError(ownershipCheck.error || 'Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }
      
      const currentEntry = ownershipCheck.entry;

      // Bot detection for status toggle abuse (soft block XP only)
      let botDetected = false;
      if (status && status !== currentEntry.status) {
        const botCheck = await antiAbuse.detectStatusBotPatterns(user.id, entryId, status);
        botDetected = botCheck.isBot;
      }

      // XP rate limit guard (5 XP grants per minute)
      const xpAllowed = status === 'completed' ? await antiAbuse.canGrantXp(user.id) : true;

      // 2. Prepare update data
      const updateData: Prisma.LibraryEntryUpdateInput = {};
      if (status) updateData.status = status;
      if (rating !== undefined) updateData.user_rating = rating;
      if (preferred_source !== undefined) updateData.preferred_source = preferred_source;

      // 3. Update entry
      const updatedEntry = await tx.libraryEntry.update({
        where: { id: entryId, user_id: user.id },
        data: updateData,
      });

      // 4. Handle side effects if status changed to 'completed'
      let baseXpGained = 0;
      const unlockedAchievements: UnlockedAchievement[] = [];
      
      if (status === 'completed' && currentEntry.status !== 'completed') {
        // SYSTEM FIX: Use immutable series_completion_xp_granted flag to prevent XP farming
        // This flag is NEVER reset, even if status changes back to non-completed
        // ANTI-ABUSE: Also check bot detection and XP rate limit
        if (!currentEntry.series_completion_xp_granted && !botDetected && xpAllowed) {
          // Award XP and set immutable flag
          const userProfile = await tx.user.findUnique({
            where: { id: user.id },
            select: { xp: true },
          });

          baseXpGained = XP_SERIES_COMPLETED;
          const newXp = (userProfile?.xp || 0) + baseXpGained;
          const newLevel = calculateLevel(newXp);

          await tx.user.update({
            where: { id: user.id },
            data: {
              xp: newXp,
              level: newLevel,
            },
          });

          // Set immutable XP flag - this can NEVER be reset
          await tx.libraryEntry.update({
            where: { id: entryId },
            data: { series_completion_xp_granted: true },
          });

          // Log activity
          await logActivity(tx, user.id, 'series_completed', {
            seriesId: currentEntry.series_id ?? undefined,
          });

          // Check achievements (XP awarded internally)
          try {
            const achievements = await checkAchievements(tx, user.id, 'series_completed');
            unlockedAchievements.push(...achievements);
          } catch (achievementError) {
            console.error('Failed to check achievements:', achievementError);
          }
        }
      } else if (status && status !== currentEntry.status) {
        // Log status update activity
        await logActivity(tx, user.id, 'status_updated', {
          seriesId: currentEntry.series_id ?? undefined,
          metadata: { old_status: currentEntry.status, new_status: status },
        });
      }

      return { 
        entry: updatedEntry, 
        seriesId: currentEntry.series_id, 
        baseXpGained,
        unlockedAchievements,
      };
    }, DEFAULT_TX_OPTIONS);

    // Record rating signal outside transaction (non-blocking)
    if (rating !== undefined && rating !== null && result.seriesId) {
      recordSignal({
        user_id: user.id,
        series_id: result.seriesId,
        signal_type: 'rating',
        metadata: { rating: Number(rating) }
      }).catch(err => console.error('[Library] Failed to record rating signal:', err.message));
    }

    // Build response following mandatory contract
    const response: Record<string, unknown> = { ...result.entry };
    
    // Only include xpGained and achievements if XP was awarded
    if (result.baseXpGained > 0) {
      response.xpGained = result.baseXpGained;
      response.achievements = result.unlockedAchievements.map(a => ({
        code: a.code,
        name: a.name,
        xp_reward: a.xp_reward,
        rarity: a.rarity,
      }));
    }

    return NextResponse.json(response);
  } catch (error: any) {
    return handleApiError(error);
  }
}

/**
 * DELETE /api/library/[id]
 * Removes a series from the user's library
 * 
 * BUG 64 FIX: Now cancels in-flight jobs for the deleted entry
 * BUG 65 FIX: Supports idempotency via x-idempotency-key header
 * v5 Audit Bug 40 + 51: Verify ownership and user existence within transaction
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    validateOrigin(req);

    const ip = getClientIp(req);
    if (!await checkRateLimit(`library-delete:${ip}`, 30, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const { id: entryId } = await params;
    validateUUID(entryId, 'entryId');

    const idempotencyKey = extractIdempotencyKey(req);
    const idempotencyCheck = await checkIdempotency(idempotencyKey);
    if (idempotencyCheck.isDuplicate) {
      logger.info(`[Library] Returning cached result for idempotent delete: ${entryId}`);
      return NextResponse.json(idempotencyCheck.previousResult);
    }

    const deletedEntry = await prisma.$transaction(async (tx) => {
      // Bug 40 + 51: Verify ownership and user existence within transaction
      const ownershipCheck = await verifyEntryOwnership(tx, entryId, user.id);
      if (!ownershipCheck.valid || !ownershipCheck.entry) {
        throw new ApiError(ownershipCheck.error || 'Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }
      
      const entry = ownershipCheck.entry;

      // Check if already deleted
      if (entry.deleted_at) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }

      await tx.libraryEntry.update({
        where: { id: entryId, user_id: user.id },
        data: { deleted_at: new Date() },
      });

      await logActivity(tx, user.id, 'library_removed', {
        seriesId: entry.series_id ?? undefined,
      });

      if (entry.series_id) {
        await tx.$executeRaw`
          UPDATE series 
          SET total_follows = GREATEST(0, total_follows - 1)
          WHERE id = ${entry.series_id}::uuid
        `;
      }

      return entry;
    }, DEFAULT_TX_OPTIONS);

    cancelJobsForLibraryEntry(entryId).catch(err => {
      logger.error('[Library] Failed to cancel jobs for deleted entry', { 
        entryId, 
        error: err instanceof Error ? err.message : String(err) 
      });
    });

    if (deletedEntry.series_id) {
      recordSignal({
        user_id: user.id,
        series_id: deletedEntry.series_id,
        signal_type: 'remove_from_library',
        metadata: { source: 'library_page' }
      }).catch(err => logger.error('[Library] Failed to record remove signal:', { error: err instanceof Error ? err.message : String(err) }));
    }

    const result = { success: true };
    
    if (idempotencyCheck.key) {
      await storeIdempotencyResult(idempotencyCheck.key, result);
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
