/**
 * k6 Rate Limit Testing Script
 * 
 * Tests the rate limiting behavior of the API
 * 
 * Usage:
 * - k6 run load-tests/rate-limit-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';

const rateLimitHits = new Counter('rate_limit_hits');
const successRate = new Rate('success_rate');

const BASE_URL = __ENV.K6_BASE_URL || 'http://localhost:3000';

export const options = {
  scenarios: {
    // Scenario 1: Burst test - many requests in quick succession
    burst_test: {
      executor: 'per-vu-iterations',
      vus: 1,
      iterations: 100,
      maxDuration: '30s',
    },
    
    // Scenario 2: Distributed test - multiple users hitting same endpoint
    distributed_test: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
      startTime: '35s',
    },
  },
  
  thresholds: {
    rate_limit_hits: ['count>0'], // We expect to hit rate limits
  },
};

export default function() {
  const scenario = __ENV.K6_SCENARIO_NAME;
  
  if (scenario === 'burst_test') {
    // Rapid-fire requests to test rate limiting
    const res = http.get(`${BASE_URL}/api/health`);
    
    if (res.status === 429) {
      rateLimitHits.add(1);
      console.log(`Rate limited at iteration ${__ITER}`);
    }
    
    successRate.add(res.status === 200);
    
    // No sleep - we want to hit rate limits
  } else {
    // Normal distributed test
    const endpoints = [
      '/api/health',
      '/api/series/browse?limit=5',
      '/api/leaderboard',
    ];
    
    for (const endpoint of endpoints) {
      const res = http.get(`${BASE_URL}${endpoint}`);
      
      if (res.status === 429) {
        rateLimitHits.add(1);
      }
      
      successRate.add([200, 401].includes(res.status));
      
      sleep(0.1);
    }
    
    sleep(1);
  }
}

export function handleSummary(data) {
  const rateLimits = data.metrics.rate_limit_hits?.values?.count || 0;
  const total = data.metrics.http_reqs?.values?.count || 0;
  
  console.log('\n=== Rate Limit Test Results ===');
  console.log(`Total Requests: ${total}`);
  console.log(`Rate Limited: ${rateLimits}`);
  console.log(`Rate Limit %: ${((rateLimits / total) * 100).toFixed(2)}%`);
  console.log('===============================\n');
  
  return {};
}
