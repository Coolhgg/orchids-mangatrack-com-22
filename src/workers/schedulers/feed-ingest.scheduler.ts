/**
 * Feed Ingest Scheduler
 * 
 * Schedules feed ingestion jobs based on tier configuration:
 * - Tier A (MangaDex latest): Every 30 minutes
 * - Tier B (MangaUpdates): Every 2 hours  
 * - Tier C (Official sources - MangaPlus, etc.): Every 6 hours
 * 
 * Rate limits are respected per-source to avoid API bans.
 */

import { feedIngestQueue, getTotalQueueDepth } from '@/lib/queues';
import type { FeedIngestSource, FeedIngestTier } from '../processors/feed-ingest.processor';

interface FeedScheduleConfig {
  source: FeedIngestSource;
  tier: FeedIngestTier;
  intervalMs: number;
  limit: number;
  enabled: boolean;
}

const FEED_SCHEDULE_CONFIGS: FeedScheduleConfig[] = [
  {
    source: 'mangadex',
    tier: 'A',
    intervalMs: 30 * 60 * 1000,
    limit: 100,
    enabled: true,
  },
  {
    source: 'mangaupdates',
    tier: 'B',
    intervalMs: 2 * 60 * 60 * 1000,
    limit: 50,
    enabled: true,
  },
];

const lastRun: Map<string, number> = new Map();

function getScheduleKey(config: FeedScheduleConfig): string {
  return `${config.source}:${config.tier}`;
}

function shouldRun(config: FeedScheduleConfig, now: number): boolean {
  if (!config.enabled) return false;
  
  const key = getScheduleKey(config);
  const last = lastRun.get(key) || 0;
  
  return now - last >= config.intervalMs;
}

export async function runFeedIngestScheduler(): Promise<{
  scheduled: number;
  skipped: number;
  paused: boolean;
}> {
  const now = Date.now();
  let scheduled = 0;
  let skipped = 0;

  const { total, isOverloaded, isCritical } = await getTotalQueueDepth();
  
  if (isCritical) {
    console.warn(`[FeedIngestScheduler] Queue depth critical (${total}), skipping all feed ingests`);
    return { scheduled: 0, skipped: FEED_SCHEDULE_CONFIGS.length, paused: true };
  }

  if (isOverloaded) {
    console.warn(`[FeedIngestScheduler] Queue overloaded (${total}), only running Tier A jobs`);
  }

  for (const config of FEED_SCHEDULE_CONFIGS) {
    if (isOverloaded && config.tier !== 'A') {
      skipped++;
      continue;
    }

    if (!shouldRun(config, now)) {
      skipped++;
      continue;
    }

    try {
      // BullMQ job IDs cannot contain colons - use dashes instead
      const jobId = `feed-ingest-${config.source}-${config.tier}-${now}`;
      
      await feedIngestQueue.add(
        `${config.source}-${config.tier}`,
        {
          source: config.source,
          tier: config.tier,
          limit: config.limit,
        },
        {
          jobId,
          removeOnComplete: true,
          removeOnFail: { count: 10, age: 86400 },
        }
      );

      lastRun.set(getScheduleKey(config), now);
      scheduled++;

      console.log(`[FeedIngestScheduler] Scheduled ${config.source} Tier ${config.tier} ingest`);
    } catch (error) {
      console.error(`[FeedIngestScheduler] Failed to schedule ${config.source}:`, error);
      skipped++;
    }
  }

  return { scheduled, skipped, paused: false };
}

export async function getLastRunTimes(): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const [key, time] of lastRun.entries()) {
    result[key] = time;
  }
  return result;
}
