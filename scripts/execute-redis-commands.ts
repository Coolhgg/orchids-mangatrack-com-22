import { redisWorker, redisApi, waitForRedis } from '../src/lib/redis';

async function main() {
  console.log('--- Executing Redis Commands ---');

  console.log('Waiting for Redis Worker...');
  const workerReady = await waitForRedis(redisWorker, 10000);
  if (!workerReady) {
    console.error('Redis Worker failed to connect');
    process.exit(1);
  }

  const keysToDel = [
    'mangatrack:production:workers:global',
    'mangatrack:production:lock:scheduler:master',
    'mangatrack:production:workers:heartbeat'
  ];

  for (const key of keysToDel) {
    console.log(`Deleting ${key}...`);
    try {
      const result = await redisWorker.del(key);
      console.log(`Result: ${result}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`Failed to delete ${key}:`, message);
    }
  }

  console.log('Waiting for Redis API...');
  const apiReady = await waitForRedis(redisApi, 5000);
  if (!apiReady) {
     console.error('Redis API failed to connect');
  } else {
    console.log('Getting mangatrack:production:workers:heartbeat...');
    try {
      const heartbeat = await redisApi.get('mangatrack:production:workers:heartbeat');
      console.log('Heartbeat:', heartbeat);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Failed to get heartbeat:', message);
    }
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Execution failed:', err);
  process.exit(1);
});
