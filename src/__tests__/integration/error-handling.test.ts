import { 
  ApiError, 
  ErrorCodes, 
  sanitizeInput,
  escapeILikePattern,
  checkRateLimit,
  validateUUID
} from '@/lib/api-utils';

describe('Error Handling Standardization', () => {
  describe('ApiError Class', () => {
    it('should create error with all properties', () => {
      const error = new ApiError('Test error', 400, ErrorCodes.VALIDATION_ERROR);
      
      expect(error.message).toBe('Test error');
      expect(error.statusCode).toBe(400);
      expect(error.code).toBe(ErrorCodes.VALIDATION_ERROR);
      expect(error).toBeInstanceOf(Error);
    });

    it('should default statusCode to 500', () => {
      const error = new ApiError('Server error');
      
      expect(error.statusCode).toBe(500);
    });

    it('should preserve stack trace', () => {
      const error = new ApiError('Test', 400);
      
      expect(error.stack).toBeDefined();
      expect(error.stack).toContain('ApiError');
    });
  });

  describe('Error Code Coverage', () => {
    it('should have all standard error codes', () => {
      expect(ErrorCodes.BAD_REQUEST).toBeDefined();
      expect(ErrorCodes.UNAUTHORIZED).toBeDefined();
      expect(ErrorCodes.FORBIDDEN).toBeDefined();
      expect(ErrorCodes.NOT_FOUND).toBeDefined();
      expect(ErrorCodes.VALIDATION_ERROR).toBeDefined();
      expect(ErrorCodes.RATE_LIMITED).toBeDefined();
      expect(ErrorCodes.INTERNAL_ERROR).toBeDefined();
    });

    it('should create errors with correct status codes', () => {
      const errorMappings = [
        { code: ErrorCodes.BAD_REQUEST, status: 400 },
        { code: ErrorCodes.UNAUTHORIZED, status: 401 },
        { code: ErrorCodes.FORBIDDEN, status: 403 },
        { code: ErrorCodes.NOT_FOUND, status: 404 },
        { code: ErrorCodes.VALIDATION_ERROR, status: 400 },
        { code: ErrorCodes.RATE_LIMITED, status: 429 },
        { code: ErrorCodes.INTERNAL_ERROR, status: 500 },
      ];

      errorMappings.forEach(({ code, status }) => {
        const error = new ApiError('Test', status, code);
        expect(error.statusCode).toBe(status);
        expect(error.code).toBe(code);
      });
    });
  });

  describe('Input Sanitization', () => {
    it('should sanitize XSS attempts', () => {
      const malicious = '<script>alert("xss")</script>';
      const sanitized = sanitizeInput(malicious, 200);
      
      expect(sanitized).not.toContain('<script>');
      expect(sanitized).not.toContain('</script>');
    });

    it('should truncate to max length', () => {
      const longInput = 'a'.repeat(500);
      const sanitized = sanitizeInput(longInput, 100);
      
      expect(sanitized.length).toBeLessThanOrEqual(100);
    });

    it('should handle null/undefined gracefully', () => {
      expect(sanitizeInput(null as any, 100)).toBe('');
      expect(sanitizeInput(undefined as any, 100)).toBe('');
    });

    it('should preserve safe characters', () => {
      const safe = 'Hello World 123 !@#$%';
      const sanitized = sanitizeInput(safe, 100);
      
      expect(sanitized).toBe(safe);
    });

    it('should handle unicode characters', () => {
      const unicode = '日本語テスト 🎉';
      const sanitized = sanitizeInput(unicode, 100);
      
      expect(sanitized).toContain('日本語');
    });
  });

  describe('SQL ILIKE Pattern Escaping', () => {
    it('should escape wildcard characters', () => {
      expect(escapeILikePattern('test%')).toBe('test\\%');
      expect(escapeILikePattern('test_')).toBe('test\\_');
    });

    it('should escape backslashes', () => {
      expect(escapeILikePattern('test\\')).toBe('test\\\\');
    });

    it('should handle multiple special characters', () => {
      const input = '%_\\test%_\\';
      const escaped = escapeILikePattern(input);
      
      expect(escaped).toBe('\\%\\_\\\\test\\%\\_\\\\');
    });

    it('should handle empty string', () => {
      expect(escapeILikePattern('')).toBe('');
    });

    it('should handle regular strings unchanged', () => {
      expect(escapeILikePattern('normal string')).toBe('normal string');
    });
  });

  describe('UUID Validation', () => {
    const validUUIDs = [
      '123e4567-e89b-12d3-a456-426614174000',
      'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      '550e8400-e29b-41d4-a716-446655440000',
    ];

    const invalidUUIDs = [
      'not-a-uuid',
      '123',
      '',
      '123e4567-e89b-12d3-a456-42661417400', // too short
      '123e4567-e89b-12d3-a456-4266141740000', // too long
      '123e4567-e89b-62d3-a456-426614174000', // wrong version
      'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    ];

    validUUIDs.forEach(uuid => {
      it(`should accept valid UUID: ${uuid}`, () => {
        expect(() => validateUUID(uuid)).not.toThrow();
      });
    });

    invalidUUIDs.forEach(uuid => {
      it(`should reject invalid UUID: ${String(uuid)}`, () => {
        expect(() => validateUUID(uuid as string)).toThrow(ApiError);
      });
    });
  });

  describe('Error Response Format Consistency', () => {
    it('should create ApiError with all required fields', () => {
      const error = new ApiError('Test', 400, ErrorCodes.BAD_REQUEST);
      
      expect(error).toHaveProperty('message');
      expect(error).toHaveProperty('statusCode');
      expect(error).toHaveProperty('code');
    });

    it('should inherit from Error', () => {
      const error = new ApiError('Test', 400);
      
      expect(error instanceof Error).toBe(true);
      expect(error.name).toBe('ApiError');
    });
  });
});

describe('Rate Limiting Behavior', () => {
  it('should handle concurrent rate limit checks', async () => {
    const key = `test-concurrent-${Date.now()}`;
    const limit = 5;
    const window = 60000;
    
    const results = await Promise.all(
      Array.from({ length: 10 }, () => checkRateLimit(key, limit, window))
    );
    
    const allowed = results.filter(r => r === true).length;
    const blocked = results.filter(r => r === false).length;
    
    expect(allowed).toBeLessThanOrEqual(limit);
    expect(allowed + blocked).toBe(10);
  });

  it('should reset after window expires', async () => {
    const key = `test-reset-${Date.now()}`;
    
    await checkRateLimit(key, 1, 100);
    const blocked = await checkRateLimit(key, 1, 100);
    
    expect(blocked).toBe(false);
    
    await new Promise(resolve => setTimeout(resolve, 150));
    
    const allowedAfterReset = await checkRateLimit(key, 1, 100);
    expect(allowedAfterReset).toBe(true);
  });
});
