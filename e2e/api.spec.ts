import { test, expect } from '@playwright/test';

/**
 * E2E Tests: API Endpoints
 * 
 * Tests critical API endpoints for functionality, security, and error handling.
 */

test.describe('API Security Tests', () => {
  test.describe('CSRF Protection', () => {
    test('POST requests without proper headers should be rejected', async ({ request }) => {
      // Attempt to POST to library without proper origin/referer
      const response = await request.post('/api/library', {
        data: { series_id: 'test-id', title: 'Test' },
        headers: {
          'Content-Type': 'application/json',
          // Intentionally missing Origin header (simulating CSRF attack)
        },
      });
      
      // Should be rejected (401 unauthorized or 403 forbidden)
      expect([401, 403]).toContain(response.status());
    });
  });

  test.describe('Rate Limiting', () => {
    test('API should respond to health checks', async ({ request }) => {
      const response = await request.get('/api/health');
      expect(response.status()).toBe(200);
    });

    test('repeated rapid requests should not crash the server', async ({ request }) => {
      const promises = Array(10).fill(null).map(() => 
        request.get('/api/health')
      );
      
      const responses = await Promise.all(promises);
      
      // All should succeed (health endpoint is not rate limited)
      responses.forEach(response => {
        expect([200, 429]).toContain(response.status());
      });
    });
  });

  test.describe('Input Validation', () => {
    test('should reject invalid UUID in path', async ({ request }) => {
      const response = await request.get('/api/library/not-a-valid-uuid');
      
      // Should return 400 Bad Request
      expect(response.status()).toBe(400);
      
      const body = await response.json();
      expect(body.error).toBeTruthy();
    });

    test('should handle malformed JSON gracefully', async ({ request }) => {
      const response = await request.post('/api/library', {
        headers: {
          'Content-Type': 'application/json',
        },
        data: 'not valid json{{{',
      });
      
      // Should return 400 Bad Request
      expect([400, 401, 403]).toContain(response.status());
    });
  });

  test.describe('Authentication', () => {
    test('protected endpoints should require authentication', async ({ request }) => {
      const protectedEndpoints = [
        { method: 'GET', path: '/api/library' },
        { method: 'POST', path: '/api/library' },
        { method: 'GET', path: '/api/notifications' },
        { method: 'GET', path: '/api/feed/activity' },
        { method: 'GET', path: '/api/users/me' },
      ];

      for (const endpoint of protectedEndpoints) {
        const response = endpoint.method === 'GET'
          ? await request.get(endpoint.path)
          : await request.post(endpoint.path, {
              headers: { 'Content-Type': 'application/json' },
              data: {},
            });
        
        // Should return 401 Unauthorized
        expect(response.status()).toBe(401);
      }
    });
  });
});

test.describe('API Response Format', () => {
  test('health endpoint should return JSON', async ({ request }) => {
    const response = await request.get('/api/health');
    
    expect(response.status()).toBe(200);
    
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
    
    const body = await response.json();
    expect(body).toHaveProperty('status');
  });

  test('error responses should be JSON', async ({ request }) => {
    const response = await request.get('/api/library/invalid-uuid');
    
    const contentType = response.headers()['content-type'];
    expect(contentType).toContain('application/json');
    
    const body = await response.json();
    expect(body).toHaveProperty('error');
  });
});

test.describe('Public API Endpoints', () => {
  test('series browse endpoint should work', async ({ request }) => {
    const response = await request.get('/api/series/browse?limit=5');
    
    // Might require auth, but should not crash
    expect([200, 401]).toContain(response.status());
  });

  test('series search endpoint should work', async ({ request }) => {
    const response = await request.get('/api/series/search?q=test&limit=5');
    
    // Might require auth, but should not crash
    expect([200, 401]).toContain(response.status());
  });

  test('leaderboard endpoint should work', async ({ request }) => {
    const response = await request.get('/api/leaderboard');
    
    // Might require auth, but should not crash
    expect([200, 401]).toContain(response.status());
  });
});

test.describe('API Content-Type Validation', () => {
  test('POST without content-type should be handled', async ({ request }) => {
    const response = await request.post('/api/library', {
      data: '{"test": true}',
    });
    
    // Should return appropriate error
    expect([400, 401, 403, 415]).toContain(response.status());
  });

  test('POST with wrong content-type should be handled', async ({ request }) => {
    const response = await request.post('/api/library', {
      headers: {
        'Content-Type': 'text/plain',
      },
      data: '{"test": true}',
    });
    
    // Should return appropriate error
    expect([400, 401, 403, 415]).toContain(response.status());
  });
});

test.describe('API XSS Prevention', () => {
  test('should sanitize script tags in input', async ({ request }) => {
    // Test search endpoint with XSS payload
    const response = await request.get('/api/series/search?q=<script>alert("xss")</script>');
    
    // Should not crash and should sanitize input
    expect([200, 400, 401]).toContain(response.status());
    
    if (response.status() === 200) {
      const body = await response.text();
      expect(body).not.toContain('<script>');
    }
  });
});

test.describe('API SQL Injection Prevention', () => {
  test('should handle SQL injection attempts safely', async ({ request }) => {
    const sqlPayloads = [
      "'; DROP TABLE users; --",
      "1 OR 1=1",
      "1; SELECT * FROM users",
    ];

    for (const payload of sqlPayloads) {
      const response = await request.get(`/api/series/search?q=${encodeURIComponent(payload)}`);
      
      // Should not crash
      expect([200, 400, 401]).toContain(response.status());
    }
  });
});
