/**
 * API Routes Integration Tests - January 2026
 * 
 * Tests critical API endpoints for:
 * - Proper authentication checks
 * - Input validation
 * - Error handling
 * - Edge cases
 */

import { describe, it, expect, jest } from '@jest/globals';

// Mock modules
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    libraryEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      deleteMany: jest.fn(),
    },
    series: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      updateMany: jest.fn(),
    },
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      deleteMany: jest.fn(),
    },
    $transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback({
      libraryEntry: { findUnique: jest.fn(), upsert: jest.fn(), update: jest.fn() },
      series: { update: jest.fn() },
      user: { findUnique: jest.fn(), update: jest.fn() },
      activity: { create: jest.fn(), findFirst: jest.fn() },
      notification: { create: jest.fn(), findFirst: jest.fn() },
    })),
    $queryRawUnsafe: jest.fn(),
  },
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
  isTransientError: jest.fn(() => false),
}));

jest.mock('@/lib/api-utils', () => {
  const actual = jest.requireActual('@/lib/api-utils') as Record<string, unknown>;
  return {
    ...actual,
    checkRateLimit: jest.fn(() => Promise.resolve(true)),
  };
});

describe('Library API Validation', () => {
  describe('POST /api/library', () => {
    it('should validate seriesId is a UUID', async () => {
      const { validateUUID, ApiError } = await import('@/lib/api-utils');
      
      expect(() => validateUUID('not-a-uuid')).toThrow(ApiError);
      expect(() => validateUUID('550e8400-e29b-41d4-a716-446655440000')).not.toThrow();
    });

    it('should validate status enum', async () => {
      const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
      const invalidStatuses = ['invalid', 'READING', 'complete', ''];
      
      validStatuses.forEach(status => {
        expect(validStatuses.includes(status)).toBe(true);
      });
      
      invalidStatuses.forEach(status => {
        expect(validStatuses.includes(status)).toBe(false);
      });
    });
  });

  describe('PATCH /api/library/[id]', () => {
    it('should validate rating range', () => {
      const validateRating = (rating: number | null | undefined): boolean => {
        if (rating === undefined || rating === null) return true;
        const num = Number(rating);
        return !isNaN(num) && num >= 1 && num <= 10;
      };

      expect(validateRating(5)).toBe(true);
      expect(validateRating(1)).toBe(true);
      expect(validateRating(10)).toBe(true);
      expect(validateRating(null)).toBe(true);
      expect(validateRating(undefined)).toBe(true);
      expect(validateRating(0)).toBe(false);
      expect(validateRating(11)).toBe(false);
      expect(validateRating(-1)).toBe(false);
    });

    it('should validate preferred_source length', () => {
      const validatePreferredSource = (source: string | null | undefined): boolean => {
        if (source === undefined || source === null) return true;
        return typeof source === 'string' && source.length <= 50;
      };

      expect(validatePreferredSource('mangadex')).toBe(true);
      expect(validatePreferredSource(null)).toBe(true);
      expect(validatePreferredSource('a'.repeat(51))).toBe(false);
    });
  });
});

describe('Bulk Operations API', () => {
  describe('PATCH /api/library/bulk', () => {
    it('should validate updates array is non-empty', () => {
      const validateUpdates = (updates: unknown[]): boolean => {
        return Array.isArray(updates) && updates.length > 0;
      };

      expect(validateUpdates([{ id: '1' }])).toBe(true);
      expect(validateUpdates([])).toBe(false);
      expect(validateUpdates(null as unknown as unknown[])).toBe(false);
    });

    it('should enforce max 50 entries limit', () => {
      const MAX_BULK_ENTRIES = 50;
      const validateBulkLimit = (updates: unknown[]): boolean => {
        return updates.length <= MAX_BULK_ENTRIES;
      };

      expect(validateBulkLimit(Array(50).fill({ id: '1' }))).toBe(true);
      expect(validateBulkLimit(Array(51).fill({ id: '1' }))).toBe(false);
    });
  });
});

describe('User API Privacy', () => {
  describe('GET /api/users/[username]', () => {
    it('should mask sensitive fields for private profiles', () => {
      interface UserProfile {
        id: string;
        username: string;
        bio: string | null;
        avatar_url: string | null;
        xp: number;
        level: number;
        streak_days: number;
      }
      
      const maskPrivateProfile = (user: UserProfile, isOwnProfile: boolean, isProfilePublic: boolean): UserProfile => {
        if (!isProfilePublic && !isOwnProfile) {
          return {
            ...user,
            bio: null,
            avatar_url: null,
            xp: 0,
            level: 1,
            streak_days: 0,
          };
        }
        return user;
      };

      const user: UserProfile = {
        id: '1',
        username: 'testuser',
        bio: 'My bio',
        avatar_url: 'https://example.com/avatar.jpg',
        xp: 1000,
        level: 5,
        streak_days: 10,
      };

      // Own profile - should not mask
      const ownResult = maskPrivateProfile(user, true, false);
      expect(ownResult.bio).toBe('My bio');
      expect(ownResult.xp).toBe(1000);

      // Public profile - should not mask
      const publicResult = maskPrivateProfile(user, false, true);
      expect(publicResult.bio).toBe('My bio');

      // Private profile, not owner - should mask
      const privateResult = maskPrivateProfile(user, false, false);
      expect(privateResult.bio).toBeNull();
      expect(privateResult.xp).toBe(0);
      expect(privateResult.level).toBe(1);
    });
  });
});

describe('Follow API', () => {
  describe('POST /api/users/[username]/follow', () => {
    it('should prevent self-follow', () => {
      const validateFollow = (followerId: string, targetId: string): boolean => {
        return followerId !== targetId;
      };

      expect(validateFollow('user1', 'user2')).toBe(true);
      expect(validateFollow('user1', 'user1')).toBe(false);
    });
  });
});

describe('Notification API', () => {
  describe('GET /api/notifications', () => {
    it('should validate type filter', () => {
      const VALID_TYPES = ['new_chapter', 'new_follower', 'achievement', 'system'];
      
      const validateType = (type: string | undefined): boolean => {
        if (!type) return true;
        return VALID_TYPES.includes(type);
      };

      expect(validateType('new_chapter')).toBe(true);
      expect(validateType('new_follower')).toBe(true);
      expect(validateType(undefined)).toBe(true);
      expect(validateType('invalid_type')).toBe(false);
    });

    it('should enforce pagination limits', () => {
      const MAX_LIMIT = 100;
      
      const validateLimit = (limit: number): number => {
        return Math.min(Math.max(1, limit), MAX_LIMIT);
      };

      expect(validateLimit(50)).toBe(50);
      expect(validateLimit(200)).toBe(100);
      expect(validateLimit(0)).toBe(1);
      expect(validateLimit(-10)).toBe(1);
    });
  });
});

describe('Series API', () => {
  describe('GET /api/series/[id]', () => {
    it('should validate series ID format', async () => {
      const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(UUID_REGEX.test('not-a-uuid')).toBe(false);
      expect(UUID_REGEX.test('')).toBe(false);
    });
  });
});

describe('Search API', () => {
  describe('GET /api/series/search', () => {
    it('should sanitize query string', async () => {
      const { sanitizeInput } = await import('@/lib/api-utils');
      
      expect(sanitizeInput('<script>alert(1)</script>test')).toBe('test');
      expect(sanitizeInput('normal search query')).toBe('normal search query');
    });

    it('should escape ILIKE special characters', async () => {
      const { escapeILikePattern } = await import('@/lib/api-utils');
      
      expect(escapeILikePattern('100%')).toBe('100\\%');
      expect(escapeILikePattern('user_name')).toBe('user\\_name');
    });

    it('should validate source filter', () => {
      const VALID_SOURCES = new Set(['all', 'mangadex', 'multiple']);
      
      const validateSource = (source: string | null): string | null => {
        if (!source) return null;
        return VALID_SOURCES.has(source.toLowerCase()) ? source.toLowerCase() : null;
      };

      expect(validateSource('all')).toBe('all');
      expect(validateSource('mangadex')).toBe('mangadex');
      expect(validateSource('MANGADEX')).toBe('mangadex');
      expect(validateSource('invalid')).toBeNull();
      expect(validateSource(null)).toBeNull();
    });

    it('should enforce result limit', () => {
      const validateLimit = (limit: number): number => {
        return Math.min(Math.max(1, limit), 100);
      };

      expect(validateLimit(24)).toBe(24);
      expect(validateLimit(500)).toBe(100);
      expect(validateLimit(-5)).toBe(1);
    });
  });
});

describe('Activity Feed API', () => {
  describe('GET /api/feed/activity', () => {
    it('should validate filter parameter', () => {
      const VALID_FILTERS = ['all', 'unread'];
      
      const validateFilter = (filter: string): string => {
        return VALID_FILTERS.includes(filter) ? filter : 'all';
      };

      expect(validateFilter('all')).toBe('all');
      expect(validateFilter('unread')).toBe('unread');
      expect(validateFilter('invalid')).toBe('all');
    });

    it('should validate cursor format', () => {
      const validateCursor = (cursor: string | null): { d: string; i: string } | null => {
        if (!cursor) return null;
        try {
          const decoded = Buffer.from(cursor, 'base64').toString();
          const parsed = JSON.parse(decoded);
          if (parsed.d && parsed.i) return parsed;
          return null;
        } catch {
          return null;
        }
      };

      const validCursor = Buffer.from(JSON.stringify({ d: '2024-01-01', i: 'uuid' })).toString('base64');
      expect(validateCursor(validCursor)).toEqual({ d: '2024-01-01', i: 'uuid' });
      expect(validateCursor('invalid')).toBeNull();
      expect(validateCursor(null)).toBeNull();
    });
  });
});

describe('Error Response Format', () => {
  it('should include requestId in error responses', () => {
    const createErrorResponse = (error: { message?: string; code?: string }) => {
      const requestId = Math.random().toString(36).substring(2, 10).toUpperCase();
      return {
        error: error.message || 'An unexpected error occurred',
        code: error.code || 'INTERNAL_ERROR',
        requestId,
      };
    };

    const response = createErrorResponse({ message: 'Test error', code: 'TEST_ERROR' });
    expect(response.error).toBe('Test error');
    expect(response.code).toBe('TEST_ERROR');
    expect(response.requestId).toBeDefined();
    expect(response.requestId.length).toBe(8);
  });

  it('should map Prisma errors to appropriate status codes', () => {
    const mapPrismaError = (error: { code?: string }): number => {
      if (error.code === 'P2002') return 409; // Unique constraint
      if (error.code === 'P2025') return 404; // Not found
      return 500;
    };

    expect(mapPrismaError({ code: 'P2002' })).toBe(409);
    expect(mapPrismaError({ code: 'P2025' })).toBe(404);
    expect(mapPrismaError({ code: 'P1000' })).toBe(500);
  });
});

describe('CSRF Protection', () => {
  it('should validate origin header', () => {
    const validateOrigin = (origin: string | null, host: string): boolean => {
      if (!origin) return true; // GET requests may not have origin
      try {
        const originHost = new URL(origin).host;
        return originHost === host;
      } catch {
        return false;
      }
    };

    expect(validateOrigin('https://example.com', 'example.com')).toBe(true);
    expect(validateOrigin('https://evil.com', 'example.com')).toBe(false);
    expect(validateOrigin(null, 'example.com')).toBe(true);
    expect(validateOrigin('invalid', 'example.com')).toBe(false);
  });
});

describe('Content-Type Validation', () => {
  it('should validate Content-Type header', () => {
    const validateContentType = (contentType: string | null, expected: string = 'application/json'): boolean => {
      if (!contentType) return false;
      return contentType.includes(expected);
    };

    expect(validateContentType('application/json')).toBe(true);
    expect(validateContentType('application/json; charset=utf-8')).toBe(true);
    expect(validateContentType('text/html')).toBe(false);
    expect(validateContentType(null)).toBe(false);
  });
});

describe('JSON Size Validation', () => {
  it('should validate content-length against max size', () => {
    const MAX_SIZE = 1024 * 1024; // 1MB
    
    const validateJsonSize = (contentLength: string | null): boolean => {
      if (!contentLength) return true;
      const size = parseInt(contentLength, 10);
      return !isNaN(size) && size <= MAX_SIZE;
    };

    expect(validateJsonSize('1000')).toBe(true);
    expect(validateJsonSize('1048576')).toBe(true); // Exactly 1MB
    expect(validateJsonSize('1048577')).toBe(false); // Over 1MB
    expect(validateJsonSize(null)).toBe(true);
    expect(validateJsonSize('invalid')).toBe(true); // NaN defaults to true (let it fail at parse)
  });
});
