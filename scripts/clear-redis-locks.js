const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://default:3lBRyo3PdnMoQqXV8a6PHRCwNAa3R7lv@redis-16672.c8.us-east-1-2.ec2.cloud.redislabs.com:16672';
const PREFIX = 'mangatrack:development:';

async function clearStaleLocks() {
  const redis = new Redis(REDIS_URL);
  
  console.log('Connecting to Redis...');
  await new Promise(resolve => redis.once('ready', resolve));
  console.log('Connected!');

  const lockPatterns = [
    `${PREFIX}workers:global`,
    `${PREFIX}scheduler:lock`,
    `${PREFIX}lock:scheduler:master`,
    `${PREFIX}mangaupdates:poller:lock`,
    `${PREFIX}workers:heartbeat`,
    `${PREFIX}lock:*`,
  ];

  let totalDeleted = 0;

  for (const pattern of lockPatterns) {
    if (pattern.includes('*')) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        console.log(`Found ${keys.length} keys matching ${pattern}`);
        for (const key of keys) {
          await redis.del(key);
          console.log(`  Deleted: ${key}`);
          totalDeleted++;
        }
      }
    } else {
      const exists = await redis.exists(pattern);
      if (exists) {
        await redis.del(pattern);
        console.log(`Deleted: ${pattern}`);
        totalDeleted++;
      }
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted} keys`);
  
  // Also clear any BullMQ stale locks
  const bullLocks = await redis.keys(`${PREFIX}bull:*:lock`);
  if (bullLocks.length > 0) {
    console.log(`\nFound ${bullLocks.length} BullMQ locks`);
    for (const key of bullLocks) {
      await redis.del(key);
      console.log(`  Deleted: ${key}`);
    }
  }

  await redis.quit();
  console.log('\nDone! Redis locks cleared.');
}

clearStaleLocks().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
