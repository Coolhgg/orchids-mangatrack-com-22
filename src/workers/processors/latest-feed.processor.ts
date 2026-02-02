import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { scrapers } from '@/lib/scrapers';
import { CrawlGatekeeper } from '@/lib/crawl-gatekeeper';

// Rate limit to prevent overwhelming sources during latest feed polling
const MAX_UPDATES_PER_SOURCE = 50;
const BATCH_SIZE = 10;

interface LatestFeedResult {
  name: string;
  total: number;
  matched: number;
  enqueued: number;
  errors: number;
}

/**
 * Latest Feed Processor
 * 
 * Scrapes the "latest updates" feed from each supported source to discover
 * newly updated series. This is a key component of the demand-driven crawling system.
 * 
 * BUG FIX: Added error handling, rate limiting, and batching
 */
export async function processLatestFeed(job: Job) {
  const jobId = job.id || 'unknown';
  console.log(`[LatestFeed][${jobId}] Starting latest feed discovery...`);

  const results = await Promise.allSettled(
    Object.entries(scrapers).map(async ([name, scraper]): Promise<LatestFeedResult | null> => {
      if (!scraper.scrapeLatestUpdates) {
        return null;
      }

      try {
        console.log(`[LatestFeed][${jobId}] Scraping latest updates from ${name}...`);
        const updates = await scraper.scrapeLatestUpdates();
        
        // Limit updates to prevent overwhelming the system
        const limitedUpdates = updates.slice(0, MAX_UPDATES_PER_SOURCE);
        
        let matchedCount = 0;
        let enqueuedCount = 0;
        let errorCount = 0;

        // Process in batches to prevent DB connection exhaustion
        for (let i = 0; i < limitedUpdates.length; i += BATCH_SIZE) {
          const batch = limitedUpdates.slice(i, i + BATCH_SIZE);
          
          await Promise.allSettled(batch.map(async (update) => {
            try {
              // Find matching source in our DB
              const source = await prisma.seriesSource.findFirst({
                where: {
                  source_name: { equals: name, mode: 'insensitive' },
                  source_id: update.sourceId,
                  source_status: { not: 'broken' },
                },
                include: {
                  series: {
                    select: {
                      catalog_tier: true,
                      total_follows: true,
                    }
                  }
                }
              });

              if (source) {
                matchedCount++;
                
                // Update sync priority to HOT for active series
                await prisma.seriesSource.update({
                  where: { id: source.id },
                  data: {
                    next_check_at: new Date(),
                    sync_priority: 'HOT',
                  }
                });

                // Enqueue sync job via gatekeeper
                const enqueued = await CrawlGatekeeper.enqueueIfAllowed(
                  source.id,
                  source.series?.catalog_tier || 'C',
                  'DISCOVERY'
                );
                
                if (enqueued) {
                  enqueuedCount++;
                }
              }
            } catch (error) {
              errorCount++;
              console.error(`[LatestFeed][${jobId}] Error processing update from ${name}:`, error);
            }
          }));
        }

        console.log(`[LatestFeed][${jobId}] ${name}: ${matchedCount}/${limitedUpdates.length} matched, ${enqueuedCount} enqueued, ${errorCount} errors`);

        return { 
          name, 
          total: limitedUpdates.length, 
          matched: matchedCount,
          enqueued: enqueuedCount,
          errors: errorCount
        };
      } catch (error) {
        console.error(`[LatestFeed][${jobId}] Failed to scrape ${name}:`, error);
        return { name, total: 0, matched: 0, enqueued: 0, errors: 1 };
      }
    })
  );

  const summary = results
    .filter((r): r is PromiseFulfilledResult<LatestFeedResult | null> => 
      r.status === 'fulfilled' && r.value !== null
    )
    .map(r => r.value);

  const totalMatched = summary.reduce((acc, s) => acc + (s?.matched || 0), 0);
  const totalEnqueued = summary.reduce((acc, s) => acc + (s?.enqueued || 0), 0);
  const totalErrors = summary.reduce((acc, s) => acc + (s?.errors || 0), 0);

  console.log(`[LatestFeed][${jobId}] Discovery complete: ${totalMatched} matched, ${totalEnqueued} enqueued, ${totalErrors} errors`);
  
  return {
    summary,
    totalMatched,
    totalEnqueued,
    totalErrors
  };
}
