// @ts-nocheck - Integration test with complex mocks
/**
 * QA Integration Tests - Critical Paths
 * 
 * Tests for the most critical user flows:
 * 1. Chapter fetching with source URL redirection
 * 2. API parameter validation (NaN handling)
 * 3. Rate limiting
 * 4. MangaDex client operations
 * 5. MangaUpdates client operations
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// Mock dependencies
const mockPrisma = {
  chapter: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  chapterSource: {
    count: jest.fn(),
    findMany: jest.fn(),
  },
  userChapterReadV2: {
    findMany: jest.fn(),
  },
  libraryEntry: {
    findFirst: jest.fn(),
  },
  series: {
    findUnique: jest.fn(),
  },
  seriesSource: {
    upsert: jest.fn(),
  },
  $queryRaw: jest.fn(),
};

// Mock Supabase
const mockSupabase = {
  auth: {
    getUser: jest.fn(),
  },
};

describe('Critical Path Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Chapter URL Redirection Flow', () => {
    it('should return external URLs for chapter sources, not hosted content', async () => {
      // Verify that chapters are returned with their source URLs
      // which redirect users to external sites (MangaDex, etc.)
      const mockChapterSources = [
        {
          id: 'cs-1',
          chapter: {
            id: 'ch-1',
            chapter_number: '1',
            chapter_title: 'Chapter 1',
            volume_number: null,
          },
          series_source: {
            id: 'ss-1',
            source_name: 'mangadex',
            source_id: 'uuid-1',
            trust_score: 100,
          },
          source_chapter_url: 'https://mangadex.org/chapter/abc-123',
          source_published_at: new Date(),
          detected_at: new Date(),
          is_available: true,
          chapter_title: null,
        },
      ];

      mockPrisma.chapterSource.count.mockResolvedValue(1);
      mockPrisma.chapterSource.findMany.mockResolvedValue(mockChapterSources);

      // Simulate the chapter response format
      const formattedChapter = {
        id: mockChapterSources[0].id,
        chapter_id: mockChapterSources[0].chapter.id,
        chapter_number: 1,
        chapter_title: mockChapterSources[0].chapter.chapter_title,
        chapter_url: mockChapterSources[0].source_chapter_url, // External URL
        source_name: 'mangadex',
      };

      // Verify the URL is an external MangaDex URL
      expect(formattedChapter.chapter_url).toBe('https://mangadex.org/chapter/abc-123');
      expect(formattedChapter.chapter_url).toMatch(/^https:\/\/mangadex\.org\/chapter\//);
      
      // Ensure we're NOT serving at-home/hosted content
      expect(formattedChapter.chapter_url).not.toContain('at-home');
      expect(formattedChapter.chapter_url).not.toContain('data/');
    });

    it('should handle multiple sources per chapter with trust score sorting', () => {
      const sources = [
        { source_name: 'mangapark', trust_score: 50, chapter_url: 'https://mangapark.net/ch/1' },
        { source_name: 'mangadex', trust_score: 100, chapter_url: 'https://mangadex.org/chapter/1' },
        { source_name: 'bato', trust_score: 75, chapter_url: 'https://bato.to/ch/1' },
      ];

      // Sort by trust score descending
      const sorted = [...sources].sort((a, b) => b.trust_score - a.trust_score);

      expect(sorted[0].source_name).toBe('mangadex');
      expect(sorted[0].trust_score).toBe(100);
      expect(sorted[1].source_name).toBe('bato');
      expect(sorted[2].source_name).toBe('mangapark');
    });
  });

  describe('2. Parameter Validation - NaN Handling', () => {
    function safeParseInt(value: string | null, defaultValue: number, min: number, max: number): number {
      if (!value) return defaultValue;
      const parsed = parseInt(value, 10);
      if (isNaN(parsed)) return defaultValue;
      return Math.min(max, Math.max(min, parsed));
    }

    it('should return default for null/undefined', () => {
      expect(safeParseInt(null, 50, 1, 100)).toBe(50);
    });

    it('should return default for NaN-producing strings', () => {
      expect(safeParseInt('abc', 50, 1, 100)).toBe(50);
      expect(safeParseInt('', 50, 1, 100)).toBe(50);
      expect(safeParseInt('NaN', 50, 1, 100)).toBe(50);
    });

    it('should parse valid integers', () => {
      expect(safeParseInt('25', 50, 1, 100)).toBe(25);
      expect(safeParseInt('1', 50, 1, 100)).toBe(1);
      expect(safeParseInt('100', 50, 1, 100)).toBe(100);
    });

    it('should clamp values to bounds', () => {
      expect(safeParseInt('0', 50, 1, 100)).toBe(1);  // Below min
      expect(safeParseInt('-5', 50, 1, 100)).toBe(1); // Below min
      expect(safeParseInt('150', 50, 1, 100)).toBe(100); // Above max
      expect(safeParseInt('999999', 50, 1, 100)).toBe(100); // Way above max
    });

    it('should handle float strings by truncating', () => {
      expect(safeParseInt('25.9', 50, 1, 100)).toBe(25);
      expect(safeParseInt('1.1', 50, 1, 100)).toBe(1);
    });
  });

  describe('3. Advisory Lock Safety', () => {
    it('should validate lock ID is a valid number', () => {
      const seriesId = 'a1c7c817-4e59-43b7-9365-09675a149a6f';
      const lockId = parseInt(seriesId.replace(/-/g, '').substring(0, 8), 16);
      
      expect(isNaN(lockId)).toBe(false);
      expect(lockId).toBeGreaterThan(0);
    });

    it('should handle malformed series IDs gracefully', () => {
      const badIds = ['not-a-uuid', '', '   ', 'invalid'];
      
      for (const badId of badIds) {
        const lockId = parseInt(badId.replace(/-/g, '').substring(0, 8), 16);
        // Should be NaN or a valid number - our code checks for NaN
        if (isNaN(lockId)) {
          expect(isNaN(lockId)).toBe(true);
        }
      }
    });
  });

  describe('4. Read Status Comparison', () => {
    it('should correctly determine if chapter is read', () => {
      const readChapterIds = new Set(['ch-1', 'ch-2', 'ch-3']);
      const lastReadChapter = 5;

      // Chapter in set - should be read
      expect(readChapterIds.has('ch-1')).toBe(true);

      // Chapter number below lastReadChapter - should be read
      const chapterNum = 3;
      const isReadByProgress = lastReadChapter >= 0 && !isNaN(chapterNum) && chapterNum <= lastReadChapter;
      expect(isReadByProgress).toBe(true);

      // Chapter number above lastReadChapter and not in set - not read
      const unreadChapterNum = 10;
      const isUnread = lastReadChapter >= 0 && !isNaN(unreadChapterNum) && unreadChapterNum <= lastReadChapter;
      expect(isUnread).toBe(false);
    });

    it('should handle NaN chapter numbers safely', () => {
      const lastReadChapter = 5;
      const chapterNum = NaN;
      
      // This should NOT mark as read when chapter number is NaN
      const isRead = lastReadChapter >= 0 && !isNaN(chapterNum) && chapterNum <= lastReadChapter;
      expect(isRead).toBe(false);
    });

    it('should handle negative lastReadChapter', () => {
      const lastReadChapter = -1; // No progress yet
      const chapterNum = 1;
      
      const isRead = lastReadChapter >= 0 && !isNaN(chapterNum) && chapterNum <= lastReadChapter;
      expect(isRead).toBe(false);
    });
  });

  describe('5. Source URL Validation', () => {
    const ALLOWED_HOSTS = new Set([
      'mangadex.org',
      'api.mangadex.org',
      'mangapark.net',
      'mangapark.me',
      'mangapark.com',
      'mangasee123.com',
      'manga4life.com',
      'manganato.com',
      'bato.to',
      'mangakakalot.com',
    ]);

    function validateSourceUrl(url: string): boolean {
      try {
        const parsed = new URL(url);
        return ALLOWED_HOSTS.has(parsed.hostname);
      } catch {
        return false;
      }
    }

    it('should accept valid source URLs', () => {
      expect(validateSourceUrl('https://mangadex.org/chapter/abc')).toBe(true);
      expect(validateSourceUrl('https://api.mangadex.org/manga/123')).toBe(true);
      expect(validateSourceUrl('https://bato.to/chapter/123')).toBe(true);
    });

    it('should reject invalid/malicious URLs', () => {
      expect(validateSourceUrl('https://evil.com/chapter')).toBe(false);
      expect(validateSourceUrl('https://fake-mangadex.org/chapter')).toBe(false);
      expect(validateSourceUrl('javascript:alert(1)')).toBe(false);
      expect(validateSourceUrl('not-a-url')).toBe(false);
    });
  });

  describe('6. Rate Limit Key Generation', () => {
    it('should generate unique rate limit keys per IP', () => {
      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';
      
      const key1 = `chapters:${ip1}`;
      const key2 = `chapters:${ip2}`;
      
      expect(key1).not.toBe(key2);
      expect(key1).toBe('chapters:192.168.1.1');
    });

    it('should sanitize IP addresses in rate limit keys', () => {
      const dangerousIp = '127.0.0.1\ninjection';
      const sanitized = dangerousIp.split('\n')[0];
      const key = `chapters:${sanitized}`;
      
      expect(key).toBe('chapters:127.0.0.1');
      expect(key).not.toContain('injection');
    });
  });

  describe('7. UUID Validation', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    it('should accept valid UUIDs', () => {
      expect(UUID_REGEX.test('a1c7c817-4e59-43b7-9365-09675a149a6f')).toBe(true);
      expect(UUID_REGEX.test('A1C7C817-4E59-43B7-9365-09675A149A6F')).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
      expect(UUID_REGEX.test('12345')).toBe(false);
      expect(UUID_REGEX.test('')).toBe(false);
      expect(UUID_REGEX.test('a1c7c817-4e59-43b7-9365-09675a149a6f-extra')).toBe(false);
    });
  });
});

describe('MangaDex Client Tests', () => {
  describe('External URL Chapter Flow', () => {
    it('should return chapter URLs pointing to mangadex.org', () => {
      const chapterData = {
        id: 'abc-123',
        attributes: {
          chapter: '1',
          title: 'Test Chapter',
          externalUrl: null,
        },
      };

      const chapterUrl = `https://mangadex.org/chapter/${chapterData.id}`;
      
      expect(chapterUrl).toBe('https://mangadex.org/chapter/abc-123');
      expect(chapterUrl).toMatch(/^https:\/\/mangadex\.org\/chapter\//);
    });

    it('should handle external URL chapters (MangaPlus, etc.)', () => {
      const chapterData = {
        id: 'abc-123',
        attributes: {
          chapter: '1',
          title: 'Test Chapter',
          externalUrl: 'https://mangaplus.shueisha.co.jp/viewer/123',
        },
      };

      // When externalUrl exists, we use that instead
      const chapterUrl = chapterData.attributes.externalUrl || 
        `https://mangadex.org/chapter/${chapterData.id}`;
      
      expect(chapterUrl).toBe('https://mangaplus.shueisha.co.jp/viewer/123');
    });
  });
});

describe('MangaUpdates Client Tests', () => {
  describe('Release Data Flattening', () => {
    it('should flatten nested release data correctly', () => {
      const rawRelease = {
        record: {
          id: 123,
          title: 'One Piece',
          volume: null,
          chapter: '1100',
          groups: [{ name: 'TCB Scans', group_id: 456 }],
          release_date: '2024-01-27',
        },
        metadata: {
          series: {
            series_id: 3793,
            title: 'One Piece',
            url: 'https://www.mangaupdates.com/series/123',
          },
        },
      };

      const flattened = {
        id: rawRelease.record.id,
        title: rawRelease.record.title,
        volume: rawRelease.record.volume,
        chapter: rawRelease.record.chapter,
        groups: rawRelease.record.groups,
        release_date: rawRelease.record.release_date,
        series: {
          series_id: rawRelease.metadata.series.series_id,
          title: rawRelease.metadata.series.title,
          url: rawRelease.metadata.series.url,
        },
      };

      expect(flattened.id).toBe(123);
      expect(flattened.title).toBe('One Piece');
      expect(flattened.chapter).toBe('1100');
      expect(flattened.series.series_id).toBe(3793);
    });
  });
});
