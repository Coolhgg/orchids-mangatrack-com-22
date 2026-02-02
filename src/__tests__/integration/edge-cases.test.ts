import { parsePaginationParams, checkRateLimit, sanitizeInput, validateOrigin, ApiError, ErrorCodes, escapeILikePattern, getSafeRedirect, isIpInRange } from '@/lib/api-utils';
import { isTransientError } from '@/lib/prisma';

describe('Edge Cases Integration Tests', () => {
  
  describe('BUG-002: Pagination Offset Upper Bound', () => {
    it('should cap offset at MAX_OFFSET (1000000)', () => {
      const searchParams = new URLSearchParams({ offset: '9999999' });
      const result = parsePaginationParams(searchParams);
      expect(result.offset).toBe(1000000);
    });

    it('should handle negative offset gracefully', () => {
      const searchParams = new URLSearchParams({ offset: '-100' });
      const result = parsePaginationParams(searchParams);
      expect(result.offset).toBe(0);
    });

    it('should handle NaN offset gracefully', () => {
      const searchParams = new URLSearchParams({ offset: 'abc' });
      const result = parsePaginationParams(searchParams);
      expect(result.offset).toBe(0);
    });

    it('should calculate page correctly from capped offset', () => {
      const searchParams = new URLSearchParams({ offset: '9999999', limit: '20' });
      const result = parsePaginationParams(searchParams);
      expect(result.page).toBe(Math.floor(1000000 / 20) + 1);
    });

    it('should handle limit bounds', () => {
      const searchParams = new URLSearchParams({ limit: '500' });
      const result = parsePaginationParams(searchParams);
      expect(result.limit).toBe(100);
    });

    it('should support cursor pagination', () => {
      const searchParams = new URLSearchParams({ cursor: 'abc123' });
      const result = parsePaginationParams(searchParams);
      expect(result.cursor).toBe('abc123');
    });
  });

  describe('Sanitization Edge Cases', () => {
    it('should handle extremely long input', () => {
      const longInput = 'a'.repeat(100000);
      const result = sanitizeInput(longInput, 100);
      expect(result.length).toBeLessThanOrEqual(100);
    });

    it('should strip XSS attempts', () => {
      const xssInput = '<script>alert("xss")</script>';
      const result = sanitizeInput(xssInput);
      expect(result).not.toContain('<script>');
      expect(result).not.toContain('</script>');
    });

    it('should strip javascript: protocol', () => {
      const jsInput = 'javascript:alert(1)';
      const result = sanitizeInput(jsInput);
      expect(result).not.toContain('javascript:');
    });

    it('should strip event handlers', () => {
      const eventInput = 'onclick=alert(1)';
      const result = sanitizeInput(eventInput);
      expect(result).not.toMatch(/onclick\s*=/i);
    });

    it('should handle null bytes', () => {
      const nullInput = 'test\x00value';
      const result = sanitizeInput(nullInput);
      expect(result).not.toContain('\x00');
    });

    it('should handle empty string', () => {
      const result = sanitizeInput('');
      expect(result).toBe('');
    });
  });

  describe('SQL ILIKE Escape', () => {
    it('should escape percent signs', () => {
      const result = escapeILikePattern('100%');
      expect(result).toBe('100\\%');
    });

    it('should escape underscores', () => {
      const result = escapeILikePattern('test_value');
      expect(result).toBe('test\\_value');
    });

    it('should escape backslashes', () => {
      const result = escapeILikePattern('path\\to\\file');
      expect(result).toBe('path\\\\to\\\\file');
    });

    it('should handle multiple special characters', () => {
      const result = escapeILikePattern('100%_test\\path');
      expect(result).toBe('100\\%\\_test\\\\path');
    });
  });

  describe('Safe Redirect Validation', () => {
    it('should allow internal paths', () => {
      expect(getSafeRedirect('/library')).toBe('/library');
      expect(getSafeRedirect('/users/test')).toBe('/users/test');
    });

    it('should block protocol-relative URLs', () => {
      expect(getSafeRedirect('//evil.com')).toBe('/library');
    });

    it('should block external URLs', () => {
      expect(getSafeRedirect('https://evil.com')).toBe('/library');
    });

    it('should handle null/undefined', () => {
      expect(getSafeRedirect(null)).toBe('/library');
      expect(getSafeRedirect(undefined)).toBe('/library');
    });

    it('should handle empty string', () => {
      expect(getSafeRedirect('')).toBe('/library');
    });
  });

  describe('IP Range Validation', () => {
    it('should validate IP in CIDR range', () => {
      expect(isIpInRange('192.168.1.1', '192.168.1.0/24')).toBe(true);
      expect(isIpInRange('192.168.2.1', '192.168.1.0/24')).toBe(false);
    });

    it('should handle /32 (single IP)', () => {
      expect(isIpInRange('127.0.0.1', '127.0.0.1/32')).toBe(true);
      expect(isIpInRange('127.0.0.2', '127.0.0.1/32')).toBe(false);
    });

    it('should handle exact match without CIDR', () => {
      expect(isIpInRange('127.0.0.1', '127.0.0.1')).toBe(true);
    });

    it('should handle invalid IPs gracefully', () => {
      expect(isIpInRange('invalid', '192.168.1.0/24')).toBe(false);
      expect(isIpInRange('192.168.1.1', 'invalid')).toBe(false);
    });
  });

  describe('Transient Error Detection', () => {
    it('should detect connection refused errors', () => {
      const error = new Error('Connection refused');
      expect(isTransientError(error)).toBe(true);
    });

    it('should detect connection timeout errors', () => {
      const error = new Error('Connection timed out');
      expect(isTransientError(error)).toBe(true);
    });

    it('should detect pool timeout errors', () => {
      const error = new Error('pool_timeout: connection pool exhausted');
      expect(isTransientError(error)).toBe(true);
    });

    it('should NOT detect auth errors as transient', () => {
      const error = new Error('Password authentication failed');
      expect(isTransientError(error)).toBe(false);
    });

    it('should NOT detect permission errors as transient', () => {
      const error = new Error('Permission denied for table users');
      expect(isTransientError(error)).toBe(false);
    });

    it('should handle null error', () => {
      expect(isTransientError(null)).toBe(false);
    });
  });

  describe('ApiError Class', () => {
    it('should create error with all properties', () => {
      const error = new ApiError('Test error', 400, ErrorCodes.BAD_REQUEST);
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCodes.BAD_REQUEST);
      expect(error.name).toBe('ApiError');
    });

    it('should default to 500 status code', () => {
      const error = new ApiError('Server error');
      expect(error.statusCode).toBe(500);
    });
  });

  describe('Rate Limiting Edge Cases', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('should return true for first request', async () => {
      const uniqueKey = `test-rate-limit-${Date.now()}-${Math.random()}`;
      const result = await checkRateLimit(uniqueKey, 5, 60000);
      expect(result).toBe(true);
    });

    it('should handle rapid sequential requests', async () => {
      const uniqueKey = `rapid-test-${Date.now()}-${Math.random()}`;
      const results = await Promise.all([
        checkRateLimit(uniqueKey, 3, 60000),
        checkRateLimit(uniqueKey, 3, 60000),
        checkRateLimit(uniqueKey, 3, 60000),
      ]);
      
      const allowed = results.filter(r => r === true).length;
      expect(allowed).toBeGreaterThanOrEqual(1);
    });
  });

  describe('CSRF Origin Validation', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: originalEnv, writable: true });
    });

    it('should skip validation in development', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'development', writable: true });
      const mockRequest = {
        headers: {
          get: jest.fn().mockReturnValue('https://evil.com'),
        },
      } as unknown as Request;
      
      expect(() => validateOrigin(mockRequest)).not.toThrow();
    });

    it('should allow matching origins', () => {
      Object.defineProperty(process.env, 'NODE_ENV', { value: 'production', writable: true });
      const mockRequest = {
        headers: {
          get: jest.fn((header: string) => {
            if (header === 'origin') return 'https://example.com';
            if (header === 'host') return 'example.com';
            return null;
          }),
        },
      } as unknown as Request;
      
      expect(() => validateOrigin(mockRequest)).not.toThrow();
    });
  });
});
