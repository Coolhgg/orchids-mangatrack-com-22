/**
 * @jest-environment node
 * 
 * Security tests for rate limiting and anti-abuse systems
 */
import { antiAbuse } from '@/lib/anti-abuse';

jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(-1),
    pexpire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
    }),
  },
  waitForRedis: jest.fn().mockResolvedValue(false),
  REDIS_KEY_PREFIX: 'test:',
}));

jest.mock('@/lib/gamification/trust-score', () => ({
  maybeRecordViolation: jest.fn().mockResolvedValue(undefined),
  ViolationType: {},
}));

describe('Rate Limit Bypass Prevention', () => {
  const testUserId = 'test-user-123';
  const testEntryId = 'test-entry-456';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Progress Rate Limiting', () => {
    test('should allow requests within rate limit', async () => {
      const result = await antiAbuse.checkProgressRateLimit(testUserId);
      expect(result.allowed).toBe(true);
      expect(result.hardBlock).toBe(false);
    });

    test('should block after exceeding burst limit', async () => {
      for (let i = 0; i < 3; i++) {
        await antiAbuse.checkProgressRateLimit(testUserId);
      }
      
      const result = await antiAbuse.checkProgressRateLimit(testUserId);
      expect(result.hardBlock).toBe(true);
    });
  });

  describe('Chapter Jump Detection', () => {
    test('should detect massive chapter jumps (>50 chapters)', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        100,
        10
      );
      
      expect(result.isBot).toBe(true);
      expect(result.reason).toBe('massive_chapter_jump');
    });

    test('should allow normal chapter progression', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        15,
        10
      );
      
      expect(result.isBot).toBe(false);
    });

    test('should allow progression at exactly threshold', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        60,
        10
      );
      
      expect(result.isBot).toBe(false);
    });

    test('should flag progression just over threshold', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        61,
        10
      );
      
      expect(result.isBot).toBe(true);
    });
  });

  describe('Status Toggle Detection', () => {
    test('should allow normal status changes', async () => {
      const result = await antiAbuse.detectStatusBotPatterns(
        testUserId,
        testEntryId,
        'reading'
      );
      
      expect(result.isBot).toBe(false);
    });
  });

  describe('XP Grant Rate Limiting', () => {
    test('should allow XP grants within limit', async () => {
      const result = await antiAbuse.canGrantXp(testUserId);
      expect(result).toBe(true);
    });
  });
});

describe('Input Sanitization Security', () => {
  const { sanitizeInput, escapeILikePattern } = require('@/lib/api-utils');

  test('should remove script tags', () => {
    const input = '<script>alert("xss")</script>Hello';
    const result = sanitizeInput(input);
    expect(result).not.toContain('<script');
    expect(result).toContain('Hello');
  });

  test('should remove event handlers', () => {
    const input = '<img onerror="alert(1)" src="x">';
    const result = sanitizeInput(input);
    expect(result).not.toContain('onerror');
  });

  test('should escape ILIKE special characters', () => {
    const input = '50% off_sale\\special';
    const result = escapeILikePattern(input);
    expect(result).toBe('50\\% off\\_sale\\\\special');
  });

  test('should handle null bytes', () => {
    const input = 'Hello\x00World';
    const result = sanitizeInput(input);
    expect(result).not.toContain('\x00');
  });
});

describe('Memory Store Bounds', () => {
  test('InMemoryAbuseStore should have MAX_COUNTERS limit', () => {
    const fs = require('fs');
    const path = require('path');
    const antiAbuseCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/anti-abuse.ts'),
      'utf-8'
    );
    
    expect(antiAbuseCode).toContain('MAX_COUNTERS');
    expect(antiAbuseCode).toContain('10000');
  });

  test('InMemoryAbuseStore should have eviction methods', () => {
    const fs = require('fs');
    const path = require('path');
    const antiAbuseCode = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/anti-abuse.ts'),
      'utf-8'
    );
    
    expect(antiAbuseCode).toContain('evictExpiredCounters');
    expect(antiAbuseCode).toContain('evictOldestCounters');
  });
});
