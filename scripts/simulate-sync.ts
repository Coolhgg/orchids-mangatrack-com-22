import 'dotenv/config';
import { syncSourceQueue } from '../src/lib/queues';
import { disconnectRedis } from '../src/lib/redis';

async function simulate() {
  const seriesSourceId = '16623417-0f26-469e-af15-e0ffd20633ef';
  console.log(`Adding sync job for source: ${seriesSourceId}`);
  
  const job = await syncSourceQueue.add(`sync-${seriesSourceId}`, {
    seriesSourceId,
  }, {
    priority: 1,
    attempts: 1,
  });

  console.log(`Job added: ${job.id}`);
  
  // Wait a bit for the worker to pick it up
  console.log('Waiting 5s for worker to process...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  await disconnectRedis();
  process.exit(0);
}

simulate().catch(console.error);
