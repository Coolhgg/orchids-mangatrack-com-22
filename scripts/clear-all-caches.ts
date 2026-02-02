import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const environment = process.env.NODE_ENV || 'development';
const prefixes = [
  `mangatrack:${environment}:`,
  'orchid:search:',
  'mangatrack:development:',
  'mangatrack:production:',
  'mangatrack:test:',
  'bull:',
  'bullmq:',
  'sync:',
  'ratelimit:',
  'cache:',
  'session:'
];

async function clearAllCaches() {
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
  });
  console.log(`[Cache] Connecting to Redis...`);

  try {
    await redis.ping();
    console.log('[Cache] Redis connection successful');

    for (const prefix of prefixes) {
      const pattern = `${prefix}*`;
      console.log(`[Cache] Searching for keys with pattern: ${pattern}`);
      
      let cursor = '0';
      let totalDeleted = 0;
      
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        
        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');
      
      if (totalDeleted > 0) {
        console.log(`[Cache] Deleted ${totalDeleted} keys for prefix: ${prefix}`);
      }
    }

    console.log('[Cache] Clearing BullMQ queue data...');
    const queuePatterns = ['*:wait', '*:active', '*:delayed', '*:completed', '*:failed', '*:paused', '*:meta', '*:stalled-check', '*:events', '*:id', '*:repeat'];
    for (const suffix of queuePatterns) {
      const pattern = `*${suffix}`;
      let cursor = '0';
      let totalDeleted = 0;
      
      do {
        const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
        cursor = nextCursor;
        
        if (keys.length > 0) {
          await redis.del(...keys);
          totalDeleted += keys.length;
        }
      } while (cursor !== '0');
      
      if (totalDeleted > 0) {
        console.log(`[Cache] Deleted ${totalDeleted} keys matching: ${pattern}`);
      }
    }

    console.log('[Cache] Flushing entire Redis database...');
    await redis.flushdb();
    console.log('[Cache] Database flushed (FLUSHDB) - all data cleared');

  } catch (error) {
    console.error('[Cache] Error clearing Redis cache:', error);
  } finally {
    await redis.quit();
    console.log('[Cache] Redis connection closed.');
  }
}

clearAllCaches().catch(console.error);
