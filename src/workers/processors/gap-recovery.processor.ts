import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { CrawlGatekeeper } from '@/lib/crawl-gatekeeper';
import { z } from 'zod';

const GapRecoveryDataSchema = z.object({
  seriesId: z.string().uuid(),
});

export interface GapRecoveryData {
  seriesId: string;
}

// Maximum gaps to process in a single job to prevent memory issues
const MAX_GAPS_PER_JOB = 100;

/**
 * Gap Recovery Processor
 * 
 * Detects missing chapters in a series and triggers re-polling of sources
 * to fill the gaps.
 * 
 * BUG FIX: Added error handling, gap limit, and proper logging
 */
export async function processGapRecovery(job: Job<GapRecoveryData>) {
  const jobId = job.id || 'unknown';
  
  const parseResult = GapRecoveryDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    console.error(`[GapRecovery][${jobId}] Invalid job payload:`, parseResult.error.format());
    throw new Error(`Invalid job payload: ${parseResult.error.message}`);
  }

  const { seriesId } = parseResult.data;
  console.log(`[GapRecovery][${jobId}] Starting gap recovery for series ${seriesId}`);

  try {
    // 1. Find all chapters for this series to detect gaps
    const chapters = await prisma.chapter.findMany({
      where: { series_id: seriesId },
      select: { chapter_number: true },
      orderBy: { chapter_number: 'asc' },
    });

    if (chapters.length <= 1) {
      console.log(`[GapRecovery][${jobId}] Skipped: Not enough chapters (${chapters.length})`);
      return { status: 'skipped', reason: 'Not enough chapters to detect gaps' };
    }

    const gaps: number[] = [];
    for (let i = 0; i < chapters.length - 1; i++) {
      const current = parseFloat(chapters[i].chapter_number) || 0;
      const next = parseFloat(chapters[i + 1].chapter_number) || 0;
      
      // If the difference is greater than 1, we have a gap
      // Use epsilon for float safety
      if (next - current > 1.0001) {
        for (let missing = Math.floor(current) + 1; missing < Math.floor(next); missing++) {
          gaps.push(missing);
          
          // Limit gaps to prevent memory issues
          if (gaps.length >= MAX_GAPS_PER_JOB) {
            console.warn(`[GapRecovery][${jobId}] Gap limit reached (${MAX_GAPS_PER_JOB}), truncating`);
            break;
          }
        }
        
        if (gaps.length >= MAX_GAPS_PER_JOB) break;
      }
    }

    if (gaps.length === 0) {
      console.log(`[GapRecovery][${jobId}] No gaps detected`);
      return { status: 'completed', message: 'No gaps detected' };
    }

    console.log(`[GapRecovery][${jobId}] Detected ${gaps.length} missing chapters: ${gaps.slice(0, 10).join(', ')}${gaps.length > 10 ? '...' : ''}`);

    // 2. Trigger targeted re-poll of all sources for this series
    const series = await prisma.series.findUnique({
      where: { id: seriesId },
      select: { catalog_tier: true }
    });

    const sources = await prisma.seriesSource.findMany({
      where: { 
        series_id: seriesId,
        failure_count: { lt: 5 },
        source_status: { not: 'broken' }
      },
      select: { id: true }
    });

    if (sources.length === 0) {
      console.warn(`[GapRecovery][${jobId}] No healthy sources found for series ${seriesId}`);
      return { status: 'completed', message: 'No healthy sources available', gapCount: gaps.length };
    }

    let enqueuedCount = 0;
    for (const source of sources) {
      const enqueued = await CrawlGatekeeper.enqueueIfAllowed(
        source.id,
        series?.catalog_tier || 'C',
        'GAP_RECOVERY',
        { targetChapters: gaps }
      );
      
      if (enqueued) enqueuedCount++;
    }

    console.log(`[GapRecovery][${jobId}] Completed: ${enqueuedCount}/${sources.length} sources enqueued for ${gaps.length} gaps`);

    return { 
      status: 'triggered', 
      gapCount: gaps.length, 
      sourceCount: sources.length,
      enqueuedCount
    };
  } catch (error) {
    console.error(`[GapRecovery][${jobId}] Error processing gap recovery:`, error);
    throw error;
  }
}
