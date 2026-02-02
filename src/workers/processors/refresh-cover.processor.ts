import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { getMangaById } from '@/lib/mangadex';
import { isValidCoverUrl, updateSeriesBestCover } from '@/lib/cover-resolver';
import { sourceRateLimiter } from '@/lib/rate-limiter';

export interface RefreshCoverData {
  seriesId: string;
  sourceId: string;
  sourceName: string;
}

const RATE_LIMIT_TIMEOUT_MS = 30000; // 30s max wait for rate limit

export async function processRefreshCover(job: Job<RefreshCoverData>) {
  const { seriesId, sourceId, sourceName } = job.data;

  if (sourceName !== 'mangadex') {
    return { skipped: true, reason: 'Source not supported' };
  }

  console.log(`[RefreshCover] Processing ${seriesId} (${sourceId}) from ${sourceName}`);

  // ========================================
  // RATE LIMITING: Acquire token before API call
  // ========================================
  const tokenAcquired = await sourceRateLimiter.acquireToken(sourceName, RATE_LIMIT_TIMEOUT_MS);
  
  if (!tokenAcquired) {
    console.warn(`[RefreshCover] Rate limit timeout for ${sourceName}, will retry`);
    throw new Error('Rate limit timeout - will retry');
  }

  try {
    // 1. Fetch MangaDex metadata
    const manga = await getMangaById(sourceId);
    
    // 2. Extract and validate cover URL
    // MangaDex is authoritative - if it returns no cover, we clear stale placeholders
    const rawCoverUrl = manga.cover_url;
    const newCoverUrl = isValidCoverUrl(rawCoverUrl) ? rawCoverUrl : null;
    
    console.log(`[RefreshCover] MangaDex returned cover: ${newCoverUrl ?? 'null (will clear placeholder)'}`);

    // 3. Update the database (Transaction to ensure both are updated)
    // Always update - null is valid when MangaDex has no cover (clears placeholders)
    try {
      await prisma.$transaction([
        // Update the source record
        prisma.seriesSource.update({
          where: {
            source_name_source_id: {
              source_name: sourceName,
              source_id: sourceId,
            },
          },
          data: {
            cover_url: newCoverUrl,
            cover_updated_at: new Date(),
          },
        }),
        // Update the main series record (authoritative since it's MangaDex)
        prisma.series.update({
          where: { id: seriesId },
          data: {
            cover_url: newCoverUrl,
          },
        }),
      ]);
    } catch (dbError: any) {
      // If the record was deleted between job enqueue and execution, we log and skip
      if (dbError.code === 'P2025') {
        console.warn(`[RefreshCover] Target record not found for ${seriesId}, skipping update.`);
        return { success: true, skipped: true, reason: 'Record not found' };
      }
      throw dbError;
    }

    // 4. Update cached best_cover_url
    await updateSeriesBestCover(seriesId);

    console.log(`[RefreshCover] Updated cover for ${seriesId} to ${newCoverUrl}`);

    return {
      success: true,
      updated: true,
      cover_url: newCoverUrl,
    };
  } catch (error: any) {
    console.error(`[RefreshCover] Failed to refresh cover for ${seriesId}:`, error.message);
    throw error;
  }
}
