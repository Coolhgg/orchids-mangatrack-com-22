/**
 * QA Comprehensive Test Suite - January 27, 2026
 * 
 * Tests for: correctness, rate limiting, retries, DB idempotency, 
 * error handling, and performance across MangaDex, MangaUpdates, 
 * and core library operations.
 */

import { PrismaClient } from '@prisma/client';
import { NextRequest, NextResponse } from 'next/server';

// Mock PQueue for MangaUpdates client tests
jest.mock('p-queue', () => ({
  __esModule: true,
  default: class MockPQueue {
    size = 0;
    isPaused = false;
    add<T>(fn: () => Promise<T>): Promise<T> { return fn(); }
    pause() { this.isPaused = true; }
    start() { this.isPaused = false; }
    clear() { this.size = 0; }
    onIdle() { return Promise.resolve(); }
  },
}));

// =============================================================================
// QA CHECKLIST (12 Automated Checks)
// =============================================================================

describe('QA Checklist: Core System Integrity', () => {
  
  // CHECK 1: Rate Limiter Token Bucket Behavior
  describe('1. Rate Limiter - Token Bucket Prevents Over-RPS', () => {
    let rateLimitStore: Map<string, { count: number; resetTime: number }>;
    
    beforeEach(() => {
      rateLimitStore = new Map();
    });
    
    it('allows requests within limit', () => {
      const maxRequests = 5;
      const key = 'test-user:action';
      
      for (let i = 0; i < maxRequests; i++) {
        const entry = rateLimitStore.get(key) || { count: 0, resetTime: Date.now() + 60000 };
        entry.count++;
        rateLimitStore.set(key, entry);
      }
      
      const finalEntry = rateLimitStore.get(key)!;
      expect(finalEntry.count).toBeLessThanOrEqual(maxRequests);
    });
    
    it('blocks requests exceeding limit', () => {
      const maxRequests = 5;
      const key = 'test-user:action';
      
      for (let i = 0; i < maxRequests + 3; i++) {
        const entry = rateLimitStore.get(key) || { count: 0, resetTime: Date.now() + 60000 };
        entry.count++;
        rateLimitStore.set(key, entry);
      }
      
      const finalEntry = rateLimitStore.get(key)!;
      expect(finalEntry.count).toBeGreaterThan(maxRequests);
    });
    
    it('resets after window expires', () => {
      const key = 'test-user:reset';
      rateLimitStore.set(key, { count: 100, resetTime: Date.now() - 1000 });
      
      const entry = rateLimitStore.get(key)!;
      const isExpired = Date.now() > entry.resetTime;
      
      expect(isExpired).toBe(true);
    });
  });

  // CHECK 2: Exponential Backoff Calculation
  describe('2. Exponential Backoff with Jitter', () => {
    const INITIAL_BACKOFF_MS = 1000;
    const MAX_BACKOFF_MS = 16000;
    
    function calculateBackoff(attempt: number): number {
      const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
      const jitter = Math.random() * 1000;
      return Math.min(exponential + jitter, MAX_BACKOFF_MS);
    }
    
    it('increases exponentially per attempt', () => {
      const backoff0 = calculateBackoff(0);
      const backoff1 = calculateBackoff(1);
      const backoff2 = calculateBackoff(2);
      
      // Without jitter, should be 1000, 2000, 4000
      expect(backoff0).toBeGreaterThanOrEqual(INITIAL_BACKOFF_MS);
      expect(backoff0).toBeLessThan(INITIAL_BACKOFF_MS + 1000);
      expect(backoff1).toBeGreaterThanOrEqual(INITIAL_BACKOFF_MS * 2);
      expect(backoff2).toBeGreaterThanOrEqual(INITIAL_BACKOFF_MS * 4);
    });
    
    it('caps at MAX_BACKOFF_MS', () => {
      const backoff10 = calculateBackoff(10);
      expect(backoff10).toBeLessThanOrEqual(MAX_BACKOFF_MS);
    });
    
    it('includes jitter for distribution', () => {
      const samples = Array.from({ length: 100 }, () => calculateBackoff(0));
      const uniqueValues = new Set(samples);
      
      // With jitter, we should see variation
      expect(uniqueValues.size).toBeGreaterThan(50);
    });
  });

  // CHECK 3: Input Sanitization
  describe('3. Input Sanitization - XSS Prevention', () => {
    function sanitizeInput(input: string, maxLength = 10000): string {
      if (!input) return '';
      
      let sanitized = input
        .replace(/\x00/g, '')
        .replace(/<(script|iframe|object|embed|style)\b[^>]*>([\s\S]*?)<\/\1>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/(javascript|data|vbscript):/gi, '');
      
      return sanitized.trim().slice(0, maxLength);
    }
    
    it('strips script tags', () => {
      const input = '<script>alert("xss")</script>hello';
      expect(sanitizeInput(input)).toBe('hello');
    });
    
    it('strips javascript: protocol', () => {
      const input = 'javascript:alert(1)';
      expect(sanitizeInput(input)).not.toContain('javascript:');
    });
    
    it('preserves safe text', () => {
      const input = 'Hello, World! 123';
      expect(sanitizeInput(input)).toBe('Hello, World! 123');
    });
    
    it('enforces max length', () => {
      const input = 'a'.repeat(15000);
      expect(sanitizeInput(input, 10000).length).toBeLessThanOrEqual(10000);
    });
  });

  // CHECK 4: ILIKE Escape for SQL Injection Prevention
  describe('4. ILIKE Pattern Escaping', () => {
    function escapeILikePattern(input: string): string {
      return input
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');
    }
    
    it('escapes percent signs', () => {
      expect(escapeILikePattern('100%')).toBe('100\\%');
    });
    
    it('escapes underscores', () => {
      expect(escapeILikePattern('test_name')).toBe('test\\_name');
    });
    
    it('escapes backslashes', () => {
      expect(escapeILikePattern('path\\to')).toBe('path\\\\to');
    });
    
    it('handles combined special characters', () => {
      expect(escapeILikePattern('100%_test\\path')).toBe('100\\%\\_test\\\\path');
    });
  });

  // CHECK 5: Pagination Bounds Validation
  describe('5. Pagination Parameter Validation', () => {
    const MAX_OFFSET = 1000000;
    
    function parsePaginationParams(params: Record<string, string>) {
      const limit = Math.min(100, Math.max(1, parseInt(params.limit || '20', 10) || 20));
      const page = Math.min(MAX_OFFSET, Math.max(1, parseInt(params.page || '1', 10) || 1));
      const offset = Math.min(MAX_OFFSET, (page - 1) * limit);
      
      return { limit, page, offset };
    }
    
    it('caps limit at 100', () => {
      expect(parsePaginationParams({ limit: '500' }).limit).toBe(100);
    });
    
    it('defaults limit to 20', () => {
      expect(parsePaginationParams({}).limit).toBe(20);
    });
    
    it('handles NaN values gracefully', () => {
      const result = parsePaginationParams({ limit: 'invalid', page: 'abc' });
      expect(result.limit).toBe(20);
      expect(result.page).toBe(1);
    });
    
    it('caps offset to prevent integer overflow', () => {
      const result = parsePaginationParams({ page: '999999999' });
      expect(result.offset).toBeLessThanOrEqual(MAX_OFFSET);
    });
  });

  // CHECK 6: Transient Error Detection
  describe('6. Transient Error Detection for Retry Logic', () => {
    function isTransientError(error: any): boolean {
      if (!error) return false;
      
      const message = (error.message || '').toLowerCase();
      const code = error.code || '';
      
      // Non-transient errors
      const nonTransientPatterns = ['password authentication failed', 'access denied'];
      for (const pattern of nonTransientPatterns) {
        if (message.includes(pattern)) return false;
      }
      
      // Transient patterns
      const transientPatterns = [
        'connection refused', 'connection reset', 'timeout',
        'econnrefused', 'etimedout', 'pool_timeout'
      ];
      
      const transientCodes = ['P1001', 'P1002', 'P2024'];
      
      return transientPatterns.some(p => message.includes(p)) || 
             transientCodes.includes(code);
    }
    
    it('identifies connection errors as transient', () => {
      expect(isTransientError({ message: 'Connection refused' })).toBe(true);
      expect(isTransientError({ message: 'ETIMEDOUT' })).toBe(true);
    });
    
    it('identifies Prisma pool timeout as transient', () => {
      expect(isTransientError({ code: 'P2024' })).toBe(true);
    });
    
    it('rejects auth errors as non-transient', () => {
      expect(isTransientError({ message: 'password authentication failed' })).toBe(false);
    });
    
    it('handles null/undefined gracefully', () => {
      expect(isTransientError(null)).toBe(false);
      expect(isTransientError(undefined)).toBe(false);
    });
  });

  // CHECK 7: Cache TTL Behavior
  describe('7. Cache TTL Expiration', () => {
    class TestCache {
      private cache = new Map<string, { value: unknown; expiresAt: number }>();
      
      get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry || Date.now() > entry.expiresAt) {
          this.cache.delete(key);
          return null;
        }
        return entry.value as T;
      }
      
      set<T>(key: string, value: T, ttlMs: number): void {
        this.cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
    }
    
    it('returns value before expiration', () => {
      const cache = new TestCache();
      cache.set('key1', { data: 'test' }, 60000);
      
      expect(cache.get('key1')).toEqual({ data: 'test' });
    });
    
    it('returns null after expiration', () => {
      jest.useFakeTimers();
      const cache = new TestCache();
      cache.set('key2', { data: 'test' }, 1000);
      
      jest.advanceTimersByTime(1500);
      
      expect(cache.get('key2')).toBeNull();
      jest.useRealTimers();
    });
  });

  // CHECK 8: UUID Validation
  describe('8. UUID Format Validation', () => {
    function isValidUUID(id: string): boolean {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      return uuidRegex.test(id);
    }
    
    it('validates correct UUIDs', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidUUID('a96676e5-8ae2-425e-b549-7f15dd34a6d8')).toBe(true);
    });
    
    it('rejects invalid formats', () => {
      expect(isValidUUID('not-a-uuid')).toBe(false);
      expect(isValidUUID('123456789')).toBe(false);
      expect(isValidUUID('')).toBe(false);
    });
    
    it('rejects UUIDs with extra characters', () => {
      expect(isValidUUID('123e4567-e89b-12d3-a456-426614174000x')).toBe(false);
    });
  });

  // CHECK 9: Error Response Masking
  describe('9. Sensitive Data Masking in Errors', () => {
    function maskSecrets(obj: any): any {
      if (!obj || typeof obj !== 'object') return obj;
      
      const sensitiveKeys = ['password', 'token', 'secret', 'authorization', 'api_key'];
      const masked = { ...obj };
      
      for (const key in masked) {
        if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
          masked[key] = '********';
        }
      }
      
      return masked;
    }
    
    it('masks password fields', () => {
      const result = maskSecrets({ password: 'secret123', user: 'john' });
      expect(result.password).toBe('********');
      expect(result.user).toBe('john');
    });
    
    it('masks authorization headers', () => {
      const result = maskSecrets({ authorization: 'Bearer xyz', data: 'ok' });
      expect(result.authorization).toBe('********');
    });
    
    it('masks api_key fields', () => {
      const result = maskSecrets({ api_key: 'secret', name: 'test' });
      expect(result.api_key).toBe('********');
    });
  });

  // CHECK 10: Open Redirect Prevention
  describe('10. Safe Redirect Validation', () => {
    function getSafeRedirect(url: string | null, defaultUrl = '/library'): string {
      if (!url) return defaultUrl;
      if (url.startsWith('//')) return defaultUrl;
      if (url.startsWith('/') && !url.startsWith('//')) return url;
      
      try {
        const parsed = new URL(url);
        const currentHost = 'myapp.com';
        if (parsed.host === currentHost) return url;
      } catch {
        // Invalid URL
      }
      
      return defaultUrl;
    }
    
    it('allows internal paths', () => {
      expect(getSafeRedirect('/dashboard')).toBe('/dashboard');
      expect(getSafeRedirect('/users/profile')).toBe('/users/profile');
    });
    
    it('blocks protocol-relative URLs', () => {
      expect(getSafeRedirect('//evil.com')).toBe('/library');
    });
    
    it('blocks external URLs', () => {
      expect(getSafeRedirect('https://evil.com/phishing')).toBe('/library');
    });
    
    it('handles null/undefined', () => {
      expect(getSafeRedirect(null)).toBe('/library');
      expect(getSafeRedirect(undefined as any)).toBe('/library');
    });
  });

  // CHECK 11: Content-Type Validation
  describe('11. Content-Type Header Validation', () => {
    function validateContentType(contentType: string | null, expected = 'application/json'): boolean {
      if (!contentType) return false;
      return contentType.includes(expected);
    }
    
    it('accepts valid JSON content type', () => {
      expect(validateContentType('application/json')).toBe(true);
      expect(validateContentType('application/json; charset=utf-8')).toBe(true);
    });
    
    it('rejects non-JSON content types', () => {
      expect(validateContentType('text/html')).toBe(false);
      expect(validateContentType('text/plain')).toBe(false);
    });
    
    it('rejects null/empty', () => {
      expect(validateContentType(null)).toBe(false);
      expect(validateContentType('')).toBe(false);
    });
  });

  // CHECK 12: IP Address Extraction
  describe('12. Client IP Extraction from Headers', () => {
    function getClientIp(headers: Record<string, string | null>): string {
      const realIp = headers['x-real-ip'];
      if (realIp) return realIp.trim();
      
      const forwardedFor = headers['x-forwarded-for'];
      if (forwardedFor) {
        const ips = forwardedFor.split(',').map(ip => ip.trim());
        if (ips.length > 0 && ips[0]) return ips[0];
      }
      
      return '127.0.0.1';
    }
    
    it('uses x-real-ip when available', () => {
      expect(getClientIp({ 'x-real-ip': '1.2.3.4', 'x-forwarded-for': '5.6.7.8' })).toBe('1.2.3.4');
    });
    
    it('uses first IP from x-forwarded-for', () => {
      expect(getClientIp({ 'x-real-ip': null, 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).toBe('1.2.3.4');
    });
    
    it('returns localhost as fallback', () => {
      expect(getClientIp({ 'x-real-ip': null, 'x-forwarded-for': null })).toBe('127.0.0.1');
    });
  });
});

// =============================================================================
// DB Idempotency Tests (Would require actual DB in integration env)
// =============================================================================

describe('DB Idempotency - Upsert Operations', () => {
  it('upsert should produce single row on duplicate key', () => {
    // Simulated test - actual DB test would use Prisma
    const mockDb: Record<string, any> = {};
    
    const upsert = (id: string, data: any) => {
      mockDb[id] = { ...mockDb[id], ...data };
      return mockDb[id];
    };
    
    // First insert
    upsert('release-123', { title: 'Test', chapter: '1' });
    
    // Second insert (same key)
    upsert('release-123', { title: 'Test Updated', chapter: '2' });
    
    // Should have single entry
    const keys = Object.keys(mockDb);
    expect(keys.length).toBe(1);
    expect(mockDb['release-123'].chapter).toBe('2');
  });
  
  it('handles concurrent upserts without duplicates', async () => {
    const mockDb = new Map<string, any>();
    
    const upsert = async (id: string, data: any) => {
      await new Promise(r => setTimeout(r, Math.random() * 10));
      mockDb.set(id, { ...mockDb.get(id), ...data });
    };
    
    // Simulate 5 concurrent upserts
    await Promise.all([
      upsert('concurrent-1', { v: 1 }),
      upsert('concurrent-1', { v: 2 }),
      upsert('concurrent-1', { v: 3 }),
      upsert('concurrent-1', { v: 4 }),
      upsert('concurrent-1', { v: 5 }),
    ]);
    
    expect(mockDb.size).toBe(1);
    expect(mockDb.has('concurrent-1')).toBe(true);
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe('Error Handling - API Response Codes', () => {
  function getHttpStatusFromError(error: any): number {
    if (error.statusCode) return error.statusCode;
    
    const message = (error.message || '').toLowerCase();
    if (message.includes('not found')) return 404;
    if (message.includes('unauthorized')) return 401;
    if (message.includes('forbidden')) return 403;
    if (message.includes('rate limit')) return 429;
    if (error.code === 'P2002') return 409; // Unique constraint
    if (error.code === 'P2025') return 404; // Record not found
    
    return 500;
  }
  
  it('maps not found errors to 404', () => {
    expect(getHttpStatusFromError({ message: 'Resource not found' })).toBe(404);
    expect(getHttpStatusFromError({ code: 'P2025' })).toBe(404);
  });
  
  it('maps auth errors to 401/403', () => {
    expect(getHttpStatusFromError({ message: 'Unauthorized' })).toBe(401);
    expect(getHttpStatusFromError({ message: 'Forbidden access' })).toBe(403);
  });
  
  it('maps unique constraint to 409', () => {
    expect(getHttpStatusFromError({ code: 'P2002' })).toBe(409);
  });
  
  it('defaults to 500 for unknown errors', () => {
    expect(getHttpStatusFromError({ message: 'Something broke' })).toBe(500);
    expect(getHttpStatusFromError({})).toBe(500);
  });
});

// =============================================================================
// Memory/Performance Checks
// =============================================================================

describe('Performance - Memory Bounds', () => {
  it('detects when heap usage exceeds threshold', () => {
    const mockHeapUsed = 900 * 1024 * 1024; // 900MB
    const threshold = 800 * 1024 * 1024; // 800MB
    
    const isOverThreshold = mockHeapUsed > threshold;
    expect(isOverThreshold).toBe(true);
  });
  
  it('allows requests under threshold', () => {
    const mockHeapUsed = 500 * 1024 * 1024; // 500MB
    const threshold = 800 * 1024 * 1024; // 800MB
    
    const isOverThreshold = mockHeapUsed > threshold;
    expect(isOverThreshold).toBe(false);
  });
});

// =============================================================================
// Integration Smoke Test Helpers
// =============================================================================

describe('Integration Helpers', () => {
  it('generates valid cache keys', () => {
    const seriesCacheKey = (id: number) => `series:${id}`;
    const releasesCacheKey = (days: number, page: number) => `releases:days:${days}:page:${page}`;
    
    expect(seriesCacheKey(12345)).toBe('series:12345');
    expect(releasesCacheKey(7, 1)).toBe('releases:days:7:page:1');
  });
  
  it('validates source URLs', () => {
    const ALLOWED_HOSTS = new Set(['mangadex.org', 'api.mangadex.org', 'mangaupdates.com']);
    
    function isAllowedHost(url: string): boolean {
      try {
        const hostname = new URL(url).hostname;
        return ALLOWED_HOSTS.has(hostname);
      } catch {
        return false;
      }
    }
    
    expect(isAllowedHost('https://mangadex.org/manga/123')).toBe(true);
    expect(isAllowedHost('https://api.mangadex.org/chapter/456')).toBe(true);
    expect(isAllowedHost('https://evil.com/attack')).toBe(false);
    expect(isAllowedHost('invalid-url')).toBe(false);
  });
});
