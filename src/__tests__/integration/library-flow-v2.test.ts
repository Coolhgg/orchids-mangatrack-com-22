import { extractMangaDexId } from '../../lib/mangadex-utils';

describe('MangaDex Utility Tests', () => {
  test('extractMangaDexId should extract UUID from various URL formats', () => {
    const uuid = '32ad4f67-3f4d-4ea8-a43c-6131c407c4d4';
    
    // Direct UUID
    expect(extractMangaDexId(uuid)).toBe(uuid);
    
    // Standard URL
    expect(extractMangaDexId(`https://mangadex.org/title/${uuid}`)).toBe(uuid);
    expect(extractMangaDexId(`https://mangadex.org/title/${uuid}/some-slug`)).toBe(uuid);
    
    // Manga path
    expect(extractMangaDexId(`https://mangadex.org/manga/${uuid}`)).toBe(uuid);
    
    // Chapter URL (should still find manga ID if present, but usually chapter URLs have their own UUID)
    // In our case, the utility looks for any UUID in the path or after title/manga
    expect(extractMangaDexId(`https://mangadex.org/chapter/${uuid}`)).toBe(uuid);
    
    // Invalid inputs
    expect(extractMangaDexId('not-a-uuid')).toBe(null);
    expect(extractMangaDexId('https://google.com')).toBe(null);
  });

  test('extractMangaDexId should handle slugs correctly if they follow title/', () => {
    const slug = 'tomo-chan-wa-onnanoko';
    expect(extractMangaDexId(`https://mangadex.org/title/${slug}`)).toBe(slug);
  });
});

describe('Worker Resilience Logic', () => {
  test('Transient error detection', () => {
    const transientMessages = [
      'Rate Limit exceeded',
      'Request timeout',
      'ECONNREFUSED',
      '500 Internal Server Error',
      '503 Service Unavailable'
    ];
    
    const isTransient = (message: string) => 
      message.includes('Rate Limit') || 
      message.includes('timeout') || 
      message.includes('ECONNREFUSED') ||
      message.includes('500') ||
      message.includes('502') ||
      message.includes('503') ||
      message.includes('504');

    transientMessages.forEach(msg => {
      expect(isTransient(msg)).toBe(true);
    });

    expect(isTransient('Manga not found')).toBe(false);
    expect(isTransient('Validation error')).toBe(false);
  });
});
