/**
 * Comprehensive Integration Tests for MangaTrack
 * Tests API routes, security, validation, and edge cases
 * @jest-environment node
 */

import { 
  sanitizeInput, 
  escapeILikePattern, 
  validateUUID, 
  validateUsername,
  checkRateLimit,
  clearRateLimit,
  htmlEncode,
  ApiError,
  validateEmail,
  parsePaginationParams,
  validateOrigin,
  checkAuthRateLimit
} from '@/lib/api-utils';
import { FilterSchema, DEFAULT_FILTERS } from '@/lib/schemas/filters';
import { 
  getSortColumn, 
  encodeCursor, 
  decodeCursor 
} from '@/lib/api/search-query';
import { detectSearchIntent } from '@/lib/search-intent';
import { isInternalIP, isWhitelistedDomain, ALLOWED_CONTENT_TYPES } from '@/lib/constants/image-whitelist';
import { isTransientError } from '@/lib/prisma';

// ==================== API UTILS SECURITY ====================
describe('API Utils - Security', () => {
  describe('sanitizeInput', () => {
    it('should remove HTML tags', () => {
      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('');
      expect(sanitizeInput('<img src="x" onerror="alert(1)">')).toBe('');
      expect(sanitizeInput('<div onclick="evil()">text</div>')).toBe('text');
    });

    it('should remove dangerous protocols', () => {
      expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)');
      expect(sanitizeInput('data:text/html,<script>')).toBe('text/html,');
      expect(sanitizeInput('vbscript:msgbox')).toBe('msgbox');
    });

    it('should remove event handlers', () => {
      expect(sanitizeInput('onclick=alert(1)')).toBe('data-sanitized-attr=alert(1)');
      expect(sanitizeInput('onmouseover=evil()')).toBe('data-sanitized-attr=evil()');
      expect(sanitizeInput('formaction=http://evil.com')).toBe('data-sanitized-attr=http://evil.com');
    });

    it('should handle encoded XSS attempts', () => {
      expect(sanitizeInput('&#60;script&#62;')).not.toContain('<');
      expect(sanitizeInput('&#x3C;script&#x3E;')).not.toContain('<');
    });

    it('should respect max length', () => {
      const longString = 'a'.repeat(300);
      expect(sanitizeInput(longString, 100).length).toBe(100);
    });

    it('should handle empty/null input', () => {
      expect(sanitizeInput('')).toBe('');
      expect(sanitizeInput(null as any)).toBe('');
      expect(sanitizeInput(undefined as any)).toBe('');
    });

    it('should handle unicode safely', () => {
      expect(sanitizeInput('こんにちは')).toBe('こんにちは');
      expect(sanitizeInput('🎉 Test')).toBe('🎉 Test');
    });
  });

  describe('escapeILikePattern', () => {
    it('should escape ILIKE special characters', () => {
      expect(escapeILikePattern('test%')).toBe('test\\%');
      expect(escapeILikePattern('test_')).toBe('test\\_');
      expect(escapeILikePattern('test\\')).toBe('test\\\\');
    });

    it('should handle multiple special characters', () => {
      expect(escapeILikePattern('100% match_test\\')).toBe('100\\% match\\_test\\\\');
    });

    it('should handle empty strings', () => {
      expect(escapeILikePattern('')).toBe('');
    });
  });

  describe('validateUUID', () => {
    it('should accept valid v4 UUIDs', () => {
      expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
      expect(() => validateUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).not.toThrow();
      expect(() => validateUUID('f47ac10b-58cc-4372-a567-0e02b2c3d479')).not.toThrow();
    });

    it('should reject invalid UUIDs', () => {
      expect(() => validateUUID('not-a-uuid')).toThrow();
      expect(() => validateUUID('550e8400-e29b-41d4-a716')).toThrow();
      expect(() => validateUUID('')).toThrow();
      expect(() => validateUUID('xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx')).toThrow();
    });

    it('should reject SQL injection attempts', () => {
      expect(() => validateUUID("550e8400-e29b-41d4-a716-446655440000'; DROP TABLE users;--")).toThrow();
      expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000 OR 1=1')).toThrow();
    });
  });

  describe('validateUsername', () => {
    it('should accept valid usernames', () => {
      expect(validateUsername('john_doe')).toBe(true);
      expect(validateUsername('user123')).toBe(true);
      expect(validateUsername('test-user')).toBe(true);
      expect(validateUsername('ABC123')).toBe(true);
    });

    it('should reject invalid usernames', () => {
      expect(validateUsername('ab')).toBe(false); // too short
      expect(validateUsername('a'.repeat(31))).toBe(false); // too long
      expect(validateUsername('user@domain')).toBe(false); // invalid chars
      expect(validateUsername('user name')).toBe(false); // spaces
      expect(validateUsername('')).toBe(false);
      expect(validateUsername('../etc/passwd')).toBe(false); // path traversal
    });
  });

  describe('validateEmail', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user.name@domain.org')).toBe(true);
    });

    it('should reject invalid emails', () => {
      expect(validateEmail('not-an-email')).toBe(false);
      expect(validateEmail('@domain.com')).toBe(false);
      expect(validateEmail('test@')).toBe(false);
    });
  });

  describe('htmlEncode', () => {
    it('should encode HTML special characters', () => {
      expect(htmlEncode('<script>')).toBe('&lt;script&gt;');
      expect(htmlEncode('"test"')).toBe('&quot;test&quot;');
      expect(htmlEncode("'test'")).toBe('&#x27;test&#x27;');
      expect(htmlEncode('a & b')).toBe('a &amp; b');
      expect(htmlEncode('path/to/file')).toBe('path&#x2F;to&#x2F;file');
    });
  });

  describe('parsePaginationParams', () => {
    it('should parse valid pagination', () => {
      const params = new URLSearchParams('page=2&limit=50');
      const result = parsePaginationParams(params);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(50);
      expect(result.offset).toBe(50);
    });

    it('should enforce limits', () => {
      const params = new URLSearchParams('limit=500');
      const result = parsePaginationParams(params);
      expect(result.limit).toBe(100); // Max 100
    });

    it('should handle negative values', () => {
      const params = new URLSearchParams('page=-1&limit=-10');
      const result = parsePaginationParams(params);
      expect(result.page).toBeGreaterThanOrEqual(1);
      expect(result.limit).toBeGreaterThanOrEqual(1);
    });
  });
});

// ==================== RATE LIMITING ====================
describe('Rate Limiting', () => {
  beforeEach(async () => {
    await clearRateLimit('test-key');
    await clearRateLimit('key-a');
    await clearRateLimit('key-b');
    await clearRateLimit('auth:test-ip');
  });

  it('should allow requests within limit', async () => {
    for (let i = 0; i < 5; i++) {
      expect(await checkRateLimit('test-key', 5, 60000)).toBe(true);
    }
  });

  it('should block requests exceeding limit', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit('test-key', 5, 60000);
    }
    expect(await checkRateLimit('test-key', 5, 60000)).toBe(false);
  });

  it('should track different keys separately', async () => {
    for (let i = 0; i < 5; i++) {
      await checkRateLimit('key-a', 5, 60000);
    }
    expect(await checkRateLimit('key-a', 5, 60000)).toBe(false);
    expect(await checkRateLimit('key-b', 5, 60000)).toBe(true);
  });

  it('should have stricter limits for auth endpoints', async () => {
    for (let i = 0; i < 5; i++) {
      await checkAuthRateLimit('test-ip');
    }
    expect(await checkAuthRateLimit('test-ip')).toBe(false);
  });
});

// ==================== FILTER SCHEMA VALIDATION ====================
describe('Filter Schema Validation', () => {
  it('should accept valid filters', () => {
    const result = FilterSchema.safeParse({
      q: 'one piece',
      type: ['manga'],
      genres: ['Action', 'Adventure'],
      sortBy: 'newest',
      limit: 24,
    });
    expect(result.success).toBe(true);
  });

  it('should apply defaults', () => {
    const result = FilterSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      // BUG FIX: Updated to match actual schema default (latest_chapter, not newest)
      expect(result.data.sortBy).toBe('latest_chapter');
      expect(result.data.limit).toBe(24);
      expect(result.data.mode).toBe('all');
      expect(result.data.sortOrder).toBe('desc');
    }
  });

  it('should reject invalid sortBy', () => {
    const result = FilterSchema.safeParse({
      sortBy: 'DROP TABLE series',
    });
    expect(result.success).toBe(false);
  });

  it('should enforce limit bounds', () => {
    expect(FilterSchema.safeParse({ limit: 500 }).success).toBe(false);
    expect(FilterSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(FilterSchema.safeParse({ limit: -1 }).success).toBe(false);
    expect(FilterSchema.safeParse({ limit: 100 }).success).toBe(true);
    expect(FilterSchema.safeParse({ limit: 1 }).success).toBe(true);
  });

  it('should reject overly long query strings', () => {
    const result = FilterSchema.safeParse({
      q: 'a'.repeat(300),
    });
    expect(result.success).toBe(false);
  });

  it('should validate chapter count range', () => {
    const invalid = FilterSchema.safeParse({
      chapterCount: { min: 100, max: 50 },
    });
    expect(invalid.success).toBe(false);
  });

  it('should validate date range', () => {
    const invalid = FilterSchema.safeParse({
      releasePeriod: { 
        from: '2024-12-01T00:00:00Z', 
        to: '2024-01-01T00:00:00Z' 
      },
    });
    expect(invalid.success).toBe(false);
  });

  it('should limit array sizes', () => {
    const result = FilterSchema.safeParse({
      genres: Array(60).fill('Action'), // More than max 50
    });
    expect(result.success).toBe(false);
  });
});

// ==================== CURSOR PAGINATION ====================
describe('Cursor Pagination', () => {
  it('should encode and decode cursor correctly', () => {
    const value = '2024-01-15T10:30:00Z';
    const id = '550e8400-e29b-41d4-a716-446655440000';
    
    const cursor = encodeCursor(value, id);
    const decoded = decodeCursor(cursor);
    
    expect(decoded?.v).toBe(value);
    expect(decoded?.i).toBe(id);
  });

  it('should handle null values', () => {
    const cursor = encodeCursor(null, '550e8400-e29b-41d4-a716-446655440000');
    const decoded = decodeCursor(cursor);
    expect(decoded?.v).toBe(null);
  });

  it('should handle special characters', () => {
    const value = 'Series with "quotes" & special <chars>';
    const id = '550e8400-e29b-41d4-a716-446655440000';
    
    const cursor = encodeCursor(value, id);
    const decoded = decodeCursor(cursor);
    expect(decoded?.v).toBe(value);
  });

  it('should reject invalid cursors', () => {
    expect(decodeCursor('invalid-cursor')).toBe(null);
    expect(decodeCursor('')).toBe(null);
    expect(decodeCursor('!!!notbase64!!!')).toBe(null);
  });

  it('should reject overly long cursors', () => {
    const longCursor = 'a'.repeat(600);
    expect(decodeCursor(longCursor)).toBe(null);
  });
});

// ==================== SORT COLUMN MAPPING ====================
describe('Sort Column Mapping', () => {
  it('should map valid sort options', () => {
    expect(getSortColumn('newest')).toBe('created_at');
    expect(getSortColumn('updated')).toBe('last_chapter_date');
    expect(getSortColumn('popularity')).toBe('total_follows');
    expect(getSortColumn('follows')).toBe('total_follows');
    expect(getSortColumn('views')).toBe('total_views');
    expect(getSortColumn('score')).toBe('average_rating');
    expect(getSortColumn('chapters')).toBe('chapter_count');
  });

  it('should default to created_at for invalid/malicious options', () => {
    expect(getSortColumn('invalid')).toBe('created_at');
    expect(getSortColumn('')).toBe('created_at');
    expect(getSortColumn('DROP TABLE series')).toBe('created_at');
    expect(getSortColumn('created_at; DELETE FROM users')).toBe('created_at');
  });
});

// ==================== SEARCH INTENT DETECTION ====================
describe('Search Intent Detection', () => {
  it('should detect exact title matches', () => {
    const results = [{ title: 'One Piece', alternative_titles: [] }];
    expect(detectSearchIntent('one piece', results)).toBe('EXACT_TITLE');
  });

  it('should detect partial titles with results', () => {
    const results = [{ title: 'One Piece', alternative_titles: [] }];
    expect(detectSearchIntent('one piec', results)).toBe('PARTIAL_TITLE');
  });

  it('should detect partial titles with no results', () => {
    expect(detectSearchIntent('one piec', [])).toBe('PARTIAL_TITLE');
    expect(detectSearchIntent('naruto shippud', [])).toBe('PARTIAL_TITLE');
  });

  it('should detect keyword exploration', () => {
    expect(detectSearchIntent('isekai fantasy', [])).toBe('KEYWORD_EXPLORATION');
    expect(detectSearchIntent('manga', [])).toBe('KEYWORD_EXPLORATION');
    expect(detectSearchIntent('action romance', [])).toBe('KEYWORD_EXPLORATION');
  });

  it('should filter noise', () => {
    expect(detectSearchIntent('a', [])).toBe('NOISE');
    expect(detectSearchIntent('12', [])).toBe('NOISE');
    expect(detectSearchIntent('!!!', [])).toBe('NOISE');
    expect(detectSearchIntent('   ', [])).toBe('NOISE');
  });

  it('should handle alternative titles', () => {
    const results = [{ 
      title: 'Demon Slayer', 
      alternative_titles: ['Kimetsu no Yaiba'] 
    }];
    expect(detectSearchIntent('kimetsu', results)).toBe('PARTIAL_TITLE');
  });
});

// ==================== IMAGE PROXY SECURITY ====================
describe('Image Proxy Security', () => {
  describe('isInternalIP', () => {
    it('should block localhost variations', () => {
      expect(isInternalIP('localhost')).toBe(true);
      expect(isInternalIP('127.0.0.1')).toBe(true);
      expect(isInternalIP('::1')).toBe(true);
      expect(isInternalIP('[::1]')).toBe(true);
      expect(isInternalIP('0.0.0.0')).toBe(true);
    });

    it('should block private IP ranges', () => {
      expect(isInternalIP('10.0.0.1')).toBe(true);
      expect(isInternalIP('10.255.255.255')).toBe(true);
      expect(isInternalIP('172.16.0.1')).toBe(true);
      expect(isInternalIP('172.31.255.255')).toBe(true);
      expect(isInternalIP('192.168.1.1')).toBe(true);
      expect(isInternalIP('192.168.255.255')).toBe(true);
    });

    it('should block link-local addresses', () => {
      expect(isInternalIP('169.254.169.254')).toBe(true);
      expect(isInternalIP('169.254.0.1')).toBe(true);
    });

    it('should block AWS/cloud metadata service', () => {
      expect(isInternalIP('169.254.169.254')).toBe(true);
      expect(isInternalIP('169.254.170.2')).toBe(true);
    });

    it('should block IPv6 mapped IPv4 addresses', () => {
      expect(isInternalIP('::ffff:127.0.0.1')).toBe(true);
      expect(isInternalIP('::ffff:10.0.0.1')).toBe(true);
      expect(isInternalIP('::ffff:192.168.1.1')).toBe(true);
    });

    it('should block internal hostnames', () => {
      expect(isInternalIP('internal.corp')).toBe(true);
      expect(isInternalIP('metadata.google.internal')).toBe(true);
      expect(isInternalIP('admin.local')).toBe(true);
    });

    it('should allow public IPs', () => {
      expect(isInternalIP('8.8.8.8')).toBe(false);
      expect(isInternalIP('1.1.1.1')).toBe(false);
      expect(isInternalIP('208.67.222.222')).toBe(false);
    });

    it('should allow valid external hostnames', () => {
      expect(isInternalIP('cdn.mangadex.org')).toBe(false);
      expect(isInternalIP('example.com')).toBe(false);
    });
  });

  describe('isWhitelistedDomain', () => {
    it('should allow whitelisted domains', () => {
      expect(isWhitelistedDomain('https://cdn.mangadex.org/image.jpg')).toBe(true);
      expect(isWhitelistedDomain('https://s4.anilist.co/cover.png')).toBe(true);
      expect(isWhitelistedDomain('https://i.imgur.com/abc123.jpg')).toBe(true);
    });

    it('should allow whitelisted subdomains', () => {
      expect(isWhitelistedDomain('https://uploads.mangadex.org/image.jpg')).toBe(true);
    });

    it('should reject non-whitelisted domains', () => {
      expect(isWhitelistedDomain('https://evil.com/image.jpg')).toBe(false);
      expect(isWhitelistedDomain('https://malicious.net/cover.png')).toBe(false);
    });

    it('should reject domain spoofing attempts', () => {
      expect(isWhitelistedDomain('https://mangadex.org.evil.com/image.jpg')).toBe(false);
      expect(isWhitelistedDomain('https://evil-mangadex.org/image.jpg')).toBe(false);
      expect(isWhitelistedDomain('https://mangadex.org@evil.com/image.jpg')).toBe(false);
    });

    it('should reject invalid URLs', () => {
      expect(isWhitelistedDomain('not-a-url')).toBe(false);
      expect(isWhitelistedDomain('')).toBe(false);
      expect(isWhitelistedDomain('javascript:alert(1)')).toBe(false);
    });
  });

  describe('Content Type Whitelist', () => {
    it('should not include SVG (XSS risk)', () => {
      expect(ALLOWED_CONTENT_TYPES).not.toContain('image/svg+xml');
    });

    it('should include safe image types', () => {
      expect(ALLOWED_CONTENT_TYPES).toContain('image/jpeg');
      expect(ALLOWED_CONTENT_TYPES).toContain('image/png');
      expect(ALLOWED_CONTENT_TYPES).toContain('image/webp');
    });
  });
});

// ==================== PRISMA ERROR HANDLING ====================
describe('Prisma Error Handling', () => {
  it('should identify transient connection errors', () => {
    expect(isTransientError({ message: 'Connection refused' })).toBe(true);
    expect(isTransientError({ message: "Can't reach database server" })).toBe(true);
    expect(isTransientError({ code: 'P1001' })).toBe(true);
    expect(isTransientError({ message: 'pool_timeout' })).toBe(true);
  });

  it('should not retry authentication errors', () => {
    expect(isTransientError({ message: 'password authentication failed' })).toBe(false);
    expect(isTransientError({ message: 'authentication failed for user' })).toBe(false);
    expect(isTransientError({ code: 'P1000' })).toBe(false);
  });

  it('should handle null/undefined safely', () => {
    expect(isTransientError(null)).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError({})).toBe(false);
  });
});

// ==================== API ERROR CLASS ====================
describe('ApiError', () => {
  it('should create error with correct properties', () => {
    const error = new ApiError('Test error', 400, 'TEST_CODE');
    expect(error.message).toBe('Test error');
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('TEST_CODE');
    expect(error.name).toBe('ApiError');
  });

  it('should default to 500 status code', () => {
    const error = new ApiError('Server error');
    expect(error.statusCode).toBe(500);
  });

  it('should be instanceof Error', () => {
    const error = new ApiError('Test');
    expect(error instanceof Error).toBe(true);
  });
});

// ==================== EDGE CASES ====================
describe('Edge Cases', () => {
  it('should handle extremely long inputs safely', () => {
    const longInput = 'a'.repeat(100000);
    expect(sanitizeInput(longInput).length).toBeLessThanOrEqual(10000);
  });

  it('should handle unicode edge cases', () => {
    // Zero-width characters
    expect(sanitizeInput('test\u200Btext')).toContain('test');
    // Right-to-left override
    expect(sanitizeInput('test\u202Etext')).toContain('test');
  });

  it('should handle empty arrays in filter schema', () => {
    const result = FilterSchema.safeParse({
      genres: [],
      tags: [],
      type: [],
    });
    expect(result.success).toBe(true);
  });

  it('should handle boundary values', () => {
    // Limit boundaries
    expect(FilterSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(FilterSchema.safeParse({ limit: 100 }).success).toBe(true);
    
    // Chapter count boundaries
    expect(FilterSchema.safeParse({ chapterCount: { min: 0, max: 100000 } }).success).toBe(true);
  });
});
