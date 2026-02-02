import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_WORKER_URL || process.env.REDIS_URL;

if (!redisUrl) {
  console.error('REDIS_WORKER_URL or REDIS_URL not found in .env');
  process.exit(1);
}

const redis = new Redis(redisUrl);

async function listKeys() {
  try {
    const patterns = [
      'mangatrack:production:sync-source:*',
      'mangatrack::production:sync-source:*', // user's typo
      'mangatrack:development:sync-source:*'
    ];

    for (const pattern of patterns) {
      console.log(`Checking pattern: ${pattern}`);
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        console.log(`Found ${keys.length} keys:`);
        keys.forEach(key => console.log(key));
      } else {
        console.log('No keys found for this pattern.');
      }
      console.log('---');
    }
  } catch (error) {
    console.error('Error listing keys:', error);
  } finally {
    await redis.quit();
  }
}

listKeys();
