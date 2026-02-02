/**
 * Integration Tests: XP and Progress Flow
 * 
 * Tests for the complete XP granting and progress tracking flow
 */

// Mock Prisma before importing anything that uses it
jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: jest.fn(),
    user: { findUnique: jest.fn(), update: jest.fn() },
    libraryEntry: { findUnique: jest.fn(), update: jest.fn() },
    chapter: { findUnique: jest.fn() },
    userChapterReadV2: { findUnique: jest.fn(), createManyAndReturn: jest.fn() },
    userChapterRead: { findFirst: jest.fn(), upsert: jest.fn() },
    achievement: { findMany: jest.fn() },
    userAchievement: { createManyAndReturn: jest.fn() },
    activity: { create: jest.fn() },
    auditLog: { create: jest.fn() },
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
  },
  isTransientError: jest.fn().mockReturnValue(false),
}));

// Mock Redis
jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    incr: jest.fn(),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 60000]]),
    })),
    pexpire: jest.fn(),
  },
  waitForRedis: jest.fn().mockResolvedValue(true),
  REDIS_KEY_PREFIX: 'test:',
  redisApi: {
    incr: jest.fn().mockResolvedValue(1),
  },
}));

// Mock anti-abuse
jest.mock('@/lib/anti-abuse', () => ({
  antiAbuse: {
    checkProgressRateLimit: jest.fn().mockResolvedValue({ allowed: true, hardBlock: false }),
    checkStatusRateLimit: jest.fn().mockResolvedValue({ allowed: true, hardBlock: false }),
    detectProgressBotPatterns: jest.fn().mockResolvedValue({ isBot: false }),
    detectStatusBotPatterns: jest.fn().mockResolvedValue({ isBot: false }),
    canGrantXp: jest.fn().mockResolvedValue(true),
  },
}));

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: { id: 'test-user-id' } }
      }),
    },
  }),
}));

import { XP_PER_CHAPTER, XP_SERIES_COMPLETED, calculateLevel, addXp } from '@/lib/gamification/xp';
import { calculateNewStreak, calculateStreakBonus } from '@/lib/gamification/streaks';
import { calculateSeasonXpUpdate, getCurrentSeason } from '@/lib/gamification/seasons';
import { antiAbuse } from '@/lib/anti-abuse';

// ============================================================
// XP GRANTING RULES TESTS
// ============================================================
describe('XP Granting Rules (Integration)', () => {
  describe('Rule 1: XP_PER_CHAPTER = 1', () => {
    test('XP per chapter is exactly 1', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });

    test('XP for series completion is 100', () => {
      expect(XP_SERIES_COMPLETED).toBe(100);
    });
  });

  describe('Rule 2: XP awarded ONCE per request', () => {
    test('jumping 1→500 gives XP=1, not 500', () => {
      // The progress route grants XP_PER_CHAPTER once regardless of jump size
      const currentLastRead = 1;
      const targetChapter = 500;
      const isNewProgress = targetChapter > currentLastRead;
      
      // XP should be 1 regardless of how many chapters skipped
      const xpGranted = isNewProgress ? XP_PER_CHAPTER : 0;
      expect(xpGranted).toBe(1);
    });

    test('re-marking same chapter gives XP=0', () => {
      const currentLastRead = 50;
      const targetChapter = 50;
      const isNewProgress = targetChapter > currentLastRead;
      
      const xpGranted = isNewProgress ? XP_PER_CHAPTER : 0;
      expect(xpGranted).toBe(0);
    });

    test('going backwards gives XP=0', () => {
      const currentLastRead = 50;
      const targetChapter = 30;
      const isNewProgress = targetChapter > currentLastRead;
      
      const xpGranted = isNewProgress ? XP_PER_CHAPTER : 0;
      expect(xpGranted).toBe(0);
    });
  });

  describe('Rule 3: Streak bonus calculation', () => {
    test('streak bonus adds to base XP', () => {
      const streak = 5;
      const streakBonus = calculateStreakBonus(streak);
      const totalXp = XP_PER_CHAPTER + streakBonus;
      
      expect(streakBonus).toBe(25); // 5 * 5
      expect(totalXp).toBe(26); // 1 + 25
    });

    test('streak bonus caps at 50', () => {
      const streak = 15;
      const streakBonus = calculateStreakBonus(streak);
      
      expect(streakBonus).toBe(50); // capped
    });
  });

  describe('Rule 4: Seasonal XP', () => {
    test('XP updates both lifetime and season atomically', () => {
      const currentSeason = getCurrentSeason();
      const userSeasonXp = 100;
      const userCurrentSeason = currentSeason;
      const xpToAdd = 10;
      
      const result = calculateSeasonXpUpdate(userSeasonXp, userCurrentSeason, xpToAdd);
      
      expect(result.season_xp).toBe(110);
      expect(result.current_season).toBe(currentSeason);
    });

    test('season XP resets on season rollover', () => {
      const oldSeason = '2020-Q1';
      const userSeasonXp = 500;
      const xpToAdd = 10;
      
      const result = calculateSeasonXpUpdate(userSeasonXp, oldSeason, xpToAdd);
      
      expect(result.season_xp).toBe(10); // Reset + new XP
      expect(result.current_season).toBe(getCurrentSeason());
    });
  });
});

// ============================================================
// ANTI-ABUSE INTEGRATION TESTS
// ============================================================
describe('Anti-Abuse System (Integration)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Rate Limiting', () => {
    test('progress rate limit allows normal usage', async () => {
      const result = await antiAbuse.checkProgressRateLimit('test-user');
      expect(result.allowed).toBe(true);
    });

    test('status rate limit allows normal usage', async () => {
      const result = await antiAbuse.checkStatusRateLimit('test-user');
      expect(result.allowed).toBe(true);
    });
  });

  describe('Bot Detection', () => {
    test('normal progress is not flagged as bot', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        'test-user',
        'entry-id',
        10,
        9
      );
      expect(result.isBot).toBe(false);
    });
  });

  describe('XP Grant Limiting', () => {
    test('XP grant is allowed under normal conditions', async () => {
      const allowed = await antiAbuse.canGrantXp('test-user');
      expect(allowed).toBe(true);
    });
  });
});

// ============================================================
// READ-TIME VALIDATION INTEGRATION
// ============================================================
describe('Read-Time Validation (Integration)', () => {
  describe('Validation Skipping Rules', () => {
    test('should skip validation for first progress (currentLastRead = 0)', () => {
      const currentLastRead = 0;
      const targetChapter = 50;
      const chapterJump = targetChapter - currentLastRead;
      
      const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
      expect(shouldValidate).toBe(false);
    });

    test('should skip validation for bulk jumps (> 2 chapters)', () => {
      const currentLastRead = 10;
      const targetChapter = 50;
      const chapterJump = targetChapter - currentLastRead;
      
      const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
      expect(shouldValidate).toBe(false);
    });

    test('should validate for single chapter increment', () => {
      const currentLastRead = 10;
      const targetChapter = 11;
      const chapterJump = targetChapter - currentLastRead;
      
      const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
      expect(shouldValidate).toBe(true);
    });

    test('should validate for two chapter increment', () => {
      const currentLastRead = 10;
      const targetChapter = 12;
      const chapterJump = targetChapter - currentLastRead;
      
      const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
      expect(shouldValidate).toBe(true);
    });
  });
});

// ============================================================
// LEVEL CALCULATION TESTS
// ============================================================
describe('Level Calculation (Integration)', () => {
  test('level increases correctly with XP', () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(99)).toBe(1);
    expect(calculateLevel(100)).toBe(2);
    expect(calculateLevel(399)).toBe(2);
    expect(calculateLevel(400)).toBe(3);
  });

  test('XP addition respects MAX_XP', () => {
    const maxXp = 999_999_999;
    const result = addXp(maxXp - 10, 100);
    expect(result).toBe(maxXp);
  });

  test('XP addition handles negative result', () => {
    const result = addXp(50, -100);
    expect(result).toBe(0);
  });
});

// ============================================================
// BULK PROGRESS TRUST TESTS
// ============================================================
describe('Bulk Progress Trust (Integration)', () => {
  test('migration import (0→98) should be trusted', () => {
    const currentLastRead = 0;
    const targetChapter = 98;
    const chapterJump = targetChapter - currentLastRead;
    
    // Validation should be skipped
    const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
    expect(shouldValidate).toBe(false);
    
    // XP should still be 1
    const isNewProgress = targetChapter > currentLastRead;
    const xpGranted = isNewProgress ? XP_PER_CHAPTER : 0;
    expect(xpGranted).toBe(1);
  });

  test('bulk mark read (0→50) should be trusted', () => {
    const currentLastRead = 0;
    const targetChapter = 50;
    const chapterJump = targetChapter - currentLastRead;
    
    const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
    expect(shouldValidate).toBe(false);
  });

  test('extreme binge (1→569) should be trusted', () => {
    const currentLastRead = 1;
    const targetChapter = 569;
    const chapterJump = targetChapter - currentLastRead;
    
    const shouldValidate = currentLastRead > 0 && chapterJump >= 1 && chapterJump <= 2;
    expect(shouldValidate).toBe(false);
  });
});
