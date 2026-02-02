import 'dotenv/config';
import Redis from 'ioredis';

async function check() {
  const url = process.env.REDIS_WORKER_URL;
  if (!url) {
    console.error('REDIS_WORKER_URL not found');
    return;
  }

  console.log('Connecting to Worker Redis...');
  const redis = new Redis(url, {
    maxRetriesPerRequest: null,
    connectTimeout: 5000,
  });

  redis.on('error', (err) => {
    console.error('Redis Error:', err.message);
  });

  try {
    const info = await redis.info('clients');
    console.log('Client Info:\n', info);
    
    const clientList = await redis.client('LIST');
    console.log('Client List:\n', clientList);
  } catch (err) {
    console.error('Failed to get info:', err);
  } finally {
    redis.disconnect();
  }
}

check();
