/**
 * Image Proxy Load Test Script
 * 
 * Verifies that the image proxy handles bursts of requests efficiently
 * and that the rate limiter kicks in correctly.
 */

async function runLoadTest() {
  const PROXY_URL = 'http://localhost:3000/api/proxy/image?url='
  const TEST_IMAGE = encodeURIComponent('https://uploads.mangadex.org/covers/32d76d19-8a0d-4452-9ee6-8519979946e9/93c6dfd6-0c98-4c90-953e-257a315e96d9.jpg')
  
  const REQUEST_COUNT = 550 // 500 is the limit
  const CONCURRENCY = 20
  
  console.log(`Starting load test: ${REQUEST_COUNT} requests with concurrency ${CONCURRENCY}`)
  
  let successes = 0
  let rateLimited = 0
  let others = 0
  
  const startTime = Date.now()
  
  for (let i = 0; i < REQUEST_COUNT; i += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, REQUEST_COUNT - i) }).map(async () => {
      try {
        const res = await fetch(`${PROXY_URL}${TEST_IMAGE}`)
        if (res.status === 200) successes++
        else if (res.status === 429) rateLimited++
        else {
          others++
          // console.log(`Unexpected status: ${res.status}`)
        }
      } catch (err) {
        others++
      }
    })
    
    await Promise.all(batch)
  }
  
  const duration = Date.now() - startTime
  
  console.log('--- Load Test Results ---')
  console.log(`Total Requests: ${REQUEST_COUNT}`)
  console.log(`Successes (200): ${successes}`)
  console.log(`Rate Limited (429): ${rateLimited}`)
  console.log(`Others: ${others}`)
  console.log(`Duration: ${duration}ms`)
  console.log(`Throughput: ${(REQUEST_COUNT / (duration / 1000)).toFixed(2)} req/s`)
  
  if (rateLimited > 0) {
    console.log('✅ Rate limiting is working as expected.')
  } else if (successes === REQUEST_COUNT) {
    console.log('⚠️ Rate limiting did not trigger. Check if limit is > 500 or if test is too slow.')
  }
}

// In a real environment, this would be run with `node`
// runLoadTest()
console.log('Load test script created. Run with: node scripts/load-test-proxy.js')
