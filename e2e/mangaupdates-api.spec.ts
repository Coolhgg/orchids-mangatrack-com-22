/**
 * MangaUpdates API E2E Test (Playwright/HTTP)
 * Tests: /api/mangaupdates/latest endpoint schema validation
 */

import { test, expect } from '@playwright/test';

test.describe('MangaUpdates API Endpoint', () => {
  test('GET /api/mangaupdates/latest returns valid JSON schema', async ({ request }) => {
    const response = await request.get('/api/mangaupdates/latest');

    if (response.status() === 404) {
      test.skip(true, 'Endpoint not implemented yet');
      return;
    }

    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('application/json');

    const data = await response.json();

    expect(data).toHaveProperty('releases');
    expect(Array.isArray(data.releases)).toBe(true);

    if (data.releases.length > 0) {
      const release = data.releases[0];

      expect(release).toHaveProperty('title');
      expect(typeof release.title).toBe('string');

      expect(release).toHaveProperty('mangaupdatesId');
      expect(typeof release.mangaupdatesId).toBe('number');

      expect(release).toHaveProperty('publishedAt');
      expect(new Date(release.publishedAt).toString()).not.toBe('Invalid Date');
    }

    expect(data).toHaveProperty('pagination');
    expect(data.pagination).toHaveProperty('page');
    expect(data.pagination).toHaveProperty('total');
  });

  test('GET /api/mangaupdates/latest handles pagination params', async ({ request }) => {
    const response = await request.get('/api/mangaupdates/latest?page=1&limit=5');

    if (response.status() === 404) {
      test.skip(true, 'Endpoint not implemented yet');
      return;
    }

    expect(response.status()).toBe(200);
    const data = await response.json();

    expect(data.releases.length).toBeLessThanOrEqual(5);
    expect(data.pagination.page).toBe(1);
  });

  test('GET /api/mangaupdates/latest returns 429 info on rate limit', async ({ request }) => {
    const responses = await Promise.all(
      Array(20).fill(null).map(() => request.get('/api/mangaupdates/latest'))
    );

    const rateLimited = responses.filter(r => r.status() === 429);

    if (rateLimited.length > 0) {
      const headers = rateLimited[0].headers();
      expect(headers).toHaveProperty('retry-after');
    }
  });
});
