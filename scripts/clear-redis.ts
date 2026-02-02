import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

async function clearRedisKeys() {
  const url = process.env.REDIS_WORKER_URL;
  if (!url) {
    console.error('REDIS_WORKER_URL not found');
    process.exit(1);
  }

  const redis = new Redis(url);
  
  const keys = [
    'mangatrack:production:workers:global',
    'mangatrack:production:lock:scheduler:master',
    'mangatrack:production:workers:heartbeat'
  ];

  try {
    for (const key of keys) {
      const result = await redis.del(key);
      console.log(`Deleted ${key}: ${result}`);
    }
  } catch (error) {
    console.error('Error deleting keys:', error);
  } finally {
    await redis.quit();
  }
}

clearRedisKeys();
