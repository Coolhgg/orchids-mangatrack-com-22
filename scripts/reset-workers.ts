import { prisma } from '../src/lib/prisma';
import { redisWorker, redisApi, REDIS_KEY_PREFIX } from '../src/lib/redis';
import 'dotenv/config';

async function main() {
  console.log('--- System Reset Tool ---');

  // 1. Clear Redis Queues
  console.log('Attempting to clear Redis queues and locks...');
  try {
    await redisWorker.connect();
    const keys = await redisWorker.keys(`${REDIS_KEY_PREFIX}*`);
    if (keys.length > 0) {
      await redisWorker.del(...keys);
      console.log(`Cleared ${keys.length} keys from Redis`);
    } else {
      console.log('No keys found to clear in Redis');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Skipping Redis clear due to error (likely connection limit):', message);
  }

  // 2. Reset Database State for Syncing
  console.log('Resetting SeriesSource sync status...');
  const resetSources = await prisma.seriesSource.updateMany({
    data: {
      next_check_at: new Date(),
      failure_count: 0,
      sync_priority: 'HOT'
    }
  });
  console.log(`Reset ${resetSources.count} sources to HOT and due now`);

  // 3. Reset Search Cooldowns (Redis)
  console.log('Resetting search cooldowns in Redis...');
  try {
    const searchKeys = await redisApi.keys(`${REDIS_KEY_PREFIX}search:*`);
    const heatKeys = await redisApi.keys(`${REDIS_KEY_PREFIX}heat:*`);
    const allSearchKeys = [...searchKeys, ...heatKeys];
    
    if (allSearchKeys.length > 0) {
      await redisApi.del(...allSearchKeys);
      console.log(`Cleared ${allSearchKeys.length} search-related keys from Redis`);
    } else {
      console.log('No search keys found to clear');
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn('Failed to clear search keys:', message);
  }

  // 4. Reset Cover Refresh
  console.log('Resetting cover refresh status...');
  const resetSeries = await prisma.series.updateMany({
    data: {
      last_synced_at: null
    }
  });
  console.log(`Reset ${resetSeries.count} series for metadata refresh`);

  console.log('--- Reset Complete ---');
  process.exit(0);
}

main().catch(err => {
  console.error('Reset failed:', err);
  process.exit(1);
});
