/**
 * k6 Load Testing Script for MangaTrack API
 * 
 * Prerequisites:
 * 1. Install k6: https://k6.io/docs/getting-started/installation/
 * 2. Set BASE_URL environment variable (defaults to http://localhost:3000)
 * 
 * Usage:
 * - Smoke test: k6 run --vus 5 --duration 30s load-tests/api-load-test.js
 * - Load test: k6 run load-tests/api-load-test.js
 * - Stress test: k6 run --vus 100 --duration 5m load-tests/api-load-test.js
 * 
 * With custom base URL:
 * - K6_BASE_URL=https://your-app.com k6 run load-tests/api-load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('error_rate');
const rateLimited = new Counter('rate_limited');
const apiLatency = new Trend('api_latency');

// Configuration
const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';

// Test options
export const options = {
  // Stages define the load profile
  stages: [
    { duration: '30s', target: 10 },   // Ramp up to 10 users
    { duration: '1m', target: 20 },    // Stay at 20 users
    { duration: '30s', target: 50 },   // Spike to 50 users
    { duration: '1m', target: 50 },    // Stay at 50 users
    { duration: '30s', target: 0 },    // Ramp down
  ],
  
  // Thresholds define pass/fail criteria
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests must complete within 2s
    http_req_failed: ['rate<0.1'],     // Less than 10% of requests can fail
    error_rate: ['rate<0.15'],          // Custom error rate threshold
  },
  
  // Other options
  noConnectionReuse: false,
  userAgent: 'K6LoadTest/1.0',
};

// Setup function (runs once before tests)
export function setup() {
  console.log(`Testing against: ${BASE_URL}`);
  
  // Verify the server is reachable
  const healthCheck = http.get(`${BASE_URL}/api/health`);
  if (healthCheck.status !== 200) {
    throw new Error(`Server not reachable: ${healthCheck.status}`);
  }
  
  return {
    baseUrl: BASE_URL,
    startTime: Date.now(),
  };
}

// Main test function
export default function(data) {
  const baseUrl = data.baseUrl;
  
  // Group: Health Check
  group('Health Check', () => {
    const res = http.get(`${baseUrl}/api/health`);
    
    check(res, {
      'health status is 200': (r) => r.status === 200,
      'health response has status': (r) => {
        try {
          return JSON.parse(r.body).status === 'ok';
        } catch {
          return false;
        }
      },
    });
    
    apiLatency.add(res.timings.duration);
    errorRate.add(res.status !== 200);
    
    if (res.status === 429) {
      rateLimited.add(1);
    }
  });
  
  sleep(0.5);
  
  // Group: Public Pages
  group('Public Pages', () => {
    // Landing page
    const landingRes = http.get(`${baseUrl}/`);
    check(landingRes, {
      'landing page loads': (r) => r.status === 200,
      'landing page has content': (r) => r.body.length > 0,
    });
    
    apiLatency.add(landingRes.timings.duration);
    errorRate.add(landingRes.status !== 200);
    
    sleep(0.3);
    
    // Login page
    const loginRes = http.get(`${baseUrl}/login`);
    check(loginRes, {
      'login page loads': (r) => r.status === 200,
    });
    
    apiLatency.add(loginRes.timings.duration);
    errorRate.add(loginRes.status !== 200);
  });
  
  sleep(0.5);
  
  // Group: Series API
  group('Series API', () => {
    // Browse series (public or auth-required)
    const browseRes = http.get(`${baseUrl}/api/series/browse?limit=10`);
    check(browseRes, {
      'browse returns valid response': (r) => [200, 401].includes(r.status),
      'browse response is fast': (r) => r.timings.duration < 2000,
    });
    
    apiLatency.add(browseRes.timings.duration);
    errorRate.add(![200, 401].includes(browseRes.status));
    
    if (browseRes.status === 429) {
      rateLimited.add(1);
    }
    
    sleep(0.3);
    
    // Search series
    const searchTerms = ['naruto', 'one piece', 'attack', 'dragon', 'hero'];
    const searchTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
    
    const searchRes = http.get(`${baseUrl}/api/series/search?q=${searchTerm}&limit=5`);
    check(searchRes, {
      'search returns valid response': (r) => [200, 401].includes(r.status),
      'search response is fast': (r) => r.timings.duration < 3000,
    });
    
    apiLatency.add(searchRes.timings.duration);
    errorRate.add(![200, 401].includes(searchRes.status));
    
    if (searchRes.status === 429) {
      rateLimited.add(1);
    }
  });
  
  sleep(0.5);
  
  // Group: Protected API (should return 401)
  group('Protected API (Auth Check)', () => {
    const endpoints = [
      '/api/library',
      '/api/notifications',
      '/api/feed/activity',
      '/api/users/me',
    ];
    
    for (const endpoint of endpoints) {
      const res = http.get(`${baseUrl}${endpoint}`);
      check(res, {
        'protected endpoint returns 401': (r) => r.status === 401,
      });
      
      apiLatency.add(res.timings.duration);
      // 401 is expected, not an error
      errorRate.add(res.status !== 401);
      
      if (res.status === 429) {
        rateLimited.add(1);
      }
      
      sleep(0.1);
    }
  });
  
  sleep(0.5);
  
  // Group: Leaderboard
  group('Leaderboard', () => {
    const res = http.get(`${baseUrl}/api/leaderboard`);
    check(res, {
      'leaderboard returns valid response': (r) => [200, 401].includes(r.status),
    });
    
    apiLatency.add(res.timings.duration);
    errorRate.add(![200, 401].includes(res.status));
    
    if (res.status === 429) {
      rateLimited.add(1);
    }
  });
  
  sleep(1);
}

// Teardown function (runs once after all tests)
export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log(`Test completed in ${duration.toFixed(2)} seconds`);
}

// Custom summary
export function handleSummary(data) {
  const summary = {
    timestamp: new Date().toISOString(),
    baseUrl: BASE_URL,
    duration: data.state.testRunDurationMs,
    vus: data.metrics.vus?.values?.max || 0,
    iterations: data.metrics.iterations?.values?.count || 0,
    requests: data.metrics.http_reqs?.values?.count || 0,
    failedRequests: data.metrics.http_req_failed?.values?.passes || 0,
    avgLatency: data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0,
    p95Latency: data.metrics.http_req_duration?.values['p(95)']?.toFixed(2) || 0,
    rateLimited: data.metrics.rate_limited?.values?.count || 0,
    errorRate: ((data.metrics.error_rate?.values?.rate || 0) * 100).toFixed(2) + '%',
  };
  
  return {
    'load-tests/results/summary.json': JSON.stringify(summary, null, 2),
    stdout: textSummary(data, { indent: ' ', enableColors: true }),
  };
}

// Text summary helper
function textSummary(data, opts) {
  const lines = [
    '',
    '█████████████████████████████████████████████████████',
    '█  MANGATRACK LOAD TEST RESULTS                        █',
    '█████████████████████████████████████████████████████',
    '',
    `  Base URL:        ${BASE_URL}`,
    `  Duration:        ${(data.state.testRunDurationMs / 1000).toFixed(2)}s`,
    `  Virtual Users:   ${data.metrics.vus?.values?.max || 0} max`,
    `  Iterations:      ${data.metrics.iterations?.values?.count || 0}`,
    '',
    '  HTTP Metrics:',
    `    Total Requests:  ${data.metrics.http_reqs?.values?.count || 0}`,
    `    Failed Requests: ${data.metrics.http_req_failed?.values?.passes || 0}`,
    `    Avg Latency:     ${data.metrics.http_req_duration?.values?.avg?.toFixed(2) || 0}ms`,
    `    P95 Latency:     ${data.metrics.http_req_duration?.values['p(95)']?.toFixed(2) || 0}ms`,
    `    Max Latency:     ${data.metrics.http_req_duration?.values?.max?.toFixed(2) || 0}ms`,
    '',
    '  Rate Limiting:',
    `    Rate Limited:    ${data.metrics.rate_limited?.values?.count || 0} requests`,
    '',
    '  Error Rate:      ' + ((data.metrics.error_rate?.values?.rate || 0) * 100).toFixed(2) + '%',
    '',
    '█████████████████████████████████████████████████████',
    '',
  ];
  
  return lines.join('\n');
}
