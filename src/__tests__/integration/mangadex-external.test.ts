/**
 * CHECK 12: Integration Test - Real MangaDex API (Optional)
 * 
 * This test hits the real MangaDex API. Run with:
 *   INTEGRATION_EXTERNAL=true npm test -- --testPathPattern=mangadex-external
 */

import { MangaDexClient } from '@/lib/mangadex/client';

const SKIP_EXTERNAL = process.env.INTEGRATION_EXTERNAL !== 'true';

describe('12. [Integration-External] Real MangaDex API', () => {
  const client = new MangaDexClient({ maxRetries: 2, timeoutMs: 30000 });

  (SKIP_EXTERNAL ? describe.skip : describe)('External API calls', () => {
    it('fetches 5 latest chapters from real API', async () => {
      const result = await client.fetchLatestChapters({
        limit: 5,
        translatedLanguage: ['en'],
        includeManga: true,
      });

      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(5);

      for (const chapter of result.data) {
        expect(chapter.id).toBeDefined();
        expect(chapter.type).toBe('chapter');
        expect(chapter.attributes.translatedLanguage).toBe('en');
      }
    }, 60000);

    it('fetches manga metadata by known ID', async () => {
      const KNOWN_MANGA_ID = 'a96676e5-8ae2-425e-b549-7f15dd34a6d8'; // Kaguya-sama

      const metadata = await client.fetchMangaMetadata(KNOWN_MANGA_ID);

      expect(metadata.id).toBe(KNOWN_MANGA_ID);
      expect(metadata.title).toBeDefined();
      expect(typeof metadata.title).toBe('string');
    }, 60000);
  });

  it('skips external tests when INTEGRATION_EXTERNAL is not set', () => {
    if (SKIP_EXTERNAL) {
      expect(true).toBe(true);
    }
  });
});
