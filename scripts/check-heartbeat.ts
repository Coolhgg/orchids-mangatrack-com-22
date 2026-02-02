import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_WORKER_URL;

if (!redisUrl) {
  console.error('REDIS_WORKER_URL is not set');
  process.exit(1);
}

const redis = new Redis(redisUrl);

async function checkHeartbeat() {
  try {
    const heartbeat = await redis.get('mangatrack:production:workers:heartbeat');
    console.log(`Heartbeat: ${heartbeat}`);
  } catch (error) {
    console.error('Error fetching heartbeat:', error);
  } finally {
    await redis.quit();
  }
}

checkHeartbeat();
