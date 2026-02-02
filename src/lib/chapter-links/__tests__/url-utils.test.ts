// @ts-nocheck - Test file using bun:test
/**
 * Tests for Chapter Links URL Utilities
 */

import { describe, test, expect } from 'bun:test';
import {
  normalizeUrl,
  extractDomain,
  hashUrl,
  getSourceTier,
  getSourceName,
  validateUrl,
  checkBlacklist,
  generateChapterLockKey,
  calculateReportWeight,
  shortenUrlForDisplay,
  isOfficialSource,
  isMangaDexSource,
} from '../url-utils';

describe('Chapter Links URL Utilities', () => {
  describe('normalizeUrl', () => {
    test('removes www prefix', () => {
      expect(normalizeUrl('https://www.mangadex.org/chapter/123')).toBe(
        'https://mangadex.org/chapter/123'
      );
    });

    test('removes trailing slashes', () => {
      expect(normalizeUrl('https://mangadex.org/chapter/123/')).toBe(
        'https://mangadex.org/chapter/123'
      );
    });

    test('removes tracking parameters', () => {
      expect(normalizeUrl('https://example.com/page?utm_source=test&id=123')).toBe(
        'https://example.com/page?id=123'
      );
    });

    test('lowercases hostname but preserves path case', () => {
      expect(normalizeUrl('https://MangaDex.Org/Chapter/ABC')).toBe(
        'https://mangadex.org/Chapter/ABC'
      );
    });
  });

  describe('extractDomain', () => {
    test('extracts domain from valid URL', () => {
      expect(extractDomain('https://www.mangadex.org/chapter/123')).toBe('mangadex.org');
    });

    test('returns null for invalid URL', () => {
      expect(extractDomain('not-a-url')).toBeNull();
    });
  });

  describe('hashUrl', () => {
    test('returns consistent hash for same URL', () => {
      const hash1 = hashUrl('https://mangadex.org/chapter/123');
      const hash2 = hashUrl('https://mangadex.org/chapter/123');
      expect(hash1).toBe(hash2);
    });

    test('returns same hash for equivalent URLs', () => {
      const hash1 = hashUrl('https://www.mangadex.org/chapter/123/');
      const hash2 = hashUrl('https://mangadex.org/chapter/123');
      expect(hash1).toBe(hash2);
    });

    test('returns 64 char hex string', () => {
      const hash = hashUrl('https://mangadex.org/chapter/123');
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[a-f0-9]+$/);
    });
  });

  describe('getSourceTier', () => {
    test('identifies official domains', () => {
      expect(getSourceTier('viz.com')).toBe('official');
      expect(getSourceTier('mangaplus.shueisha.co.jp')).toBe('official');
    });

    test('identifies aggregator domains', () => {
      expect(getSourceTier('mangadex.org')).toBe('aggregator');
    });

    test('defaults to user for unknown domains', () => {
      expect(getSourceTier('example.com')).toBe('user');
    });
  });

  describe('getSourceName', () => {
    test('returns known source names', () => {
      expect(getSourceName('viz.com')).toBe('VIZ Media');
      expect(getSourceName('mangadex.org')).toBe('MangaDex');
      expect(getSourceName('mangaplus.shueisha.co.jp')).toBe('MANGA Plus');
    });

    test('capitalizes unknown domains', () => {
      expect(getSourceName('example.com')).toBe('Example');
    });
  });

  describe('validateUrl', () => {
    test('accepts valid URLs', () => {
      const result = validateUrl('https://mangadex.org/chapter/123');
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBeDefined();
      expect(result.hash).toBeDefined();
      expect(result.domain).toBe('mangadex.org');
    });

    test('rejects empty URLs', () => {
      const result = validateUrl('');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('empty');
    });

    test('rejects invalid URLs', () => {
      const result = validateUrl('not-a-url');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    test('rejects javascript: URLs', () => {
      const result = validateUrl('javascript:alert(1)');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('suspicious');
    });

    test('rejects URL shorteners', () => {
      const result = validateUrl('https://bit.ly/abc123');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('blocked');
    });

    test('rejects data: URLs', () => {
      const result = validateUrl('data:text/html,<script>alert(1)</script>');
      expect(result.isValid).toBe(false);
    });

    test('rejects ftp: protocol', () => {
      const result = validateUrl('ftp://example.com/file');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('http');
    });
  });

  describe('checkBlacklist', () => {
    const blacklist = [
      { domain: 'badsite.com', reason: 'malware' },
      { domain: 'spamsite.net', reason: 'spam' },
    ];

    test('blocks blacklisted domains', () => {
      const result = checkBlacklist('https://badsite.com/page', blacklist);
      expect(result.isBlocked).toBe(true);
      expect(result.reason).toBe('malware');
    });

    test('blocks subdomains of blacklisted domains', () => {
      const result = checkBlacklist('https://sub.badsite.com/page', blacklist);
      expect(result.isBlocked).toBe(true);
    });

    test('allows non-blacklisted domains', () => {
      const result = checkBlacklist('https://goodsite.com/page', blacklist);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('generateChapterLockKey', () => {
    test('returns consistent key for same input', () => {
      const key1 = generateChapterLockKey('series-123', 'chapter-1');
      const key2 = generateChapterLockKey('series-123', 'chapter-1');
      expect(key1).toBe(key2);
    });

    test('returns different keys for different inputs', () => {
      const key1 = generateChapterLockKey('series-123', 'chapter-1');
      const key2 = generateChapterLockKey('series-123', 'chapter-2');
      expect(key1).not.toBe(key2);
    });

    test('returns bigint', () => {
      const key = generateChapterLockKey('series-123', 'chapter-1');
      expect(typeof key).toBe('bigint');
    });
  });

  describe('calculateReportWeight', () => {
    test('returns 2 for max trust (1.0)', () => {
      expect(calculateReportWeight(1.0)).toBe(2);
    });

    test('returns 1 for min trust (0.5)', () => {
      expect(calculateReportWeight(0.5)).toBe(1);
    });

    test('clamps values below 0.5', () => {
      expect(calculateReportWeight(0.1)).toBe(1);
    });

    test('clamps values above 1.0', () => {
      expect(calculateReportWeight(1.5)).toBe(2);
    });
  });

  describe('shortenUrlForDisplay', () => {
    test('keeps short URLs as-is', () => {
      const result = shortenUrlForDisplay('https://viz.com/chapter');
      expect(result).toBe('viz.com/chapter');
    });

    test('truncates long URLs', () => {
      const longUrl = 'https://example.com/very/long/path/that/exceeds/the/limit/and/needs/truncation';
      const result = shortenUrlForDisplay(longUrl, 30);
      expect(result.length).toBe(30);
      expect(result).toContain('...');
    });
  });

  describe('isOfficialSource', () => {
    test('returns true for official sources', () => {
      expect(isOfficialSource('https://viz.com/chapter/123')).toBe(true);
      expect(isOfficialSource('https://mangaplus.shueisha.co.jp/viewer/123')).toBe(true);
    });

    test('returns false for non-official sources', () => {
      expect(isOfficialSource('https://mangadex.org/chapter/123')).toBe(false);
      expect(isOfficialSource('https://example.com/chapter/123')).toBe(false);
    });
  });

  describe('isMangaDexSource', () => {
    test('returns true for MangaDex', () => {
      expect(isMangaDexSource('https://mangadex.org/chapter/123')).toBe(true);
    });

    test('returns false for other sources', () => {
      expect(isMangaDexSource('https://viz.com/chapter/123')).toBe(false);
      expect(isMangaDexSource('https://example.com/chapter/123')).toBe(false);
    });
  });
});
