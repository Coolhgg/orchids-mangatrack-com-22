
import { redis, REDIS_KEY_PREFIX } from '@/lib/redis';
import { consumeSearchQuota } from '@/lib/search-cache';

async function runTests() {
  console.log('--- Quota Tests ---');
  const testIp = '127.0.0.1';
  const guestQuotaKey = `${REDIS_KEY_PREFIX}guest:quota:${testIp}`;
  
  // Reset quota
  await redis.del(guestQuotaKey);
  console.log('Reset guest quota');

  // Consume 5 quotas
  for (let i = 1; i <= 5; i++) {
    const count = await consumeSearchQuota(testIp, 'guest', 5);
    console.log(`Search ${i}: count = ${count}`);
  }

  // Attempt 6th search
  const count6 = await consumeSearchQuota(testIp, 'guest', 5);
  console.log(`Search 6: count = ${count6} (Expect -1)`);

  console.log('\n--- Guest Repeat (Gating) Tests ---');
  // I will use curl for this to hit the real route logic
}

runTests().then(() => process.exit());
