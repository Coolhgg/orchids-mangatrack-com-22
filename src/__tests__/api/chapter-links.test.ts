// @ts-nocheck - TODO: Migrate from bun:test to Jest
/**
 * Tests for Chapter Links API
 * 
 * POST /api/series/:seriesId/chapters/:chapterId/links
 * GET /api/series/:seriesId/chapters/:chapterId/links
 */

// This test file was written for bun:test and needs migration to Jest
// Temporarily disabled for typecheck

/* eslint-disable */

// Mock dependencies before importing the route
const mockCreateClient = mock(() => ({
  auth: {
    getUser: mock(() => ({
      data: { user: { id: 'test-user-id' } },
      error: null,
    })),
  },
}));

const mockPrisma = {
  user: {
    findUnique: mock(() => ({
      id: 'test-user-id',
      xp: 500,
      level: 15,
      trust_score: 1.0,
      created_at: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    })),
  },
  series: {
    findUnique: mock(() => ({
      id: 'test-series-id',
      title: 'Test Series',
    })),
  },
  chapter: {
    findUnique: mock(() => ({
      id: 'test-chapter-id',
      chapter_number: '1',
      series_id: 'test-series-id',
    })),
  },
  chapterLink: {
    findMany: mock(() => []),
    findFirst: mock(() => null),
    count: mock(() => 0),
    create: mock((args: any) => ({
      id: 'new-link-id',
      ...args.data,
      submitted_at: new Date(),
      verified_at: null,
    })),
    update: mock((args: any) => args.data),
  },
  linkVote: {
    findMany: mock(() => []),
    create: mock((args: any) => args.data),
  },
  linkSubmissionAudit: {
    create: mock((args: any) => args.data),
  },
  domainBlacklist: {
    findMany: mock(() => []),
  },
  $transaction: mock(async (fn: any) => {
    // Mock advisory lock success
    const mockTx = {
      ...mockPrisma,
      $queryRaw: mock(() => [{ pg_try_advisory_xact_lock: true }]),
    };
    return fn(mockTx);
  }),
};

// Mock modules
mock.module('@/lib/supabase/server', () => ({
  createClient: mockCreateClient,
}));

mock.module('@/lib/prisma', () => ({
  prisma: mockPrisma,
  DEFAULT_TX_OPTIONS: { maxWait: 5000, timeout: 15000 },
}));

mock.module('@/lib/api-utils', () => ({
  ApiError: class ApiError extends Error {
    constructor(message: string, public statusCode: number = 500, public code?: string) {
      super(message);
    }
  },
  ErrorCodes: {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
  },
  handleApiError: mock((error: any) => {
    return new Response(JSON.stringify({ error: error.message }), {
      status: error.statusCode || 500,
    });
  }),
  checkRateLimit: mock(() => true),
  getRateLimitInfo: mock(() => ({ allowed: true, remaining: 10, reset: Date.now() + 60000, limit: 20 })),
  validateOrigin: mock(() => {}),
  validateContentType: mock(() => {}),
  validateJsonSize: mock(async () => {}),
  sanitizeInput: mock((val: string) => val),
  getClientIp: mock(() => '127.0.0.1'),
  logSecurityEvent: mock(async () => {}),
  htmlEncode: mock((val: string) => val),
}));

// Test helper to create mock NextRequest
function createMockRequest(options: {
  method: string;
  body?: object;
  headers?: Record<string, string>;
}): Request {
  const headers = new Headers({
    'content-type': 'application/json',
    'origin': 'http://localhost:3000',
    'host': 'localhost:3000',
    ...options.headers,
  });

  return new Request('http://localhost:3000/api/series/test-series-id/chapters/test-chapter-id/links', {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
}

describe('Chapter Links API', () => {
  describe('URL Validation', () => {
    it('should validate URL format', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      // Valid URL
      const valid = validateUrl('https://mangadex.org/chapter/123');
      expect(valid.isValid).toBe(true);
      expect(valid.domain).toBe('mangadex.org');
      
      // Invalid URL
      const invalid = validateUrl('not-a-url');
      expect(invalid.isValid).toBe(false);
    });

    it('should reject blocked domains', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const result = validateUrl('https://bit.ly/abc123');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('blocked');
    });

    it('should reject javascript: URLs', async () => {
      const { validateUrl } = await import('@/lib/chapter-links');
      
      const result = validateUrl('javascript:alert(1)');
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('suspicious');
    });

    it('should normalize URLs consistently', async () => {
      const { normalizeUrl, hashUrl } = await import('@/lib/chapter-links');
      
      const url1 = normalizeUrl('https://www.mangadex.org/chapter/123/');
      const url2 = normalizeUrl('https://mangadex.org/chapter/123');
      
      expect(url1).toBe(url2);
      
      const hash1 = hashUrl('https://www.mangadex.org/chapter/123/');
      const hash2 = hashUrl('https://mangadex.org/chapter/123');
      
      expect(hash1).toBe(hash2);
    });

    it('should remove tracking parameters', async () => {
      const { normalizeUrl } = await import('@/lib/chapter-links');
      
      const result = normalizeUrl('https://example.com/chapter?utm_source=test&id=123');
      expect(result).toBe('https://example.com/chapter?id=123');
    });
  });

  describe('Source Tier Detection', () => {
    it('should identify official domains', async () => {
      const { getSourceTier, getSourceName } = await import('@/lib/chapter-links');
      
      expect(getSourceTier('viz.com')).toBe('official');
      expect(getSourceTier('mangaplus.shueisha.co.jp')).toBe('official');
      expect(getSourceName('viz.com')).toBe('VIZ Media');
    });

    it('should identify aggregator domains', async () => {
      const { getSourceTier, getSourceName } = await import('@/lib/chapter-links');
      
      expect(getSourceTier('mangadex.org')).toBe('aggregator');
      expect(getSourceName('mangadex.org')).toBe('MangaDex');
    });

    it('should default unknown domains to user tier', async () => {
      const { getSourceTier } = await import('@/lib/chapter-links');
      
      expect(getSourceTier('example.com')).toBe('user');
    });
  });

  describe('Blacklist Checking', () => {
    it('should block blacklisted domains', async () => {
      const { checkBlacklist } = await import('@/lib/chapter-links');
      
      const blacklist = [
        { domain: 'badsite.com', reason: 'malware' },
      ];
      
      const result = checkBlacklist('https://badsite.com/page', blacklist);
      expect(result.isBlocked).toBe(true);
      expect(result.reason).toBe('malware');
    });

    it('should block subdomains of blacklisted domains', async () => {
      const { checkBlacklist } = await import('@/lib/chapter-links');
      
      const blacklist = [
        { domain: 'badsite.com', reason: 'spam' },
      ];
      
      const result = checkBlacklist('https://sub.badsite.com/page', blacklist);
      expect(result.isBlocked).toBe(true);
    });

    it('should allow non-blacklisted domains', async () => {
      const { checkBlacklist } = await import('@/lib/chapter-links');
      
      const blacklist = [
        { domain: 'badsite.com', reason: 'malware' },
      ];
      
      const result = checkBlacklist('https://goodsite.com/page', blacklist);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe('Advisory Lock Key Generation', () => {
    it('should generate consistent lock keys', async () => {
      const { generateChapterLockKey } = await import('@/lib/chapter-links');
      
      const key1 = generateChapterLockKey('series-123', 'chapter-1');
      const key2 = generateChapterLockKey('series-123', 'chapter-1');
      
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different chapters', async () => {
      const { generateChapterLockKey } = await import('@/lib/chapter-links');
      
      const key1 = generateChapterLockKey('series-123', 'chapter-1');
      const key2 = generateChapterLockKey('series-123', 'chapter-2');
      
      expect(key1).not.toBe(key2);
    });
  });

  describe('Report Weight Calculation', () => {
    it('should calculate weight based on trust score', async () => {
      const { calculateReportWeight } = await import('@/lib/chapter-links');
      
      // Max trust (1.0) = weight 2
      expect(calculateReportWeight(1.0)).toBe(2);
      
      // Min trust (0.5) = weight 1
      expect(calculateReportWeight(0.5)).toBe(1);
    });

    it('should clamp out-of-range trust scores', async () => {
      const { calculateReportWeight } = await import('@/lib/chapter-links');
      
      expect(calculateReportWeight(0.1)).toBe(1);
      expect(calculateReportWeight(1.5)).toBe(2);
    });
  });
});
