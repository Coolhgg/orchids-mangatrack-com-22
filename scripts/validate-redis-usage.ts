import 'dotenv/config';
import Redis from 'ioredis';

const apiRedisUrl = process.env.REDIS_API_URL || process.env.REDIS_URL || 'redis://localhost:6379';
const workerRedisUrl = process.env.REDIS_WORKER_URL || process.env.REDIS_URL || 'redis://localhost:6379';

async function validate() {
  console.log('--- Redis Dual-Account Validation ---');
  console.log('API URL:', apiRedisUrl.replace(/:.*@/, ':***@'));
  console.log('Worker URL:', workerRedisUrl.replace(/:.*@/, ':***@'));

  const apiRedis = new Redis(apiRedisUrl);
  const workerRedis = new Redis(workerRedisUrl);

  try {
    const [apiInfo, workerInfo] = await Promise.all([
      apiRedis.info('clients'),
      workerRedis.info('clients')
    ]);

    const getCount = (info: string) => {
      const match = info.match(/connected_clients:(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    };

    const apiCount = getCount(apiInfo);
    const workerCount = getCount(workerInfo);

    console.log('\n--- Connection Counts ---');
    console.log(`Redis API Account:    ${apiCount} clients`);
    console.log(`Redis Worker Account: ${workerCount} clients`);

    console.log('\n--- Validation Results ---');
    if (apiRedisUrl === workerRedisUrl) {
      console.warn('WARNING: API and Worker are using the SAME Redis URL. Isolation not possible.');
    } else {
      console.log('SUCCESS: API and Worker are using DIFFERENT Redis accounts/URLs.');
    }

    if (apiCount >= 15) {
      console.warn('WARNING: API connection count is high (>= 15). Check for leaks.');
    } else {
      console.log('OK: API connection count is within expected range (< 15).');
    }

    if (workerCount > 30) {
        console.warn('WARNING: Worker connection count is high (> 30). Check for leaks.');
    } else {
        console.log('OK: Worker connection count is within expected range.');
    }

    // Check for cross-contamination
    const apiKeys = await apiRedis.keys('mangatrack:*:bull:*');
    const workerKeys = await workerRedis.keys('mangatrack:*:bull:*');

    console.log('\n--- Isolation Check ---');
    console.log(`BullMQ keys on API Redis:    ${apiKeys.length}`);
    console.log(`BullMQ keys on Worker Redis: ${workerKeys.length}`);

    if (apiKeys.length > 0) {
      console.error('ERROR: BullMQ keys found on API Redis! Isolation FAILED.');
    } else {
      console.log('SUCCESS: No BullMQ keys found on API Redis.');
    }

  } catch (error) {
    console.error('Validation failed:', error);
  } finally {
    apiRedis.disconnect();
    workerRedis.disconnect();
  }
}

validate();
