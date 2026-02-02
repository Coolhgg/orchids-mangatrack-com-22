import { prisma, prismaRead, withRetry, isTransientError } from '@/lib/prisma';
import { 
  selectBestCover, 
  type CoverResult 
} from './cover-utils';

interface SourceCover {
  source_name: string;
  cover_url: string | null;
  cover_width: number | null;
  cover_height: number | null;
  cover_updated_at: Date | null;
  is_primary_cover: boolean;
}

interface SourceCoverWithSeriesId extends SourceCover {
  series_id: string | null;
}

/**
 * Gets the best cover for a single series with error handling
 */
export async function getBestCover(seriesId: string): Promise<CoverResult | null> {
  try {
    const sources = await withRetry<SourceCover[]>(
      () => prismaRead.seriesSource.findMany({
        where: { series_id: seriesId },
        select: {
          source_name: true,
          cover_url: true,
          cover_width: true,
          cover_height: true,
          cover_updated_at: true,
          is_primary_cover: true,
        },
      }),
      2,
      200
    );

    return selectBestCover(sources);
  } catch (error: any) {
    console.error(`[CoverResolver] Error getting best cover for series ${seriesId}:`, error.message?.slice(0, 100));
    return null;
  }
}

/**
 * Updates the best_cover_url for a series with error handling and retry logic
 */
export async function updateSeriesBestCover(seriesId: string): Promise<string | null> {
  try {
    const sources = await withRetry<SourceCover[]>(
      () => prismaRead.seriesSource.findMany({
        where: { series_id: seriesId },
        select: {
          source_name: true,
          cover_url: true,
          cover_width: true,
          cover_height: true,
          cover_updated_at: true,
          is_primary_cover: true,
        },
      }),
      2,
      200
    );

    const best = selectBestCover(sources);
    const bestUrl = best?.cover_url || null;

    await withRetry(
      () => prisma.series.update({
        where: { id: seriesId },
        data: { best_cover_url: bestUrl },
      }),
      2,
      200
    );

    return bestUrl;
  } catch (error: any) {
    // Log but don't throw - cover updates are not critical
    console.error(`[CoverResolver] Error updating best cover for series ${seriesId}:`, error.message?.slice(0, 100));
    
    // Re-throw if it's not a transient error (e.g., record not found)
    if (!isTransientError(error)) {
      throw error;
    }
    return null;
  }
}

/**
 * Batch fetches best covers for multiple series with error handling
 * Returns a Map that always contains entries for all requested seriesIds (null for failures)
 */
export async function getBestCoversBatch(seriesIds: string[]): Promise<Map<string, CoverResult | null>> {
  const result = new Map<string, CoverResult | null>();
  
  // Early return for empty input
  if (seriesIds.length === 0) return result;
  
  // Initialize all entries with null to ensure consistent return
  for (const id of seriesIds) {
    result.set(id, null);
  }

  try {
    const sources = await withRetry<SourceCoverWithSeriesId[]>(
      () => prismaRead.seriesSource.findMany({
        where: { series_id: { in: seriesIds } },
        select: {
          series_id: true,
          source_name: true,
          cover_url: true,
          cover_width: true,
          cover_height: true,
          cover_updated_at: true,
          is_primary_cover: true,
        },
      }),
      2,
      300
    );

    // Group sources by series_id
    const grouped = new Map<string, SourceCoverWithSeriesId[]>();
    for (const source of sources) {
      if (!source.series_id) continue;
      const existing = grouped.get(source.series_id) ?? [];
      existing.push(source);
      grouped.set(source.series_id, existing);
    }

    // Select best cover for each series
    for (const seriesId of seriesIds) {
      const seriesSources = grouped.get(seriesId) ?? [];
      result.set(seriesId, selectBestCover(seriesSources));
    }
  } catch (error: any) {
    console.error(`[CoverResolver] Error batch fetching covers for ${seriesIds.length} series:`, error.message?.slice(0, 100));
    // Keep the result map with null values - don't throw
  }

  return result;
}

/**
 * Batch updates best_cover_url for multiple series
 * Returns the count of successfully updated series
 */
export async function updateSeriesBestCoversBatch(seriesIds: string[]): Promise<number> {
  if (seriesIds.length === 0) return 0;
  
  let successCount = 0;
  
  // Process in chunks to avoid overwhelming the database
  const CHUNK_SIZE = 50;
  for (let i = 0; i < seriesIds.length; i += CHUNK_SIZE) {
    const chunk = seriesIds.slice(i, i + CHUNK_SIZE);
    
    try {
      // Fetch covers for this chunk
      const covers = await getBestCoversBatch(chunk);
      
      // Build update operations
      const updates = chunk.map(seriesId => {
        const cover = covers.get(seriesId);
        return prisma.series.update({
          where: { id: seriesId },
          data: { best_cover_url: cover?.cover_url || null },
        });
      });
      
      // Execute all updates in a transaction
      await prisma.$transaction(updates);
      successCount += chunk.length;
    } catch (error: any) {
      console.error(`[CoverResolver] Error batch updating covers (chunk ${i}):`, error.message?.slice(0, 100));
      // Continue with next chunk
    }
  }
  
  return successCount;
}

// Re-export all utilities from cover-utils for backward compatibility
export { 
  selectBestCover, 
  isValidCoverUrl, 
  isMangaDexPlaceholder, 
  getOptimizedCoverUrl,
  SOURCE_PRIORITY,
  type CoverResult,
  type CoverSize 
} from './cover-utils';
