/**
 * @jest-environment node
 */
import {
  isValidCoverUrl,
  isMangaDexPlaceholder,
  getOptimizedCoverUrl,
  selectBestCover,
  SOURCE_PRIORITY,
  type CoverResult,
  type CoverSize,
} from '@/lib/cover-utils';

describe('Cover Utils', () => {
  describe('isValidCoverUrl', () => {
    it('should return false for null/undefined', () => {
      expect(isValidCoverUrl(null)).toBe(false);
      expect(isValidCoverUrl(undefined)).toBe(false);
      expect(isValidCoverUrl('')).toBe(false);
    });

    it('should return true for valid MangaDex cover URLs', () => {
      const validUrl = 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover-filename.jpg';
      expect(isValidCoverUrl(validUrl)).toBe(true);
    });

    it('should return false for placeholder URLs', () => {
      expect(isValidCoverUrl('https://example.com/placeholder.jpg')).toBe(false);
      expect(isValidCoverUrl('https://example.com/no-image.png')).toBe(false);
      expect(isValidCoverUrl('https://example.com/default.jpg')).toBe(false);
    });

    it('should return false for MangaDex placeholder patterns', () => {
      expect(isValidCoverUrl('https://uploads.mangadex.org/covers/abc/placeholder.jpg')).toBe(false);
      expect(isValidCoverUrl('https://uploads.mangadex.org/covers/abc/no-cover.jpg')).toBe(false);
    });

    it('should return false for URLs with short filenames', () => {
      // Short filename - less than 10 chars
      expect(isValidCoverUrl('https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/a.jpg')).toBe(false);
    });

    it('should return true for MangaPark cover URLs', () => {
      expect(isValidCoverUrl('https://mangapark.net/covers/some-manga-cover.jpg')).toBe(true);
      expect(isValidCoverUrl('https://mangapark.io/covers/some-manga-cover.jpg')).toBe(true);
    });
  });

  describe('isMangaDexPlaceholder', () => {
    it('should return true for null/undefined', () => {
      expect(isMangaDexPlaceholder(null)).toBe(true);
      expect(isMangaDexPlaceholder(undefined)).toBe(true);
    });

    it('should return false for non-MangaDex URLs', () => {
      expect(isMangaDexPlaceholder('https://example.com/cover.jpg')).toBe(false);
    });

    it('should return true for MangaDex placeholder filenames', () => {
      expect(isMangaDexPlaceholder('https://uploads.mangadex.org/covers/abc/placeholder.jpg')).toBe(true);
      expect(isMangaDexPlaceholder('https://uploads.mangadex.org/covers/abc/no_cover.jpg')).toBe(true);
      expect(isMangaDexPlaceholder('https://uploads.mangadex.org/covers/abc/missing.jpg')).toBe(true);
    });

    it('should return false for valid MangaDex covers', () => {
      const validUrl = 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover-filename.jpg';
      expect(isMangaDexPlaceholder(validUrl)).toBe(false);
    });
  });

  describe('getOptimizedCoverUrl', () => {
    it('should return null for null/undefined input', () => {
      expect(getOptimizedCoverUrl(null)).toBeNull();
      expect(getOptimizedCoverUrl(undefined)).toBeNull();
    });

    it('should return original URL when size is original', () => {
      const url = 'https://uploads.mangadex.org/covers/abc/cover.jpg';
      expect(getOptimizedCoverUrl(url, 'original')).toBe(url);
    });

    it('should add size suffix to MangaDex URLs', () => {
      const url = 'https://uploads.mangadex.org/covers/abc/cover.jpg';
      expect(getOptimizedCoverUrl(url, '256')).toBe('https://uploads.mangadex.org/covers/abc/cover.jpg.256.jpg');
      expect(getOptimizedCoverUrl(url, '512')).toBe('https://uploads.mangadex.org/covers/abc/cover.jpg.512.jpg');
      expect(getOptimizedCoverUrl(url, '1024')).toBe('https://uploads.mangadex.org/covers/abc/cover.jpg.1024.jpg');
    });

    it('should replace existing size suffix', () => {
      const url = 'https://uploads.mangadex.org/covers/abc/cover.jpg.256.jpg';
      expect(getOptimizedCoverUrl(url, '512')).toBe('https://uploads.mangadex.org/covers/abc/cover.jpg.512.jpg');
    });

    it('should return non-MangaDex URLs unchanged', () => {
      const url = 'https://mangapark.net/covers/cover.jpg';
      expect(getOptimizedCoverUrl(url, '512')).toBe(url);
    });
  });

  describe('selectBestCover', () => {
    it('should return null for empty array', () => {
      expect(selectBestCover([])).toBeNull();
    });

    it('should return null when no valid covers exist', () => {
      const sources = [
        { source_name: 'test', cover_url: null },
        { source_name: 'test2', cover_url: 'https://example.com/placeholder.jpg' },
      ];
      expect(selectBestCover(sources)).toBeNull();
    });

    it('should prioritize primary cover', () => {
      const sources = [
        { 
          source_name: 'mangapark', 
          cover_url: 'https://mangapark.net/covers/cover1.jpg',
          is_primary_cover: false,
        },
        { 
          source_name: 'mangadex', 
          cover_url: 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover-filename.jpg',
          is_primary_cover: true,
        },
      ];
      const result = selectBestCover(sources);
      expect(result?.source_name).toBe('mangadex');
    });

    it('should prioritize by source priority when no primary cover', () => {
      const sources = [
        { 
          source_name: 'mangapark', 
          cover_url: 'https://mangapark.net/covers/cover1.jpg',
        },
        { 
          source_name: 'mangadex', 
          cover_url: 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover-filename.jpg',
        },
      ];
      const result = selectBestCover(sources);
      // MangaDex has priority 10, MangaPark has priority 5
      expect(result?.source_name).toBe('mangadex');
    });

    it('should prioritize by resolution when priorities are equal', () => {
      const sources = [
        { 
          source_name: 'mangadex', 
          cover_url: 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover1-filename.jpg',
          cover_width: 256,
          cover_height: 256,
        },
        { 
          source_name: 'mangadex', 
          cover_url: 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover2-filename.jpg',
          cover_width: 512,
          cover_height: 512,
        },
      ];
      const result = selectBestCover(sources);
      expect(result?.cover_url).toContain('cover2');
    });

    it('should include cover dimensions in result', () => {
      const sources = [
        { 
          source_name: 'mangadex', 
          cover_url: 'https://uploads.mangadex.org/covers/12345678-1234-1234-1234-123456789abc/cover-filename.jpg',
          cover_width: 512,
          cover_height: 728,
        },
      ];
      const result = selectBestCover(sources);
      expect(result).not.toBeNull();
      expect(result?.cover_width).toBe(512);
      expect(result?.cover_height).toBe(728);
    });
  });

  describe('SOURCE_PRIORITY', () => {
    it('should have mangadex with highest priority', () => {
      expect(SOURCE_PRIORITY.mangadex).toBeGreaterThan(SOURCE_PRIORITY.mangapark);
    });

    it('should have expected source priorities', () => {
      expect(SOURCE_PRIORITY.mangadex).toBe(10);
      expect(SOURCE_PRIORITY.mangapark).toBe(5);
    });
  });
});
