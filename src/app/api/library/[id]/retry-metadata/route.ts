import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS } from '@/lib/prisma';
import { seriesResolutionQueue } from '@/lib/queues';
import { validateUUID, checkRateLimit, handleApiError, ApiError, validateOrigin, validateContentType, ErrorCodes } from '@/lib/api-utils';
import { logger } from '@/lib/logger';

/**
 * POST /api/library/[id]/retry-metadata
 * Retries the metadata enrichment process for a library entry
 * 
 * BUG FIXES:
 * - Bug 2: Uses SELECT FOR UPDATE to prevent race conditions
 * - Bug 6: Uses idempotency key to prevent duplicate jobs
 * - v5 Audit Bug 17: Check current state before enqueue
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // CSRF Protection
    validateOrigin(req);
    validateContentType(req);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const { id: entryId } = await params;
    
    // Validate UUID format
    validateUUID(entryId, 'entryId');

    // Rate limit: 10 retries per minute per user
    if (!await checkRateLimit(`metadata-retry:${user.id}`, 10, 60000)) {
      throw new ApiError('Too many retry attempts. Please wait.', 429, ErrorCodes.RATE_LIMITED);
    }

    // v5 Audit Bug 17: Pre-check entry state BEFORE starting transaction
    // This prevents unnecessary DB locks and queue operations
    const preCheck = await prisma.libraryEntry.findUnique({
      where: { id: entryId, user_id: user.id },
      select: {
        id: true,
        metadata_status: true,
        last_metadata_attempt_at: true,
        series_id: true,
        series: {
          select: { metadata_source: true }
        }
      }
    });

    if (!preCheck) {
      throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
    }

    // v5 Audit Bug 17: Check if already enriched
    if (preCheck.metadata_status === 'enriched') {
      throw new ApiError(
        'This entry is already enriched with metadata. No retry needed.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // v5 Audit Bug 17: Check if recently attempted (within last 2 minutes)
    const recentAttemptThreshold = new Date(Date.now() - 2 * 60 * 1000); // 2 minutes
    if (preCheck.last_metadata_attempt_at && 
        new Date(preCheck.last_metadata_attempt_at) > recentAttemptThreshold) {
      const secondsSinceLastAttempt = Math.round(
        (Date.now() - new Date(preCheck.last_metadata_attempt_at).getTime()) / 1000
      );
      throw new ApiError(
        `Metadata enrichment was recently attempted (${secondsSinceLastAttempt}s ago). Please wait before retrying.`,
        429,
        ErrorCodes.RATE_LIMITED
      );
    }

    // v5 Audit Bug 17: Check if entry was manually fixed
    if (preCheck.series?.metadata_source === 'USER_OVERRIDE') {
      throw new ApiError(
        'This entry has been manually fixed. To reset, use "Unlink Metadata" first.',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const result = await prisma.$transaction(async (tx) => {
      // Bug 2: Use SELECT FOR UPDATE to lock the row during operation
      const entry = await tx.$queryRaw<any[]>`
        SELECT * FROM library_entries 
        WHERE id = ${entryId}::uuid AND user_id = ${user.id}::uuid
        FOR UPDATE NOWAIT
      `.catch((err: any) => {
        // NOWAIT will throw if row is locked - another retry is in progress
        if (err.code === '55P03') { // lock_not_available
          throw new ApiError('Another retry is already in progress for this entry', 409, ErrorCodes.CONFLICT);
        }
        throw err;
      }).then(rows => rows?.[0]);

      if (!entry) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }

      // Double-check states inside transaction (could have changed since preCheck)
      if (entry.metadata_status === 'enriched') {
        return { skipped: true, reason: 'already_enriched', entry };
      }

      // Check if already being processed (pending with recent attempt)
      const recentAttemptThresholdTx = new Date(Date.now() - 60000); // 1 minute
      if (entry.metadata_status === 'pending' && 
          entry.last_metadata_attempt_at && 
          new Date(entry.last_metadata_attempt_at) > recentAttemptThresholdTx) {
        return { skipped: true, reason: 'in_progress', entry };
      }

      // Check if entry was manually fixed - don't reset USER_OVERRIDE
      if (entry.series_id) {
        const linkedSeries = await tx.series.findUnique({
          where: { id: entry.series_id },
          select: { metadata_source: true }
        });
        
        if (linkedSeries?.metadata_source === 'USER_OVERRIDE') {
          throw new ApiError(
            'This entry has been manually fixed. To reset, use "Unlink Metadata" first.',
            400,
            ErrorCodes.VALIDATION_ERROR
          );
        }
      }

      // Reset status and review flag
      const updatedEntry = await tx.libraryEntry.update({
        where: { id: entryId },
        data: {
          metadata_status: 'pending',
          needs_review: false,
          last_metadata_attempt_at: new Date(), // Mark as being retried
        },
      });

      // Create activity record for the feed
      await tx.activity.create({
        data: {
          user_id: user.id,
          type: 'retry',
          series_id: entry.series_id || undefined,
          metadata: {
            entry_id: entryId,
            action: 'manual_retry'
          }
        }
      });

      return { skipped: false, entry: updatedEntry, sourceUrl: entry.source_url, importedTitle: entry.imported_title };
    }, {
      ...DEFAULT_TX_OPTIONS,
      isolationLevel: 'Serializable' // Strongest isolation to prevent races
    });

    // Handle skipped cases
    if (result.skipped) {
      if (result.reason === 'already_enriched') {
        return NextResponse.json({
          success: true,
          message: 'Entry is already enriched',
          entry: result.entry,
        });
      }
      if (result.reason === 'in_progress') {
        return NextResponse.json({
          success: true,
          message: 'Metadata enrichment already in progress',
          entry: result.entry,
        });
      }
    }

    // Bug 6: Use idempotency key based on entry ID and current retry count
    // This prevents duplicate jobs even if the API is called multiple times
    const idempotencyKey = `retry-${entryId}-${Date.now()}`;
    
    // Check if a job for this entry already exists in the queue
    const existingJob = await seriesResolutionQueue.getJob(`retry-resolution-${entryId}`);
    if (existingJob) {
      const state = await existingJob.getState();
      if (state === 'waiting' || state === 'active' || state === 'delayed') {
        logger.info(`[RetryMetadata] Job already exists for ${entryId} in state: ${state}`);
        return NextResponse.json({
          success: true,
          message: 'Metadata enrichment already queued',
          entry: result.entry,
        });
      }
      // Remove completed/failed job to allow re-queue
      await existingJob.remove();
    }

    // Requeue resolution job with idempotent job ID
    await seriesResolutionQueue.add(`retry-resolution-${entryId}`, {
      libraryEntryId: entryId,
      source_url: result.sourceUrl,
      title: result.importedTitle || undefined,
    }, {
      jobId: `retry-resolution-${entryId}`, // Bug 6: Idempotent job ID
      priority: 1, // High priority for manual retries
      attempts: 5,
      backoff: { type: 'exponential', delay: 30000 },
    });

    logger.info(`[RetryMetadata] Queued retry for entry ${entryId}`);

    return NextResponse.json({
      success: true,
      message: 'Metadata enrichment retried',
      entry: result.entry,
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
