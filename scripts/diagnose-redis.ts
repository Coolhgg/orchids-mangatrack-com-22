import Redis from 'ioredis';
import 'dotenv/config';

async function testConnection(name: string, url: string) {
  console.log(`\n--- Testing ${name} ---`);
  
  const trials = [
    { name: 'Standard (No TLS)', options: {} },
    { name: 'TLS enabled', options: { tls: {} } }
  ];

  for (const trial of trials) {
    console.log(`Trial: ${trial.name}...`);
    // Pass options separately from URL to ensure lazyConnect works as expected
    const urlObj = new URL(url);
    const client = new Redis({
      host: urlObj.hostname,
      port: parseInt(urlObj.port),
      password: urlObj.password,
      username: urlObj.username,
      ...trial.options,
      lazyConnect: true,
      connectTimeout: 5000,
      maxRetriesPerRequest: 0
    });

    try {
      console.log(`Connecting to ${urlObj.hostname}:${urlObj.port}...`);
      await client.connect();
      const res = await client.ping();
      console.log(`SUCCESS: ${trial.name} - PING result: ${res}`);
      console.log(`Host: ${client.options.host}, Port: ${client.options.port}`);
      await client.quit();
      return; 
    } catch (err: any) {
      console.log(`FAILED: ${trial.name} - Error: ${err.message}`);
      try { client.disconnect(); } catch {}
    }
  }
}

async function run() {
  const apiUrl = process.env.REDIS_API_URL || '';
  const workerUrl = process.env.REDIS_WORKER_URL || '';

  if (apiUrl) await testConnection('REDIS_API', apiUrl);
  if (workerUrl) await testConnection('REDIS_WORKER', workerUrl);
  
  process.exit(0);
}

run();
