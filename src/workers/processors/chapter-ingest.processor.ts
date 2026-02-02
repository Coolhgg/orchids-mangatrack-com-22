import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { notificationQueue, gapRecoveryQueue, feedFanoutQueue } from '@/lib/queues';
import { scheduleNotification } from '@/lib/notifications-timing';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { withLock, redisApi, REDIS_KEY_PREFIX } from '@/lib/redis';
import { normalizeTitle } from '@/lib/string-utils';
import { isTransientError } from '@/lib/prisma';
import { promoteSeriesTier } from '@/lib/catalog-tiers';

// ==========================================
// BUG 44 & 55-56 FIXES: Structured logging & payload validation
// ==========================================
import {
  validateJobPayload,
  createLogContext,
  formatStructuredLog,
  logStateTransition,
  classifySyncError,
  addToDeadLetterQueue,
  getWorkerRunId,
} from '@/lib/audit-pass3-fixes';

const FEED_BATCH_WINDOW_HOURS = 24;

// Bug 44: Job payload schema validation (already present, enhanced)
const ChapterIngestDataSchema = z.object({
  seriesSourceId: z.string().uuid(),
  seriesId: z.string().uuid(),
  chapterNumber: z.number().nullable().optional(),
  chapterSlug: z.string().nullable().optional(),
  chapterTitle: z.string().nullable(),
  chapterUrl: z.string().url(),
  sourceChapterId: z.string().nullable().optional(),
  publishedAt: z.string().nullable(),
  isRecovery: z.boolean().optional(),
  traceId: z.string().optional(),
});

export interface ChapterIngestData {
  seriesSourceId: string;
  seriesId: string;
  chapterNumber?: number | null;
  chapterSlug?: string | null;
  chapterTitle: string | null;
  chapterUrl: string;
  sourceChapterId?: string | null;
  publishedAt: string | null;
  isRecovery?: boolean;
  traceId?: string;
}

interface SourceEntry {
  name: string;
  url: string;
  discovered_at: string;
}

export async function processChapterIngest(job: Job<ChapterIngestData>) {
  // Bug 55: Create structured log context for all logs in this job
  const logCtx = createLogContext({
    jobId: job.id,
    workerName: 'ChapterIngest',
  });

  // Bug 44: Validate payload with detailed error reporting
  const parseResult = ChapterIngestDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    const errorMessage = `Invalid job payload: ${parseResult.error.message}`;
    console.error(formatStructuredLog('error', errorMessage, logCtx));
    
    // Add to DLQ for invalid payloads (they won't succeed on retry)
    addToDeadLetterQueue({
      originalQueue: 'chapter-ingest',
      jobId: job.id || 'unknown',
      jobName: job.name,
      payload: job.data,
      failureReason: errorMessage,
      attemptsMade: job.attemptsMade,
      maxAttempts: job.opts?.attempts || 3,
    });
    
    throw new Error(errorMessage);
  }

  const { 
    seriesSourceId, 
    seriesId, 
    chapterNumber,
    chapterSlug,
    chapterTitle: rawTitle, 
    chapterUrl,
    sourceChapterId,
    publishedAt,
    isRecovery = false,
    traceId = job.id || 'unknown'
  } = parseResult.data;

  // Bug 55: Enhanced log context with entity IDs
  const enhancedCtx = createLogContext({
    ...logCtx,
    seriesId,
    seriesSourceId,
    traceId,
  });

    const chapterTitle = rawTitle ? normalizeTitle(rawTitle) : null;
  
    if (sourceChapterId && sourceChapterId.length > 4500) {
      console.warn(formatStructuredLog('warn', `Exceptionally long sourceChapterId detected (${sourceChapterId.length} chars)`, enhancedCtx));
    }
  
    // MANGATRACK PARITY: Logical chapters are identified strictly by number
    // If no number, we use a sentinel (-1) to group specials/volumeless
    const identityKey = chapterNumber !== undefined && chapterNumber !== null 
      ? chapterNumber.toString() 
      : "-1";
  
    console.log(formatStructuredLog('info', `Ingesting chapter ${identityKey}`, enhancedCtx));
  
      return await withLock(`ingest:${seriesId}:${identityKey}`, 30000, async () => {
        try {
          const seriesSource = await prisma.seriesSource.findUnique({
            where: { id: seriesSourceId },
            select: { source_name: true, series: true },
          });
  
        if (!seriesSource || !seriesSource.series) {
          console.warn(formatStructuredLog('warn', `Source or associated series not found. Discarding job.`, enhancedCtx));
          return;
        }

        const sourceName = seriesSource.source_name ?? 'Unknown';

            const fanoutParams = await prisma.$transaction(async (tx) => {
              // 1. Identify/Create Logical Chapter (MangaTrack Rule 1)
              const existingLogicalChapter = await tx.chapter.findUnique({
                where: {
                  series_id_chapter_number: {
                    series_id: seriesId,
                    chapter_number: identityKey,
                  },
                },
              });

              const chapter = await tx.chapter.upsert({
                where: {
                  series_id_chapter_number: {
                    series_id: seriesId,
                    chapter_number: identityKey,
                  },
                },

              update: {
                chapter_title: chapterTitle || undefined,
                published_at: publishedAt ? new Date(publishedAt) : undefined,
                // We preserve slug but it's not the identity
                chapter_slug: chapterSlug || undefined,
              },
              create: {
                series_id: seriesId,
                chapter_number: identityKey,
                chapter_slug: chapterSlug || "",
                chapter_title: chapterTitle,
                published_at: publishedAt ? new Date(publishedAt) : null,
              },
            });

            // Bug 56: Log state transition for chapter creation/update
            if (!existingLogicalChapter) {
              logStateTransition({
                entityType: 'chapter',
                entityId: chapter.id,
                field: 'created',
                previousValue: null,
                newValue: { chapterNumber: identityKey, seriesId },
                changedBy: 'worker',
                reason: 'Chapter ingest - new chapter detected'
              });
            }
  
            // 2. Handle Gap Detection
            if (!isRecovery && chapterNumber !== undefined && chapterNumber !== null && chapterNumber > 1) {
              const prevChapter = await tx.chapter.findUnique({
                where: {
                  series_id_chapter_number: {
                    series_id: seriesId,
                    chapter_number: (Math.floor(chapterNumber) - 1).toString(),
                  },
                },
              });
  
              if (!prevChapter) {
                console.log(formatStructuredLog('info', `Potential gap detected before chapter ${chapterNumber}. Enqueueing recovery.`, enhancedCtx));
                await gapRecoveryQueue.add(
                  `gap-recovery-${seriesId}`,
                  { seriesId },
                  { 
                    jobId: `gap-recovery-${seriesId}`,
                    delay: 60000 
                  }
                );
              }
            }
  
            // 3. Determine discovery time (MangaTrack Rule 3)
            // For timeline ordering, discovery time must be accurate
            let detectedAt = new Date();
            if (isRecovery && chapterNumber !== undefined) {
              const nextChapterSource = await tx.chapterSource.findFirst({
                where: {
                  chapter: {
                    series_id: seriesId,
                    chapter_number: { gt: identityKey },
                  }
                },
                orderBy: {
                  chapter: { chapter_number: 'asc' }
                },
                select: { detected_at: true }
              });
  
              if (nextChapterSource) {
                detectedAt = new Date(nextChapterSource.detected_at.getTime() - 1);
              }
            }
  
            // 4. Update/Create ChapterSource (MangaTrack Rule 2 & 4)
            // Each source upload is an availability event. We link it to the logical chapter.
            let finalSourceId = '';
            const existingSource = await tx.chapterSource.findUnique({
              where: {
                series_source_id_chapter_id: {
                  series_source_id: seriesSourceId,
                  chapter_id: chapter.id,
                },
              },
            });
  
            if (existingSource) {
              finalSourceId = existingSource.id;
              // MANGATRACK PARITY: We update the record but keep the original detected_at
              await tx.chapterSource.update({
                where: { id: existingSource.id },
                data: {
                  source_chapter_url: chapterUrl,
                  chapter_title: chapterTitle,
                  source_chapter_id: sourceChapterId,
                  source_published_at: publishedAt ? new Date(publishedAt) : undefined,
                  is_available: true,
                  last_checked_at: new Date(),
                },
              });
            } else {
              const newSource = await tx.chapterSource.create({
                data: {
                  chapter_id: chapter.id,
                  series_source_id: seriesSourceId,
                  source_name: sourceName,
                  source_chapter_url: chapterUrl,
                  chapter_title: chapterTitle,
                  source_chapter_id: sourceChapterId,
                  source_published_at: publishedAt ? new Date(publishedAt) : null,
                  detected_at: detectedAt,
                  is_available: true,
                },
              });
              finalSourceId = newSource.id;
  
              await tx.seriesSource.update({
                where: { id: seriesSourceId },
                data: {
                  source_chapter_count: { increment: 1 },
                  sync_priority: 'HOT',
                  next_check_at: new Date(Date.now() + 15 * 60 * 1000),
                },
              });
            }
  
            // 5. Keep legacy Chapter model in sync
              const legacyChapterNum = new Prisma.Decimal(chapterNumber || -1);
              
              // MANGATRACK PARITY: Update series last_chapter_date for discovery sorting
              // Use conditional update to ensure monotonicity - only update if this chapter is newer
              if (publishedAt) {
                const pubDate = new Date(publishedAt);
                await tx.$executeRaw`
                  UPDATE series 
                  SET last_chapter_date = ${pubDate}
                  WHERE id = ${seriesId}::uuid
                  AND (last_chapter_date IS NULL OR last_chapter_date < ${pubDate})
                `;
              }
            const existingLegacyChapter = await tx.legacyChapter.findUnique({
              where: {
                series_source_id_chapter_number: {
                  series_source_id: seriesSourceId,
                  chapter_number: legacyChapterNum,
                },
              },
            });
  
            if (existingLegacyChapter) {
              await tx.legacyChapter.update({
                where: { id: existingLegacyChapter.id },
                data: {
                  chapter_title: chapterTitle,
                  chapter_url: chapterUrl,
                  source_chapter_id: sourceChapterId,
                  published_at: publishedAt ? new Date(publishedAt) : existingLegacyChapter.published_at,
                  is_available: true,
                },
              });
            } else {
              await tx.legacyChapter.create({
                data: {
                  series_id: seriesId,
                  series_source_id: seriesSourceId,
                  chapter_number: legacyChapterNum,
                  chapter_title: chapterTitle,
                  chapter_url: chapterUrl,
                  source_chapter_id: sourceChapterId,
                  published_at: publishedAt ? new Date(publishedAt) : null,
                  discovered_at: detectedAt,
                },
              });
            }
  
            // 6. Handle Feed Entry - Use upsert to handle race conditions
            const newSourceEntry: SourceEntry = {
              name: sourceName,
              url: chapterUrl,
              discovered_at: detectedAt.toISOString(),
            };

            // First try to find and update existing entry
            const existingFeedEntry = await tx.feedEntry.findFirst({
              where: {
                series_id: seriesId,
                chapter_number: legacyChapterNum,
              },
            });

            if (existingFeedEntry) {
              const existingSources = (existingFeedEntry.sources as unknown as SourceEntry[]) || [];
              const sourceExists = existingSources.some((s) => s.name === sourceName);
              
              if (!sourceExists) {
                await tx.feedEntry.update({
                  where: { id: existingFeedEntry.id },
                  data: {
                    sources: [...existingSources, newSourceEntry],
                    last_updated_at: new Date(),
                    logical_chapter_id: chapter.id,
                  },
                });
              }
            } else {
              // Use upsert to handle race conditions where another worker creates the entry
              await tx.feedEntry.upsert({
                where: {
                  series_id_chapter_number: {
                    series_id: seriesId,
                    chapter_number: legacyChapterNum,
                  },
                },
                create: {
                  series_id: seriesId,
                  logical_chapter_id: chapter.id,
                  chapter_number: legacyChapterNum,
                  sources: [newSourceEntry],
                  first_discovered_at: detectedAt,
                  last_updated_at: detectedAt,
                },
                update: {
                  logical_chapter_id: chapter.id,
                  last_updated_at: new Date(),
                },
              });
            }
  
                return {
                  sourceId: finalSourceId,
                  chapterId: chapter.id,
                  detectedAt,
                  isFirstAppearance: !existingLogicalChapter,
                };
              }, {
                timeout: 30000,
              });
    
              // MANGATRACK PARITY: Promote series tier on chapter detection
              // Formula: +10 for first appearance, +5 for subsequent source detection
              if (fanoutParams.isFirstAppearance) {
                await promoteSeriesTier(seriesId, 'chapter_first_appearance');
              } else {
                await promoteSeriesTier(seriesId, 'chapter_detected');
              }

  
            // 7. Queue Notification (Timing-Aware SQL Queue)
            const delayMinutes = isRecovery ? 1 : 10;
            await scheduleNotification(fanoutParams.chapterId, delayMinutes);
  
            // 8. Queue Feed Fan-out
            const fanoutJobId = `fanout-${seriesSourceId}-${fanoutParams.chapterId}`;
            await feedFanoutQueue.add(
              fanoutJobId,
              {
                sourceId: fanoutParams.sourceId,
                seriesId,
                chapterId: fanoutParams.chapterId,
                discoveredAt: fanoutParams.detectedAt.toISOString(),
              },
              { 
                jobId: fanoutJobId,
                removeOnComplete: true 
              }
            );

        // 9. Invalidate Activity Feed Cache for followers
        try {
          const followers = await prisma.libraryEntry.findMany({
            where: { series_id: seriesId },
            select: { user_id: true }
          });

          if (followers.length > 0) {
            const pipeline = redisApi.pipeline();
            for (const follower of followers) {
              pipeline.incr(`${REDIS_KEY_PREFIX}feed:v:${follower.user_id}`);
            }
            await pipeline.exec();
            console.log(formatStructuredLog('info', `Invalidated feed cache for ${followers.length} followers`, enhancedCtx));
          }
        } catch (cacheError) {
          console.error(formatStructuredLog('error', `Failed to invalidate feed cache`, {
            ...enhancedCtx,
            error: cacheError instanceof Error ? cacheError.message : String(cacheError)
          }));
        }

        console.log(formatStructuredLog('info', `Chapter ingest completed successfully`, enhancedCtx));
      } catch (error: any) {
        // Bug 47-48: Classify error for better handling
        const classified = classifySyncError(error);
        
        console.error(formatStructuredLog('error', `Failed to process chapter ${chapterNumber}`, {
          ...enhancedCtx,
          errorType: classified.errorType,
          retryable: classified.retryable,
          error: classified.message
        }));
        
        if (isTransientError(error)) {
          console.warn(formatStructuredLog('warn', `Transient database error detected. Job will be retried.`, enhancedCtx));
        }
        
        throw error;
      }
  });
}
