import { getDeferredQueryHashes } from '../src/lib/search-cache';
import { disconnectRedis } from '../src/lib/redis';

async function test() {
  console.log('Testing getDeferredQueryHashes...');
  try {
    const hashes = await getDeferredQueryHashes(5);
    console.log('Success! Hashes:', hashes);
  } catch (err) {
    console.error('Failed!', err);
    process.exit(1);
  } finally {
    await disconnectRedis();
  }
}

test();
