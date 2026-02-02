import { NextRequest } from 'next/server';
import { checkRateLimit, sanitizeInput, escapeILikePattern, validateUUID, htmlEncode } from '@/lib/api-utils';
import { isInternalIP } from '@/lib/constants/image-whitelist';

describe('Bug Bounty Security & Integration Tests', () => {
  
  describe('XSS Prevention', () => {
    test('sanitizeInput removes script tags', () => {
      const input = '<script>alert("xss")</script>Hello';
      expect(sanitizeInput(input)).toBe('Hello');
    });

    test('sanitizeInput removes event handlers', () => {
      const input = '<img src=x onerror=alert(1)>';
      expect(sanitizeInput(input)).toBe('');
    });

    test('sanitizeInput removes dangerous protocols', () => {
      const input = 'javascript:alert(1)';
      expect(sanitizeInput(input)).toBe('alert(1)');
    });

    test('sanitizeInput handles null bytes', () => {
      const input = 'admin\0.php';
      expect(sanitizeInput(input)).toBe('admin.php');
    });

    test('sanitizeInput truncates long input', () => {
      const longInput = 'a'.repeat(20000);
      expect(sanitizeInput(longInput).length).toBe(10000);
    });

    test('htmlEncode escapes special characters', () => {
      const input = '<script>alert("xss")</script>';
      expect(htmlEncode(input)).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;&#x2F;script&gt;');
    });
  });

  describe('SQL Injection Prevention', () => {
    test('escapeILikePattern escapes percent signs', () => {
      const input = '100% match';
      expect(escapeILikePattern(input)).toBe('100\\% match');
    });

    test('escapeILikePattern escapes underscores', () => {
      const input = 'user_name';
      expect(escapeILikePattern(input)).toBe('user\\_name');
    });

    test('escapeILikePattern escapes backslashes', () => {
      const input = 'C:\\path';
      expect(escapeILikePattern(input)).toBe('C:\\\\path');
    });
  });

  describe('SSRF Protection', () => {
    test('isInternalIP blocks localhost', () => {
      expect(isInternalIP('localhost')).toBe(true);
      expect(isInternalIP('127.0.0.1')).toBe(true);
      expect(isInternalIP('::1')).toBe(true);
    });

    test('isInternalIP blocks private IPv4 ranges', () => {
      expect(isInternalIP('10.0.0.1')).toBe(true);
      expect(isInternalIP('192.168.1.1')).toBe(true);
      expect(isInternalIP('172.16.0.1')).toBe(true);
    });

    test('isInternalIP blocks cloud metadata service', () => {
      expect(isInternalIP('169.254.169.254')).toBe(true);
    });

    test('isInternalIP blocks IPv6 mapped IPv4', () => {
      expect(isInternalIP('::ffff:127.0.0.1')).toBe(true);
    });

    test('isInternalIP allows public IPs', () => {
      expect(isInternalIP('8.8.8.8')).toBe(false);
      expect(isInternalIP('google.com')).toBe(false);
    });
  });

  describe('Rate Limiting', () => {
    test('checkRateLimit allows requests within limit', async () => {
      const key = 'test-rate-limit-' + Math.random();
      for (let i = 0; i < 5; i++) {
        expect(await checkRateLimit(key, 10, 60000)).toBe(true);
      }
    });

    test('checkRateLimit blocks requests over limit', async () => {
      const key = 'test-rate-limit-blocked-' + Math.random();
      for (let i = 0; i < 5; i++) {
        await checkRateLimit(key, 5, 60000);
      }
      expect(await checkRateLimit(key, 5, 60000)).toBe(false);
    });
  });

  describe('UUID Validation', () => {
    test('validateUUID accepts valid UUID', () => {
      const valid = '550e8400-e29b-41d4-a716-446655440000';
      expect(() => validateUUID(valid)).not.toThrow();
    });

    test('validateUUID rejects invalid UUID', () => {
      const invalid = 'not-a-uuid';
      expect(() => validateUUID(invalid)).toThrow();
    });

    test('validateUUID rejects path traversal attempts', () => {
      const traversal = '../../etc/passwd';
      expect(() => validateUUID(traversal)).toThrow();
    });
  });

  describe('Pagination Limits', () => {
    const { parsePaginationParams } = require('@/lib/api-utils');
    
    test('limit is capped at 100', () => {
      const params = new URLSearchParams('limit=999');
      const { limit } = parsePaginationParams(params);
      expect(limit).toBe(100);
    });

    test('negative limit results in 1', () => {
      const params = new URLSearchParams('limit=-10');
      const { limit } = parsePaginationParams(params);
      expect(limit).toBe(1);
    });

    test('offset is capped at 1,000,000', () => {
      const params = new URLSearchParams('offset=999999999');
      const { offset } = parsePaginationParams(params);
      expect(offset).toBe(1000000);
    });

    test('negative offset results in 0', () => {
      const params = new URLSearchParams('offset=-50');
      const { offset } = parsePaginationParams(params);
      expect(offset).toBe(0);
    });
  });

  describe('Search Cache & Heat Mitigation', () => {
    const { normalizeQuery } = require('@/lib/search-cache');

    test('normalizeQuery collapses whitespace and lowercases', () => {
      expect(normalizeQuery('  ONE   piece  ')).toBe('one piece');
    });
  });
});
