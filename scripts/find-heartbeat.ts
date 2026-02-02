import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_WORKER_URL;

if (!redisUrl) {
  console.error('REDIS_WORKER_URL is not set');
  process.exit(1);
}

const redis = new Redis(redisUrl);

async function findHeartbeat() {
  try {
    const keys = await redis.keys('mangatrack:*:workers:heartbeat');
    console.log('Found heartbeat keys:', keys);
    
    for (const key of keys) {
      const val = await redis.get(key);
      console.log(`${key}: ${val}`);
    }
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await redis.quit();
  }
}

findHeartbeat();
