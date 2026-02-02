import { sanitizeInput, validateUUID, ApiError, ErrorCodes } from '@/lib/api-utils';
import { addXp, MAX_XP } from '@/lib/gamification/xp';

describe('Integration Security & Data Integrity Tests', () => {
  describe('Input Sanitization', () => {
    it('should remove null bytes from input', () => {
      const input = 'malicious\x00input';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe('maliciousinput');
    });

    it('should remove HTML tags', () => {
      const input = '<script>alert(1)</script>Hello';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe('alert(1)Hello');
    });

    it('should remove dangerous protocols', () => {
      const input = 'javascript:alert(1)';
      const sanitized = sanitizeInput(input);
      expect(sanitized).toBe('alert(1)');
    });
  });

  describe('Data Integrity - XP System', () => {
    it('should cap XP at MAX_XP when adding', () => {
      const currentXp = MAX_XP - 5;
      const addedXp = 10;
      const newXp = addXp(currentXp, addedXp);
      expect(newXp).toBe(MAX_XP);
    });

    it('should not allow negative XP', () => {
      const currentXp = 10;
      const addedXp = -20;
      const newXp = addXp(currentXp, addedXp);
      expect(newXp).toBe(0);
    });
  });

  describe('Security Validation', () => {
    it('should throw ApiError for invalid UUID', () => {
      const invalidUuid = 'not-a-uuid';
      expect(() => validateUUID(invalidUuid)).toThrow(ApiError);
      try {
        validateUUID(invalidUuid);
      } catch (e: any) {
        expect(e.statusCode).toBe(400);
        expect(e.code).toBe('INVALID_FORMAT');
      }
    });

    it('should pass for valid UUID', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(() => validateUUID(validUuid)).not.toThrow();
    });
  });

  describe('Error Handling Standardization', () => {
    it('should use ErrorCodes for consistency', () => {
      const error = new ApiError('Not Found', 404, ErrorCodes.NOT_FOUND);
      expect(error.code).toBe('NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });
});
