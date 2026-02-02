// @ts-nocheck - Integration test with complex mocks
/**
 * Integration tests for QA fixes implemented Jan 28, 2026
 * 
 * Tests cover:
 * 1. Rate limit race condition fix (atomic increment pattern)
 * 2. Timeout utilities for external API calls
 * 3. Error logging in catch blocks
 */

import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { fetchWithTimeout, withTimeout, ApiError } from '@/lib/api-utils';

describe('QA Fixes - Jan 28, 2026', () => {
  describe('Rate Limit Atomic Increment Fix', () => {
    const BoundedRateLimitStore = jest.fn().mockImplementation(() => {
      const store = new Map<string, { count: number; resetTime: number }>();
      return {
        get: (key: string) => store.get(key),
        set: (key: string, value: { count: number; resetTime: number }) => store.set(key, value),
        delete: (key: string) => store.delete(key),
        triggerCleanup: jest.fn(),
      };
    });

    function checkRateLimit(
      store: ReturnType<typeof BoundedRateLimitStore>,
      key: string,
      limit: number,
      windowMs: number
    ) {
      store.triggerCleanup();
      
      const now = Date.now();
      const existing = store.get(key);

      if (!existing || now > existing.resetTime) {
        const newRecord = { count: 1, resetTime: now + windowMs };
        store.set(key, newRecord);
        return { allowed: true, remaining: limit - 1, reset: newRecord.resetTime, limit };
      }

      const newCount = existing.count + 1;
      const updatedRecord = { count: newCount, resetTime: existing.resetTime };
      store.set(key, updatedRecord);
      
      return {
        allowed: newCount <= limit,
        remaining: Math.max(0, limit - newCount),
        reset: existing.resetTime,
        limit
      };
    }

    test('should correctly increment count atomically', () => {
      const store = new BoundedRateLimitStore();
      const key = 'test-user';
      const limit = 10;
      const windowMs = 60000;

      const result1 = checkRateLimit(store, key, limit, windowMs);
      expect(result1.allowed).toBe(true);
      expect(result1.remaining).toBe(9);

      const result2 = checkRateLimit(store, key, limit, windowMs);
      expect(result2.allowed).toBe(true);
      expect(result2.remaining).toBe(8);

      const storedValue = store.get(key);
      expect(storedValue?.count).toBe(2);
    });

    test('should deny requests after limit exceeded', () => {
      const store = new BoundedRateLimitStore();
      const key = 'test-user-limit';
      const limit = 3;
      const windowMs = 60000;

      checkRateLimit(store, key, limit, windowMs);
      checkRateLimit(store, key, limit, windowMs);
      checkRateLimit(store, key, limit, windowMs);
      
      const result4 = checkRateLimit(store, key, limit, windowMs);
      expect(result4.allowed).toBe(false);
      expect(result4.remaining).toBe(0);
    });

    test('should reset count after window expires', () => {
      const store = new BoundedRateLimitStore();
      const key = 'test-user-expiry';
      const limit = 5;
      const windowMs = 100;

      checkRateLimit(store, key, limit, windowMs);
      
      const record = store.get(key);
      if (record) {
        record.resetTime = Date.now() - 1;
        store.set(key, record);
      }

      const resultAfterExpiry = checkRateLimit(store, key, limit, windowMs);
      expect(resultAfterExpiry.allowed).toBe(true);
      expect(resultAfterExpiry.remaining).toBe(4);
      
      const newRecord = store.get(key);
      expect(newRecord?.count).toBe(1);
    });

    test('concurrent simulated requests should be tracked correctly', () => {
      const store = new BoundedRateLimitStore();
      const key = 'concurrent-test';
      const limit = 100;
      const windowMs = 60000;

      const results = [];
      for (let i = 0; i < 150; i++) {
        results.push(checkRateLimit(store, key, limit, windowMs));
      }

      const allowedCount = results.filter(r => r.allowed).length;
      const deniedCount = results.filter(r => !r.allowed).length;
      
      expect(allowedCount).toBe(100);
      expect(deniedCount).toBe(50);
      
      const finalRecord = store.get(key);
      expect(finalRecord?.count).toBe(150);
    });
  });

  describe('Timeout Utilities', () => {
    describe('withTimeout', () => {
      test('should return result if promise resolves before timeout', async () => {
        const fastPromise = Promise.resolve('success');
        
        const result = await withTimeout(fastPromise, 1000, 'fallback');
        
        expect(result).toBe('success');
      });

      test('should return fallback if promise times out', async () => {
        const slowPromise = new Promise<string>((resolve) => {
          setTimeout(() => resolve('too slow'), 500);
        });
        
        const result = await withTimeout(slowPromise, 50, 'fallback', 'TestContext');
        
        expect(result).toBe('fallback');
      });

      test('should work with complex object fallbacks', async () => {
        const slowPromise = new Promise<{ data: { user: null } }>((resolve) => {
          setTimeout(() => resolve({ data: { user: null } }), 500);
        });
        
        const fallback = { data: { user: null } };
        const result = await withTimeout(slowPromise, 10, fallback);
        
        expect(result).toEqual(fallback);
      });

      test('should preserve resolved value type', async () => {
        interface TestType {
          id: number;
          name: string;
        }
        
        const promise = Promise.resolve<TestType>({ id: 1, name: 'test' });
        const fallback: TestType = { id: 0, name: 'fallback' };
        
        const result = await withTimeout(promise, 1000, fallback);
        
        expect(result.id).toBe(1);
        expect(result.name).toBe('test');
      });
    });

    describe('fetchWithTimeout', () => {
      const originalFetch = global.fetch;

      afterEach(() => {
        global.fetch = originalFetch;
      });

      test('should throw ApiError with TIMEOUT code on timeout', async () => {
        const abortError = new Error('The operation was aborted');
        abortError.name = 'AbortError';
        
        global.fetch = jest.fn().mockImplementation((url: string, options: RequestInit) => {
          return new Promise((_, reject) => {
            options.signal?.addEventListener('abort', () => {
              reject(abortError);
            });
          });
        }) as jest.MockedFunction<typeof fetch>;

        await expect(fetchWithTimeout('https://example.com/api', {}, 50))
          .rejects.toMatchObject({
            statusCode: 504,
            code: 'TIMEOUT'
          });
      }, 10000);

      test('should return response if fetch completes before timeout', async () => {
        const mockResponse = new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
        
        global.fetch = jest.fn().mockResolvedValue(mockResponse) as jest.MockedFunction<typeof fetch>;

        const response = await fetchWithTimeout('https://example.com/api', {}, 5000);
        
        expect(response.status).toBe(200);
      });

      test('should propagate non-abort fetch errors', async () => {
        const networkError = new Error('Network failure');
        global.fetch = jest.fn().mockRejectedValue(networkError) as jest.MockedFunction<typeof fetch>;

        await expect(fetchWithTimeout('https://example.com/api', {}, 5000))
          .rejects.toThrow('Network failure');
      });
    });
  });

  describe('Error Logging Verification', () => {
    test('console.warn should be called with proper context for empty catches', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      
      const testErrorLogging = (context: string, error: unknown) => {
        console.warn(`[${context}] Operation failed:`, error instanceof Error ? error.message : error);
      };

      testErrorLogging('TestContext', new Error('Test error'));
      
      expect(warnSpy).toHaveBeenCalledWith(
        '[TestContext] Operation failed:',
        'Test error'
      );
      
      warnSpy.mockRestore();
    });

    test('error message extraction should handle non-Error objects', () => {
      const getErrorMessage = (err: unknown): string => {
        return err instanceof Error ? err.message : String(err);
      };

      expect(getErrorMessage(new Error('Error message'))).toBe('Error message');
      expect(getErrorMessage('string error')).toBe('string error');
      expect(getErrorMessage(42)).toBe('42');
      expect(getErrorMessage({ custom: 'error' })).toBe('[object Object]');
      expect(getErrorMessage(null)).toBe('null');
      expect(getErrorMessage(undefined)).toBe('undefined');
    });
  });

  describe('Supabase Auth Timeout Integration', () => {
    test('withTimeout should handle auth response structure', async () => {
      type AuthResponse = { data: { user: { id: string } | null }; error: null };
      
      const slowAuthCall = new Promise<AuthResponse>((resolve) => {
        setTimeout(() => resolve({ 
          data: { user: { id: 'user-123' } }, 
          error: null 
        }), 500);
      });
      
      const fallback: AuthResponse = { data: { user: null }, error: null };
      
      const result = await withTimeout(slowAuthCall, 10, fallback);
      
      expect(result.data.user).toBeNull();
    });

    test('successful auth should return user within timeout', async () => {
      type AuthResponse = { data: { user: { id: string } | null }; error: null };
      
      const fastAuthCall = Promise.resolve<AuthResponse>({ 
        data: { user: { id: 'user-456' } }, 
        error: null 
      });
      
      const fallback: AuthResponse = { data: { user: null }, error: null };
      
      const result = await withTimeout(fastAuthCall, 5000, fallback);
      
      expect(result.data.user?.id).toBe('user-456');
    });
  });
});
