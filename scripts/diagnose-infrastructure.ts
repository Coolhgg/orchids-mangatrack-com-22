import 'dotenv/config';
import { areWorkersOnline, redisApi, redisWorker, waitForRedis, REDIS_KEY_PREFIX } from '../src/lib/redis';

async function diagnose() {
  console.log('--- Infrastructure Diagnosis ---');
  
  // 1. Check Redis API Connection
  const apiReady = await waitForRedis(redisApi, 5000);
  console.log(`Redis API Status: ${apiReady ? 'ONLINE' : 'OFFLINE'} (${redisApi.status})`);
  
  // 2. Check Redis Worker Connection
  const workerReady = await waitForRedis(redisWorker, 5000);
  console.log(`Redis Worker Status: ${workerReady ? 'ONLINE' : 'OFFLINE'} (${redisWorker.status})`);
  
  // 3. Check Worker Heartbeat
  const workersOnline = await areWorkersOnline();
  console.log(`Workers Status: ${workersOnline ? 'ONLINE (Heartbeat detected)' : 'OFFLINE (No heartbeat)'}`);
  
  if (!workersOnline) {
    const heartbeatKey = `${REDIS_KEY_PREFIX}workers:heartbeat`;
    const rawHeartbeat = await redisApi.get(heartbeatKey);
    console.log(`Raw Heartbeat Key (${heartbeatKey}): ${rawHeartbeat || 'NULL'}`);
  }
  
  process.exit(0);
}

diagnose().catch(err => {
  console.error('Diagnosis failed:', err);
  process.exit(1);
});
