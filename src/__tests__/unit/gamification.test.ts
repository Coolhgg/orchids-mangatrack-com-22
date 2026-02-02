/**
 * Unit Tests: Gamification System
 * 
 * Tests for XP, Levels, Streaks, Seasons, and Trust Score
 */

import { 
  XP_PER_CHAPTER, 
  XP_SERIES_COMPLETED, 
  calculateLevel, 
  xpForLevel, 
  calculateLevelProgress,
  addXp,
  MAX_XP
} from '@/lib/gamification/xp';

import {
  calculateNewStreak,
  calculateStreakBonus
} from '@/lib/gamification/streaks';

import {
  getCurrentSeason,
  parseSeason,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  getSeasonFromMonth,
  getSeasonDateRange,
  isValidSeason,
  isValidQuarterlySeason,
} from '@/lib/gamification/seasons';

import {
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  TRUST_SCORE_DEFAULT,
  applyPenalty,
  applyDecay,
  calculateEffectiveXp,
  VIOLATION_PENALTIES,
  DECAY_PER_DAY,
} from '@/lib/gamification/trust-score';

import {
  calculateMinimumReadTime,
  MIN_READ_TIME_SECONDS,
  SECONDS_PER_PAGE,
  DEFAULT_PAGE_COUNT,
} from '@/lib/gamification/read-time-validation';

// ============================================================
// XP SYSTEM TESTS
// ============================================================
describe('XP System', () => {
  describe('XP Constants', () => {
    test('XP_PER_CHAPTER should be exactly 1', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });

    test('XP_SERIES_COMPLETED should be 100', () => {
      expect(XP_SERIES_COMPLETED).toBe(100);
    });

    test('MAX_XP should prevent overflow', () => {
      expect(MAX_XP).toBe(999_999_999);
    });
  });

  describe('calculateLevel', () => {
    test('Level 1 at 0 XP', () => {
      expect(calculateLevel(0)).toBe(1);
    });

    test('Level 1 at 99 XP', () => {
      expect(calculateLevel(99)).toBe(1);
    });

    test('Level 2 at 100 XP', () => {
      expect(calculateLevel(100)).toBe(2);
    });

    test('Level 3 at 400 XP', () => {
      expect(calculateLevel(400)).toBe(3);
    });

    test('handles negative XP gracefully', () => {
      expect(calculateLevel(-100)).toBe(1);
    });

    test('handles MAX_XP', () => {
      const level = calculateLevel(MAX_XP);
      expect(level).toBeGreaterThan(1);
      expect(Number.isFinite(level)).toBe(true);
    });
  });

  describe('xpForLevel', () => {
    test('Level 1 requires 0 XP', () => {
      expect(xpForLevel(1)).toBe(0);
    });

    test('Level 2 requires 100 XP', () => {
      expect(xpForLevel(2)).toBe(100);
    });

    test('handles level 0 or negative', () => {
      expect(xpForLevel(0)).toBe(0);
      expect(xpForLevel(-1)).toBe(0);
    });
  });

  describe('calculateLevelProgress', () => {
    test('0% progress at level start', () => {
      expect(calculateLevelProgress(0)).toBe(0);
      expect(calculateLevelProgress(100)).toBe(0);
    });

    test('50% progress mid-level', () => {
      // Level 2: 100-399 XP (300 XP range)
      // 250 XP is 150 XP into level 2 (50%)
      expect(calculateLevelProgress(250)).toBeCloseTo(0.5, 1);
    });

    test('handles negative XP', () => {
      expect(calculateLevelProgress(-100)).toBe(0);
    });
  });

  describe('addXp', () => {
    test('adds XP correctly', () => {
      expect(addXp(100, 50)).toBe(150);
    });

    test('caps at MAX_XP', () => {
      expect(addXp(MAX_XP - 10, 100)).toBe(MAX_XP);
    });

    test('handles negative result', () => {
      expect(addXp(10, -100)).toBe(0);
    });
  });
});

// ============================================================
// STREAK SYSTEM TESTS
// ============================================================
describe('Streak System', () => {
  describe('calculateNewStreak', () => {
    test('returns 1 for first read (no previous date)', () => {
      expect(calculateNewStreak(0, null)).toBe(1);
    });

    test('maintains streak if read today', () => {
      const today = new Date();
      expect(calculateNewStreak(5, today)).toBe(5);
    });

    test('increments streak if read yesterday', () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(calculateNewStreak(5, yesterday)).toBe(6);
    });

    test('resets streak if gap > 1 day', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
      expect(calculateNewStreak(5, twoDaysAgo)).toBe(1);
    });

    test('handles invalid date', () => {
      expect(calculateNewStreak(5, new Date('invalid'))).toBe(1);
    });
  });

  describe('calculateStreakBonus', () => {
    test('5 XP per day of streak', () => {
      expect(calculateStreakBonus(1)).toBe(5);
      expect(calculateStreakBonus(2)).toBe(10);
      expect(calculateStreakBonus(5)).toBe(25);
    });

    test('caps at 50 XP', () => {
      expect(calculateStreakBonus(10)).toBe(50);
      expect(calculateStreakBonus(100)).toBe(50);
    });

    test('handles negative streak', () => {
      expect(calculateStreakBonus(-5)).toBe(0);
    });
  });
});

// ============================================================
// SEASON SYSTEM TESTS
// ============================================================
describe('Season System', () => {
  describe('getCurrentSeason', () => {
    test('returns valid quarterly format', () => {
      const season = getCurrentSeason();
      expect(season).toMatch(/^\d{4}-Q[1-4]$/);
    });
  });

  describe('getSeasonFromMonth', () => {
    test('Winter: Jan-Mar (Q1)', () => {
      expect(getSeasonFromMonth(1).quarter).toBe(1);
      expect(getSeasonFromMonth(2).quarter).toBe(1);
      expect(getSeasonFromMonth(3).quarter).toBe(1);
    });

    test('Spring: Apr-Jun (Q2)', () => {
      expect(getSeasonFromMonth(4).quarter).toBe(2);
      expect(getSeasonFromMonth(5).quarter).toBe(2);
      expect(getSeasonFromMonth(6).quarter).toBe(2);
    });

    test('Summer: Jul-Sep (Q3)', () => {
      expect(getSeasonFromMonth(7).quarter).toBe(3);
      expect(getSeasonFromMonth(8).quarter).toBe(3);
      expect(getSeasonFromMonth(9).quarter).toBe(3);
    });

    test('Fall: Oct-Dec (Q4)', () => {
      expect(getSeasonFromMonth(10).quarter).toBe(4);
      expect(getSeasonFromMonth(11).quarter).toBe(4);
      expect(getSeasonFromMonth(12).quarter).toBe(4);
    });
  });

  describe('parseSeason', () => {
    test('parses quarterly format', () => {
      const result = parseSeason('2026-Q1');
      expect(result).toEqual({
        year: 2026,
        quarter: 1,
        key: 'winter',
      });
    });

    test('parses legacy monthly format', () => {
      const result = parseSeason('2026-01');
      expect(result?.quarter).toBe(1);
    });

    test('returns null for invalid format', () => {
      expect(parseSeason('invalid')).toBeNull();
      expect(parseSeason('2026')).toBeNull();
    });
  });

  describe('needsSeasonRollover', () => {
    test('returns true for null season', () => {
      expect(needsSeasonRollover(null)).toBe(true);
    });

    test('returns false for current season', () => {
      expect(needsSeasonRollover(getCurrentSeason())).toBe(false);
    });

    test('returns true for different season', () => {
      expect(needsSeasonRollover('2020-Q1')).toBe(true);
    });
  });

  describe('calculateSeasonXpUpdate', () => {
    test('resets XP on season rollover', () => {
      const result = calculateSeasonXpUpdate(500, '2020-Q1', 10);
      expect(result.season_xp).toBe(10);
      expect(result.current_season).toBe(getCurrentSeason());
    });

    test('increments XP in same season', () => {
      const currentSeason = getCurrentSeason();
      const result = calculateSeasonXpUpdate(500, currentSeason, 10);
      expect(result.season_xp).toBe(510);
      expect(result.current_season).toBe(currentSeason);
    });

    test('handles null initial values', () => {
      const result = calculateSeasonXpUpdate(null, null, 10);
      expect(result.season_xp).toBe(10);
    });
  });

  describe('isValidSeason', () => {
    test('accepts quarterly format', () => {
      expect(isValidSeason('2026-Q1')).toBe(true);
      expect(isValidSeason('2026-Q4')).toBe(true);
    });

    test('accepts legacy format', () => {
      expect(isValidSeason('2026-01')).toBe(true);
      expect(isValidSeason('2026-12')).toBe(true);
    });

    test('rejects invalid formats', () => {
      expect(isValidSeason('2026-Q5')).toBe(false);
      expect(isValidSeason('2026-13')).toBe(false);
      expect(isValidSeason('invalid')).toBe(false);
    });
  });

  describe('getSeasonDateRange', () => {
    test('returns correct date range for Q1', () => {
      const range = getSeasonDateRange('2026-Q1');
      expect(range?.start.getUTCMonth()).toBe(0); // January
      expect(range?.end.getUTCMonth()).toBe(2);   // March
    });

    test('returns null for invalid season', () => {
      expect(getSeasonDateRange('invalid')).toBeNull();
    });
  });
});

// ============================================================
// TRUST SCORE TESTS
// ============================================================
describe('Trust Score System', () => {
  describe('Constants', () => {
    test('trust score bounds', () => {
      expect(TRUST_SCORE_MIN).toBe(0.5);
      expect(TRUST_SCORE_MAX).toBe(1.0);
      expect(TRUST_SCORE_DEFAULT).toBe(1.0);
    });

    test('decay rate is 0.02 per day', () => {
      expect(DECAY_PER_DAY).toBe(0.02);
    });

    test('large_jump is NOT a violation', () => {
      expect(VIOLATION_PENALTIES['large_jump']).toBeUndefined();
    });

    test('expected violations exist', () => {
      expect(VIOLATION_PENALTIES['rapid_reads']).toBeDefined();
      expect(VIOLATION_PENALTIES['api_spam']).toBeDefined();
      expect(VIOLATION_PENALTIES['status_toggle']).toBeDefined();
      expect(VIOLATION_PENALTIES['repeated_same_chapter']).toBeDefined();
    });
  });

  describe('applyPenalty', () => {
    test('reduces trust score', () => {
      expect(applyPenalty(1.0, 0.05)).toBe(0.95);
    });

    test('clamps to minimum', () => {
      expect(applyPenalty(0.5, 0.1)).toBe(0.5);
      expect(applyPenalty(0.55, 0.1)).toBe(0.5);
    });
  });

  describe('applyDecay (Recovery)', () => {
    test('increases trust score by 0.02 per day', () => {
      // applyDecay adds 0.02 per day (upward recovery)
      const result = applyDecay(0.9, 1);
      expect(result).toBeCloseTo(0.92, 2);
    });

    test('clamps to maximum', () => {
      expect(applyDecay(0.99, 5)).toBe(1.0);
    });

    test('supports multi-day recovery', () => {
      // 5 days of recovery = 0.10 increase
      const result = applyDecay(0.8, 5);
      expect(result).toBeCloseTo(0.9, 2);
    });
  });

  describe('calculateEffectiveXp', () => {
    test('applies trust score multiplier', () => {
      expect(calculateEffectiveXp(1000, 1.0)).toBe(1000);
      expect(calculateEffectiveXp(1000, 0.9)).toBe(900);
      expect(calculateEffectiveXp(1000, 0.5)).toBe(500);
    });

    test('clamps trust score to bounds', () => {
      expect(calculateEffectiveXp(1000, 2.0)).toBe(1000); // Clamped to 1.0
      expect(calculateEffectiveXp(1000, 0.1)).toBe(500);  // Clamped to 0.5
    });
  });
});

// ============================================================
// READ-TIME VALIDATION TESTS
// ============================================================
describe('Read-Time Validation', () => {
  describe('calculateMinimumReadTime', () => {
    test('uses minimum threshold', () => {
      expect(calculateMinimumReadTime(1)).toBe(MIN_READ_TIME_SECONDS);
    });

    test('uses page-based calculation when higher', () => {
      const pages = 20;
      const expected = pages * SECONDS_PER_PAGE;
      expect(calculateMinimumReadTime(pages)).toBe(expected);
    });

    test('uses default page count when null', () => {
      const expected = Math.max(
        MIN_READ_TIME_SECONDS,
        DEFAULT_PAGE_COUNT * SECONDS_PER_PAGE
      );
      expect(calculateMinimumReadTime(null)).toBe(expected);
    });
  });
});
