#!/usr/bin/env node
const Redis = require('ioredis');

const REDIS_URL = process.env.REDIS_URL || 'redis://default:3lBRyo3PdnMoQqXV8a6PHRCwNAa3R7lv@redis-16672.c8.us-east-1-2.ec2.cloud.redislabs.com:16672';
const PREFIX = 'mangatrack:development:';

async function clearAllCaches() {
  const redis = new Redis(REDIS_URL);
  
  console.log('Connecting to Redis...');
  await new Promise(resolve => redis.once('ready', resolve));
  console.log('Connected!\n');

  const stats = {
    locks: 0,
    caches: 0,
    bullmq: 0,
    heartbeat: 0,
    other: 0,
  };

  console.log('=== CLEARING LOCKS ===');
  const lockPatterns = [
    `${PREFIX}workers:global`,
    `${PREFIX}scheduler:lock`,
    `${PREFIX}lock:scheduler:master`,
    `${PREFIX}mangaupdates:poller:lock`,
    `${PREFIX}lock:*`,
  ];

  for (const pattern of lockPatterns) {
    if (pattern.includes('*')) {
      const keys = await redis.keys(pattern);
      for (const key of keys) {
        await redis.del(key);
        console.log(`  [LOCK] Deleted: ${key}`);
        stats.locks++;
      }
    } else {
      const exists = await redis.exists(pattern);
      if (exists) {
        await redis.del(pattern);
        console.log(`  [LOCK] Deleted: ${pattern}`);
        stats.locks++;
      }
    }
  }

  console.log('\n=== CLEARING HEARTBEAT ===');
  const heartbeatKey = `${PREFIX}workers:heartbeat`;
  if (await redis.exists(heartbeatKey)) {
    await redis.del(heartbeatKey);
    console.log(`  [HEARTBEAT] Deleted: ${heartbeatKey}`);
    stats.heartbeat++;
  }

  console.log('\n=== CLEARING CACHES ===');
  const cachePatterns = [
    `${PREFIX}cache:*`,
    `${PREFIX}feed:*`,
    `${PREFIX}ratelimit:*`,
    `${PREFIX}search:*`,
    `${PREFIX}series:*`,
    `${PREFIX}user:*`,
    `${PREFIX}manga:*`,
    `${PREFIX}api:*`,
  ];

  for (const pattern of cachePatterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      console.log(`  Found ${keys.length} keys matching ${pattern}`);
      for (const key of keys) {
        await redis.del(key);
        stats.caches++;
      }
    }
  }

  console.log('\n=== CLEARING BULLMQ QUEUES ===');
  const bullPatterns = [
    `${PREFIX}bull:*:lock`,
    `${PREFIX}bull:*:stalled`,
    `${PREFIX}bull:*:stalled-check`,
    `${PREFIX}bull:*:completed`,
    `${PREFIX}bull:*:failed`,
    `${PREFIX}bull:*:delayed`,
    `${PREFIX}bull:*:waiting`,
    `${PREFIX}bull:*:active`,
    `${PREFIX}bull:*:paused`,
    `${PREFIX}bull:*:wait`,
    `${PREFIX}bull:*:id`,
    `${PREFIX}bull:*:meta`,
    `${PREFIX}bull:*:events`,
    `${PREFIX}bull:*:repeat`,
    `${PREFIX}bull:*:*`,
  ];

  for (const pattern of bullPatterns) {
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      console.log(`  Found ${keys.length} keys matching ${pattern}`);
      for (const key of keys) {
        await redis.del(key);
        stats.bullmq++;
      }
    }
  }

  console.log('\n=== SUMMARY ===');
  console.log(`  Locks deleted:     ${stats.locks}`);
  console.log(`  Heartbeat deleted: ${stats.heartbeat}`);
  console.log(`  Caches deleted:    ${stats.caches}`);
  console.log(`  BullMQ deleted:    ${stats.bullmq}`);
  console.log(`  TOTAL:             ${stats.locks + stats.heartbeat + stats.caches + stats.bullmq}`);

  await redis.quit();
  console.log('\nDone! All caches and stale data cleared.');
}

clearAllCaches().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
