require('dotenv').config();
const Redis = require('ioredis');

const redisUrl = process.env.REDIS_URL;
console.log('Testing Redis connection to:', redisUrl ? 'URL provided' : 'No URL found');

if (!redisUrl) {
  console.error('REDIS_URL not found in .env');
  process.exit(1);
}

const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 1,
  connectTimeout: 5000,
});

redis.on('connect', () => {
  console.log('Successfully connected to Redis!');
  redis.ping().then(result => {
    console.log('Ping result:', result);
    process.exit(0);
  }).catch(err => {
    console.error('Ping failed:', err);
    process.exit(1);
  });
});

redis.on('error', (err) => {
  console.error('Redis connection error:', err);
  process.exit(1);
});
