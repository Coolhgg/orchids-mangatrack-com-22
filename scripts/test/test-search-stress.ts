import { checkSourceQueue } from '@/lib/queues';
import { redis } from '@/lib/redis';
import axios from 'axios';

const SEARCH_QUEUE_HEALTH_THRESHOLD = 5000;
const API_URL = 'http://localhost:3000/api/series/search';

async function setup() {
  console.log('--- [Stress Test] Setup ---');
  const counts = await checkSourceQueue.getJobCounts('waiting');
  console.log(`Current queue depth: ${counts.waiting}`);
  
  if (counts.waiting > 0) {
    console.log('Clearing existing jobs for clean start...');
    await checkSourceQueue.drain();
  }
}

async function fillQueue(depth: number) {
  console.log(`--- [Stress Test] Filling queue to ${depth} jobs ---`);
  const jobs = [];
  for (let i = 0; i < depth; i++) {
    // Use unique jobIds to ensure they are all added
    jobs.push(checkSourceQueue.add('stress-test-job', { query: `stress-${i}` }, { jobId: `stress-${i}` }));
    
    if (i % 1000 === 0 && i > 0) {
      await Promise.all(jobs.splice(0, jobs.length));
      console.log(`Added ${i} jobs...`);
    }
  }
  await Promise.all(jobs);
  const counts = await checkSourceQueue.getJobCounts('waiting');
  console.log(`Queue depth after fill: ${counts.waiting}`);
}

async function runTests() {
  console.log('\n--- [Stress Test] Running Scenarios ---');

  // Test 1: Normal Search (Queue healthy)
  console.log('Scenario 1: Normal Search (Queue healthy)');
  await checkSourceQueue.drain();
  try {
    const res = await fetch(`${API_URL}?q=Stress Test Manga`);
    const data = await res.json();
    console.log(`Status: ${data.status}`);
    console.log(`Discovery State: ${data.discovery_state}`);
    console.log(`Results: ${data.results.length}`);
  } catch (e: any) {
    console.error(`Scenario 1 Failed: ${e.message}`);
  }

  // Test 2: Overloaded Search
  console.log('\nScenario 2: Overloaded Search (Queue > 5000)');
  await fillQueue(SEARCH_QUEUE_HEALTH_THRESHOLD + 10);
  try {
    const res = await fetch(`${API_URL}?q=New Overloaded Query`);
    const data = await res.json();
    console.log(`Status: ${data.status}`);
    console.log(`Discovery State: ${data.discovery_state}`);
    console.log(`Skip Reason: ${data.discovery_status === 'maintenance' ? 'Triggered' : 'Not Triggered'}`);
    console.log(`Message: ${data.message}`);
    
    // Confirm DB results still return if we search for our known manga
    const resDb = await fetch(`${API_URL}?q=Stress Test Manga`);
    const dataDb = await resDb.json();
    console.log(`Local Match during overload: ${dataDb.results.length > 0 ? 'SUCCESS' : 'FAILURE'}`);
    console.log(`Local Match Discovery State: ${dataDb.discovery_state}`);
  } catch (e: any) {
    console.error(`Scenario 2 Failed: ${e.message}`);
  }

  // Test 3: Cache Hit and Deduplication
  console.log('\nScenario 3: Cache Hit and Deduplication');
  // First call to cache it
  const q = 'Cache Test Query';
  await fetch(`${API_URL}?q=${q}`);
  const start = Date.now();
  const resCache = await fetch(`${API_URL}?q=${q}`);
  const dataCache = await resCache.json();
  const duration = Date.now() - start;
  console.log(`Cache Hit: ${dataCache.cache_hit === true ? 'SUCCESS' : 'FAILURE'}`);
  console.log(`Cache Response Time: ${duration}ms`);
}

async function cleanup() {
  console.log('\n--- [Stress Test] Cleanup ---');
  await checkSourceQueue.drain();
  console.log('Queue drained.');
  process.exit(0);
}

async function main() {
  try {
    await setup();
    await runTests();
  } catch (e) {
    console.error(e);
  } finally {
    await cleanup();
  }
}

main();
