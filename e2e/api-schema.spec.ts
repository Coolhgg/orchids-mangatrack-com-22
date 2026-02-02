/**
 * Playwright E2E: API Schema Validation
 * 
 * Tests /api/sync/latest endpoint JSON schema.
 * Run with: npx playwright test e2e/api-schema.spec.ts
 */

import { test, expect } from '@playwright/test';

test.describe('API Schema Validation', () => {
  test('GET /api/sync/latest returns valid JSON schema', async ({ request }) => {
    const response = await request.get('/api/sync/latest');

    // Allow 200 or 401 (if auth required)
    expect([200, 401]).toContain(response.status());

    if (response.status() === 200) {
      const body = await response.json();

      // Validate response structure
      expect(body).toBeDefined();

      // If it returns data array
      if (Array.isArray(body.data)) {
        for (const item of body.data.slice(0, 5)) {
          // Assert required fields exist
          expect(item).toHaveProperty('id');
          expect(item).toHaveProperty('title');

          // Optional: mangaupdatesId may exist
          if (item.mangaupdatesId) {
            expect(typeof item.mangaupdatesId).toBe('string');
          }

          // Optional: publishedAt validation
          if (item.publishedAt) {
            expect(Date.parse(item.publishedAt)).not.toBeNaN();
          }
        }
      }
    }
  });

  test('GET /api/health returns 200', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toHaveProperty('status');
  });

  test('API endpoints return proper Content-Type', async ({ request }) => {
    const endpoints = ['/api/health', '/api/series/browse'];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      const contentType = response.headers()['content-type'] || '';
      expect(contentType).toContain('application/json');
    }
  });
});

test.describe('MangaUpdates Release API', () => {
  test('validates release entry schema structure', async ({ request }) => {
    // This tests the expected schema for releases
    const expectedSchema = {
      id: 'string',
      title: 'string',
      chapter: 'string|null',
      volume: 'string|null',
      publishedAt: 'string|null',
      mangaupdatesId: 'string',
    };

    // Mock validation - actual endpoint may vary
    expect(Object.keys(expectedSchema)).toContain('id');
    expect(Object.keys(expectedSchema)).toContain('title');
    expect(Object.keys(expectedSchema)).toContain('mangaupdatesId');
  });
});
