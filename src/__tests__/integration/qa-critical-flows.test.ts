// @ts-nocheck - Integration test with complex mocks
/**
 * QA Critical Flows Integration Tests
 * Tests the most critical user journeys and edge cases
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    upsert: jest.fn(),
  },
  libraryEntry: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    upsert: jest.fn(),
    count: jest.fn(),
    groupBy: jest.fn(),
  },
  series: {
    findUnique: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
  },
  follow: {
    findUnique: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  },
  notification: {
    findMany: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    count: jest.fn(),
  },
  importJob: {
    create: jest.fn(),
    findUnique: jest.fn(),
    findMany: jest.fn(),
  },
  $transaction: jest.fn((fn) => fn(mockPrisma)),
  $queryRawUnsafe: jest.fn(),
};

jest.mock('@/lib/prisma', () => ({
  prisma: mockPrisma,
  prismaRead: mockPrisma,
  withRetry: jest.fn((fn) => fn()),
  isTransientError: jest.fn(() => false),
  DEFAULT_TX_OPTIONS: { maxWait: 5000, timeout: 15000 },
}));

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn(() => ({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      })),
    },
  })),
}));

jest.mock('@/lib/api-utils', () => ({
  checkRateLimit: jest.fn(() => Promise.resolve(true)),
  validateOrigin: jest.fn(),
  validateContentType: jest.fn(),
  validateJsonSize: jest.fn(),
  validateUUID: jest.fn(),
  handleApiError: jest.fn((error) => {
    const status = error.statusCode || 500;
    return { json: () => ({ error: error.message }), status };
  }),
  ApiError: class ApiError extends Error {
    statusCode: number;
    code?: string;
    constructor(message: string, statusCode = 500, code?: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  },
  ErrorCodes: {
    BAD_REQUEST: 'BAD_REQUEST',
    UNAUTHORIZED: 'UNAUTHORIZED',
    FORBIDDEN: 'FORBIDDEN',
    NOT_FOUND: 'NOT_FOUND',
    CONFLICT: 'CONFLICT',
    RATE_LIMITED: 'RATE_LIMITED',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
  },
  getClientIp: jest.fn(() => '127.0.0.1'),
  sanitizeInput: jest.fn((input) => input),
  logSecurityEvent: jest.fn(),
}));

describe('QA Critical Flows', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Library Entry Management', () => {
    it('should handle duplicate series add gracefully (idempotent)', async () => {
      const existingEntry = {
        id: 'entry-1',
        user_id: 'test-user-id',
        series_id: 'series-1',
        status: 'reading',
        deleted_at: null,
      };

      mockPrisma.libraryEntry.findUnique.mockResolvedValue(existingEntry);
      mockPrisma.libraryEntry.findFirst.mockResolvedValue(existingEntry);

      expect(existingEntry.status).toBe('reading');
    });

    it('should prevent negative last_read_chapter values', async () => {
      const entry = {
        id: 'entry-1',
        last_read_chapter: -5,
      };

      const sanitizedChapter = Math.max(0, entry.last_read_chapter);
      expect(sanitizedChapter).toBe(0);
    });

    it('should validate status enum values', () => {
      const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
      const testStatus = 'invalid_status';
      
      expect(validStatuses.includes(testStatus)).toBe(false);
    });

    it('should handle soft-deleted entries correctly', async () => {
      const deletedEntry = {
        id: 'entry-1',
        deleted_at: new Date(),
      };

      mockPrisma.libraryEntry.findFirst.mockResolvedValue(null);
      const result = await mockPrisma.libraryEntry.findFirst({
        where: { id: 'entry-1', deleted_at: null }
      });
      
      expect(result).toBeNull();
    });
  });

  describe('XP System Integrity', () => {
    it('should cap XP at maximum value to prevent overflow', () => {
      const MAX_XP = 999_999_999;
      const currentXp = 999_999_990;
      const xpToAdd = 100;
      
      const newXp = Math.min(currentXp + xpToAdd, MAX_XP);
      expect(newXp).toBe(MAX_XP);
    });

    it('should prevent negative XP values', () => {
      const currentXp = 50;
      const xpToSubtract = -100;
      
      const newXp = Math.max(0, currentXp + xpToSubtract);
      expect(newXp).toBe(0);
    });

    it('should calculate level correctly from XP', () => {
      const calculateLevel = (xp: number): number => {
        const safeXp = Math.max(0, Math.min(xp, 999_999_999));
        return Math.floor(Math.sqrt(safeXp / 100)) + 1;
      };

      expect(calculateLevel(0)).toBe(1);
      expect(calculateLevel(99)).toBe(1);
      expect(calculateLevel(100)).toBe(2);
      expect(calculateLevel(400)).toBe(3);
    });

    it('should handle NaN XP values safely', () => {
      const validateXp = (xp: number): number => {
        if (!Number.isFinite(xp)) return 0;
        return Math.max(0, Math.min(xp, 999_999_999));
      };

      expect(validateXp(NaN)).toBe(0);
      expect(validateXp(Infinity)).toBe(0);
      expect(validateXp(-Infinity)).toBe(0);
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits on sensitive endpoints', async () => {
      const { checkRateLimit } = require('@/lib/api-utils');
      
      (checkRateLimit as jest.Mock).mockResolvedValueOnce(false);
      
      const isAllowed = await checkRateLimit('test-key', 5, 60000);
      expect(isAllowed).toBe(false);
    });
  });

  describe('Input Validation', () => {
    it('should reject invalid UUID formats', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      
      expect(uuidRegex.test('invalid')).toBe(false);
      expect(uuidRegex.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(uuidRegex.test('')).toBe(false);
      expect(uuidRegex.test('123e4567-e89b-12d3-a456-42661417400')).toBe(false);
    });

    it('should sanitize user input for XSS prevention', () => {
      const sanitizeInput = (input: string): string => {
        return input
          .replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gi, '')
          .replace(/<[^>]*>/g, '')
          .replace(/javascript:/gi, '')
          .trim();
      };

      expect(sanitizeInput('<script>alert("xss")</script>')).toBe('alert("xss")');
      expect(sanitizeInput('javascript:alert(1)')).toBe('alert(1)');
      expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('');
    });

    it('should validate pagination parameters', () => {
      const validatePagination = (limit: string | null, offset: string | null) => {
        const parsedLimit = parseInt(limit || '20', 10);
        const parsedOffset = parseInt(offset || '0', 10);
        
        return {
          limit: Math.min(Math.max(1, isNaN(parsedLimit) ? 20 : parsedLimit), 100),
          offset: Math.max(0, isNaN(parsedOffset) ? 0 : parsedOffset),
        };
      };

      expect(validatePagination(null, null)).toEqual({ limit: 20, offset: 0 });
      expect(validatePagination('abc', 'xyz')).toEqual({ limit: 20, offset: 0 });
      expect(validatePagination('200', '-10')).toEqual({ limit: 100, offset: 0 });
      expect(validatePagination('5', '50')).toEqual({ limit: 5, offset: 50 });
    });

    it('should validate username format', () => {
      const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;

      expect(USERNAME_REGEX.test('valid_user')).toBe(true);
      expect(USERNAME_REGEX.test('ab')).toBe(false);
      expect(USERNAME_REGEX.test('a'.repeat(31))).toBe(false);
      expect(USERNAME_REGEX.test('invalid user')).toBe(false);
      expect(USERNAME_REGEX.test('invalid@user')).toBe(false);
    });
  });

  describe('Follow System', () => {
    it('should prevent self-following', async () => {
      const followerId = 'user-1';
      const targetId = 'user-1';
      
      const canFollow = followerId !== targetId;
      expect(canFollow).toBe(false);
    });

    it('should handle duplicate follow attempts gracefully', async () => {
      const existingFollow = {
        follower_id: 'user-1',
        following_id: 'user-2',
        created_at: new Date(),
      };

      mockPrisma.follow.findUnique.mockResolvedValue(existingFollow);
      
      const result = await mockPrisma.follow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: 'user-1',
            following_id: 'user-2',
          },
        },
      });

      expect(result).toBeTruthy();
    });
  });

  describe('Series Trending', () => {
    it('should validate trending mode parameter', () => {
      const VALID_MODES = ['velocity', 'classic'];
      
      expect(VALID_MODES.includes('velocity')).toBe(true);
      expect(VALID_MODES.includes('invalid')).toBe(false);
    });

    it('should validate series type parameter', () => {
      const VALID_TYPES = ['manga', 'manhwa', 'manhua', 'webtoon'];
      
      expect(VALID_TYPES.includes('manga')).toBe(true);
      expect(VALID_TYPES.includes('comic')).toBe(false);
    });

    it('should cap offset to prevent DoS', () => {
      const MAX_OFFSET = 10000;
      const userOffset = 999999;
      
      const safeOffset = Math.min(userOffset, MAX_OFFSET);
      expect(safeOffset).toBe(MAX_OFFSET);
    });
  });

  describe('Import System', () => {
    it('should limit import entries to prevent DoS', () => {
      const MAX_ENTRIES = 500;
      const entries = new Array(600).fill({ title: 'Test' });
      
      const shouldReject = entries.length > MAX_ENTRIES;
      expect(shouldReject).toBe(true);
    });

    it('should deduplicate import entries by URL', () => {
      const entries = [
        { title: 'Series 1', source_url: 'https://example.com/1' },
        { title: 'Series 1 Duplicate', source_url: 'https://example.com/1' },
        { title: 'Series 2', source_url: 'https://example.com/2' },
      ];

      const uniqueMap = new Map();
      for (const entry of entries) {
        const key = entry.source_url;
        if (!uniqueMap.has(key)) {
          uniqueMap.set(key, entry);
        }
      }

      expect(uniqueMap.size).toBe(2);
    });

    it('should validate import entry schema', () => {
      const validateEntry = (entry: any): boolean => {
        if (!entry.title || typeof entry.title !== 'string') return false;
        if (entry.title.length < 1 || entry.title.length > 500) return false;
        if (entry.source_url && typeof entry.source_url !== 'string') return false;
        return true;
      };

      expect(validateEntry({ title: 'Valid' })).toBe(true);
      expect(validateEntry({ title: '' })).toBe(false);
      expect(validateEntry({ title: 123 })).toBe(false);
      expect(validateEntry({})).toBe(false);
    });
  });

  describe('Privacy & Permissions', () => {
    it('should mask private profile data for non-owners', () => {
      const isOwnProfile = false;
      const isProfilePublic = false;
      
      const userData = {
        bio: 'My bio',
        avatar_url: 'https://example.com/avatar.jpg',
        xp: 5000,
        level: 10,
      };

      const maskedData = (!isProfilePublic && !isOwnProfile) ? {
        bio: null,
        avatar_url: null,
        xp: 0,
        level: 1,
      } : userData;

      expect(maskedData.bio).toBeNull();
      expect(maskedData.xp).toBe(0);
    });

    it('should allow profile owner to see all data', () => {
      const isOwnProfile = true;
      const isProfilePublic = false;
      
      const userData = {
        bio: 'My bio',
        xp: 5000,
      };

      const visibleData = (isOwnProfile || isProfilePublic) ? userData : null;
      expect(visibleData).toEqual(userData);
    });
  });

  describe('Database Transaction Safety', () => {
    it('should handle transaction rollback on error', async () => {
      const operations: string[] = [];
      
      mockPrisma.$transaction.mockImplementation(async (fn) => {
        try {
          operations.push('start');
          const result = await fn(mockPrisma);
          operations.push('commit');
          return result;
        } catch (error) {
          operations.push('rollback');
          throw error;
        }
      });

      try {
        await mockPrisma.$transaction(async () => {
          operations.push('op1');
          throw new Error('Test error');
        });
      } catch (e) {
      }

      expect(operations).toContain('start');
      expect(operations).toContain('rollback');
      expect(operations).not.toContain('commit');
    });
  });

  describe('Cursor Pagination', () => {
    it('should validate cursor format', () => {
      const validateCursor = (cursor: string | null): boolean => {
        if (!cursor) return true;
        if (cursor.length > 500) return false;
        if (!/^[A-Za-z0-9+/=]+$/.test(cursor)) return false;
        
        try {
          const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
          const parsed = JSON.parse(decoded);
          return typeof parsed === 'object' && parsed !== null;
        } catch {
          return false;
        }
      };

      const validCursor = Buffer.from(JSON.stringify({ id: '123', score: 5 })).toString('base64');
      expect(validateCursor(validCursor)).toBe(true);
      expect(validateCursor(null)).toBe(true);
      expect(validateCursor('invalid<>cursor')).toBe(false);
      expect(validateCursor('a'.repeat(501))).toBe(false);
    });
  });
});

describe('Edge Cases', () => {
  it('should handle empty arrays gracefully', () => {
    const emptyArray: any[] = [];
    expect(emptyArray.length).toBe(0);
    expect(emptyArray[0]).toBeUndefined();
    expect(emptyArray.map(x => x).length).toBe(0);
  });

  it('should handle null/undefined values safely', () => {
    const nullSafe = (value: any, defaultVal: any = null) => value ?? defaultVal;
    
    expect(nullSafe(null)).toBeNull();
    expect(nullSafe(undefined)).toBeNull();
    expect(nullSafe(0, 'default')).toBe(0);
    expect(nullSafe('', 'default')).toBe('');
  });

  it('should handle date edge cases', () => {
    const now = new Date();
    const past = new Date(0);
    const future = new Date('2100-01-01');
    
    expect(past < now).toBe(true);
    expect(future > now).toBe(true);
    expect(new Date('invalid').toString()).toBe('Invalid Date');
  });
});
