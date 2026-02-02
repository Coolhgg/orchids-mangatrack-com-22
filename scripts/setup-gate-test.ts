
import { redis, REDIS_KEY_PREFIX } from '@/lib/redis';

async function setup() {
  const query = 'gateguesttest';
  const hash = Buffer.from(query).toString('base64').slice(0, 32);
  const heatKey = `${REDIS_KEY_PREFIX}search:heat:${hash}`;
  const heartbeatKey = `${REDIS_KEY_PREFIX}workers:heartbeat`;
  const cooldownKey = `${REDIS_KEY_PREFIX}cooldown:search:127.0.0.1:${hash}`;

  // 1. Mock workers online
  await redis.set(heartbeatKey, JSON.stringify({ timestamp: Date.now(), health: { status: 'healthy' } }), 'EX', 60);
  
  // 2. Clear heat for query
  await redis.del(heatKey);
  await redis.del(`${heatKey}:users`);
  
  // 3. Clear cooldown
  await redis.del(cooldownKey);

  // 4. Clear Cache
  const cacheKey = `${REDIS_KEY_PREFIX}search:cache:*`;
  let cursor = '0';
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', cacheKey);
    cursor = nextCursor;
    if (keys.length > 0) await redis.del(...keys);
  } while (cursor !== '0');

  console.log('Setup complete: workers online, heat cleared, cache cleared for "gateguesttest"');
}

setup().then(() => process.exit());
