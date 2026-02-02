import { redisApi, redisWorker, waitForRedis } from '../src/lib/redis';

async function verify() {
  console.log('--- Forcing Redis Connections ---');
  
  try {
    console.log('Connecting to redisApi...');
    const apiReady = await waitForRedis(redisApi, 10000);
    console.log('redisApi ready status:', apiReady);
    if (apiReady) {
      const apiRes = await redisApi.ping();
      console.log('redisApi PING response:', apiRes);
    }
    
    console.log('Connecting to redisWorker...');
    const workerReady = await waitForRedis(redisWorker, 10000);
    console.log('redisWorker ready status:', workerReady);
    if (workerReady) {
      const workerRes = await redisWorker.ping();
      console.log('redisWorker PING response:', workerRes);
    }
  } catch (err) {
    console.error('Error during Redis connection/ping:', err);
  } finally {
    console.log('Waiting for event logs to flush...');
    await new Promise(resolve => setTimeout(resolve, 5000));
    process.exit(0);
  }
}

verify();
