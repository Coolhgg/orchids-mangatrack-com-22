import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes, validateOrigin } from "@/lib/api-utils"
import { createClient } from "@/lib/supabase/server"
import { seriesResolutionQueue } from "@/lib/queues"
import { logger } from "@/lib/logger"

/**
 * POST /api/library/retry-all-metadata
 * Retries metadata enrichment for all failed/unavailable entries
 * 
 * BUG FIXES:
 * - Bug 3: Now includes 'unavailable' status entries, not just 'failed'
 * - Bug 6: Uses idempotent job IDs to prevent duplicates
 * - Bug 39: Added pagination/batching to prevent overwhelming the queue
 */

// Bug 39 Fix: Configurable batch size
const MAX_BATCH_SIZE = 100;
const MAX_TOTAL_PER_REQUEST = 500;

export async function POST(request: NextRequest) {
  try {
    validateOrigin(request);
    const ip = getClientIp(request);
    if (!await checkRateLimit(`retry-all-metadata:${ip}`, 5, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
    }

    // Bug 39 Fix: Parse pagination parameters from request body
    let cursor: string | null = null;
    let requestedBatchSize = MAX_BATCH_SIZE;
    
    try {
      const body = await request.json();
      cursor = body.cursor || null;
      requestedBatchSize = Math.min(body.batchSize || MAX_BATCH_SIZE, MAX_BATCH_SIZE);
    } catch {
      // No body or invalid JSON, use defaults
    }

    // Bug 3 & Bug 39: Include BOTH failed AND unavailable entries with pagination
    // Unavailable entries may become available if:
    // - External APIs change
    // - Titles are updated
    // - New alt titles appear on MangaDex
    const whereClause: any = {
      user_id: user.id,
      metadata_status: { in: ["failed", "unavailable"] },
      deleted_at: null,
      // Only retry entries that haven't been attempted in the last 24 hours
      OR: [
        { last_metadata_attempt_at: null },
        { last_metadata_attempt_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
      ]
    };

    // Bug 39 Fix: Add cursor-based pagination
    if (cursor) {
      whereClause.id = { gt: cursor };
    }

    // Bug 39 Fix: First get total count for user feedback
    const totalEligible = await prisma.libraryEntry.count({
      where: {
        user_id: user.id,
        metadata_status: { in: ["failed", "unavailable"] },
        deleted_at: null,
        OR: [
          { last_metadata_attempt_at: null },
          { last_metadata_attempt_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        ]
      }
    });

    const retryableEntries = await prisma.libraryEntry.findMany({
      where: whereClause,
      select: { 
        id: true, 
        source_url: true, 
        imported_title: true,
        metadata_status: true,
        metadata_retry_count: true 
      },
      orderBy: [
        { metadata_retry_count: 'asc' }, // Prioritize entries with fewer retries
        { id: 'asc' } // Stable sort for cursor pagination
      ],
      take: requestedBatchSize
    });

    if (retryableEntries.length === 0) {
      return NextResponse.json({ 
        success: true, 
        message: cursor 
          ? "No more entries to process in this batch."
          : "No entries need retry. All entries were attempted within the last 24 hours.",
        count: 0,
        totalEligible,
        hasMore: false,
        nextCursor: null
      });
    }

    // Reset status to pending for entries we're about to retry
    await prisma.libraryEntry.updateMany({
      where: {
        id: { in: retryableEntries.map(e => e.id) }
      },
      data: {
        metadata_status: "pending",
        last_metadata_attempt_at: new Date() // Mark as being retried
      }
    });

    // Bug 6: Use idempotent job IDs to prevent duplicate jobs
    const jobs = retryableEntries.map(entry => ({
      name: `enrich-${entry.id}`,
      data: { 
        libraryEntryId: entry.id, 
        source_url: entry.source_url, 
        title: entry.imported_title 
      },
      opts: { 
        jobId: `enrich-${entry.id}`, // Idempotent - won't create duplicate
        priority: 2, // Lower priority than manual retries
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 }
      }
    }));

    // Use addBulk for efficiency, but it will skip jobs with existing IDs
    await seriesResolutionQueue.addBulk(jobs);

    const failedCount = retryableEntries.filter(e => e.metadata_status === 'failed').length;
    const unavailableCount = retryableEntries.filter(e => e.metadata_status === 'unavailable').length;

    // Bug 39 Fix: Calculate if there are more entries to process
    const lastEntry = retryableEntries[retryableEntries.length - 1];
    const nextCursor = lastEntry?.id || null;
    
    // Check if there are more entries after this batch
    const remainingCount = await prisma.libraryEntry.count({
      where: {
        user_id: user.id,
        metadata_status: { in: ["failed", "unavailable"] },
        deleted_at: null,
        id: { gt: nextCursor || '' },
        OR: [
          { last_metadata_attempt_at: null },
          { last_metadata_attempt_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
        ]
      }
    });

    const hasMore = remainingCount > 0 && retryableEntries.length >= requestedBatchSize;

    logger.info(`[RetryAllMetadata] Queued ${retryableEntries.length} entries (${failedCount} failed, ${unavailableCount} unavailable), ${remainingCount} remaining`);

    return NextResponse.json({ 
      success: true, 
      message: `Successfully queued ${retryableEntries.length} entries for metadata retry.`,
      count: retryableEntries.length,
      totalEligible,
      breakdown: {
        failed: failedCount,
        unavailable: unavailableCount
      },
      // Bug 39 Fix: Include pagination info for client to continue
      pagination: {
        hasMore,
        nextCursor: hasMore ? nextCursor : null,
        remaining: remainingCount,
        batchSize: requestedBatchSize
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
