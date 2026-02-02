import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

async function clearCache() {
  const redis = new Redis(redisUrl);
  // Clear all search results, pending searches, and external search dedup keys
  const patterns = [
    'orchid:search:results:*',
    'orchid:search:pending:*',
    'orchid:search:external:*',
    'orchid:search:quota:*'
  ];
  
  for (const pattern of patterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      console.log(`Clearing ${keys.length} keys for pattern ${pattern}...`);
      await redis.del(...keys);
    }
  }
  
  console.log('Cache cleared.');
  await redis.quit();
}

clearCache().catch(console.error);
