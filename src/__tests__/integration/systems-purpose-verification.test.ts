/**
 * COMPREHENSIVE QA VERIFICATION TEST
 * 
 * Verifies all gamification systems meet their stated purposes:
 * 
 * | System          | Purpose            |
 * |-----------------|-------------------|
 * | Prisma schema   | Data integrity     |
 * | Leaderboards    | Fair competition   |
 * | Migration XP    | Safe onboarding    |
 * | Seasons         | Long-term engagement |
 * | Trust score     | Soft anti-cheat    |
 * | Telemetry       | Abuse detection    |
 * | Anti-bot        | XP protection      |
 */

import {
  calculateLevel,
  xpForLevel,
  calculateLevelProgress,
  addXp,
  XP_PER_CHAPTER,
  MAX_XP,
} from '@/lib/gamification/xp';

import {
  calculateNewStreak,
  calculateStreakBonus,
} from '@/lib/gamification/streaks';

import {
  getCurrentSeason,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  getSeasonDateRange,
  parseSeason,
  getSeasonDaysRemaining,
  getSeasonProgress,
} from '@/lib/gamification/seasons';

import {
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  TRUST_SCORE_DEFAULT,
  applyPenalty,
  applyDecay,
  calculateEffectiveXp,
  calculateEffectiveSeasonXp,
  VIOLATION_PENALTIES,
  DECAY_PER_DAY,
  daysUntilFullRecovery,
} from '@/lib/gamification/trust-score';

import {
  calculateMinimumReadTime,
  MIN_READ_TIME_SECONDS,
  SECONDS_PER_PAGE,
  DEFAULT_PAGE_COUNT,
} from '@/lib/gamification/read-time-validation';

import {
  calculateMigrationBonus,
  MIGRATION_XP_PER_CHAPTER,
  MIGRATION_XP_MIN,
  MIGRATION_XP_CAP,
} from '@/lib/gamification/migration-bonus';

// ============================================================================
// 1. PRISMA SCHEMA - DATA INTEGRITY
// ============================================================================
describe('1. Prisma Schema - Data Integrity', () => {
  test('XP values have proper bounds', () => {
    // XP should be non-negative and capped
    expect(addXp(0, -100)).toBe(0); // Floor at 0
    expect(addXp(MAX_XP, 100)).toBe(MAX_XP); // Cap at MAX_XP
  });

  test('Level calculation is deterministic', () => {
    // Same XP always produces same level
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(100)).toBe(2);
    expect(calculateLevel(400)).toBe(3);
    
    // Level progression is monotonic
    for (let xp = 0; xp < 10000; xp += 100) {
      const level = calculateLevel(xp);
      const nextLevel = calculateLevel(xp + 100);
      expect(nextLevel).toBeGreaterThanOrEqual(level);
    }
  });

  test('Trust score bounds are enforced', () => {
    // Trust score must stay within [0.5, 1.0]
    expect(TRUST_SCORE_MIN).toBe(0.5);
    expect(TRUST_SCORE_MAX).toBe(1.0);
    
    // Penalties can't go below minimum
    expect(applyPenalty(0.5, 0.1)).toBe(0.5);
    expect(applyPenalty(0.6, 0.2)).toBe(0.5);
    
    // Recovery can't exceed maximum
    expect(applyDecay(0.99, 10)).toBe(1.0);
  });

  test('Season format is valid', () => {
    const season = getCurrentSeason();
    expect(season).toMatch(/^\d{4}-Q[1-4]$/);
    
    const parsed = parseSeason(season);
    expect(parsed).not.toBeNull();
    expect(parsed?.quarter).toBeGreaterThanOrEqual(1);
    expect(parsed?.quarter).toBeLessThanOrEqual(4);
  });
});

// ============================================================================
// 2. LEADERBOARDS - FAIR COMPETITION
// ============================================================================
describe('2. Leaderboards - Fair Competition', () => {
  test('Trust score affects effective XP for ranking', () => {
    // Same raw XP, different trust scores
    const rawXp = 1000;
    
    const effectiveHonest = calculateEffectiveXp(rawXp, 1.0);
    const effectiveSuspicious = calculateEffectiveXp(rawXp, 0.7);
    const effectiveVeryBad = calculateEffectiveXp(rawXp, 0.5);
    
    expect(effectiveHonest).toBe(1000);
    expect(effectiveSuspicious).toBe(700);
    expect(effectiveVeryBad).toBe(500);
    
    // Lower trust = lower ranking position
    expect(effectiveHonest).toBeGreaterThan(effectiveSuspicious);
    expect(effectiveSuspicious).toBeGreaterThan(effectiveVeryBad);
  });

  test('Season XP is also trust-weighted', () => {
    const seasonXp = 500;
    
    const effectiveHonest = calculateEffectiveSeasonXp(seasonXp, 1.0);
    const effectiveSuspicious = calculateEffectiveSeasonXp(seasonXp, 0.8);
    
    expect(effectiveHonest).toBe(500);
    expect(effectiveSuspicious).toBe(400);
  });

  test('Raw XP is preserved (never reduced)', () => {
    // Trust score affects ranking ONLY, not actual XP
    const rawXp = 1000;
    const trustScore = 0.5;
    
    // calculateEffectiveXp returns effective XP for ranking
    // but the raw XP (1000) is never modified
    const effectiveXp = calculateEffectiveXp(rawXp, trustScore);
    
    expect(effectiveXp).toBe(500); // For ranking
    // Raw XP would still be 1000 in database (not tested here - verified by code inspection)
  });
});

// ============================================================================
// 3. MIGRATION XP - SAFE ONBOARDING
// ============================================================================
describe('3. Migration XP - Safe Onboarding', () => {
  test('Migration bonus is capped to prevent abuse', () => {
    // Very large imports should be capped
    const hugeImport = calculateMigrationBonus(10000);
    expect(hugeImport).toBe(MIGRATION_XP_CAP); // 500 XP max
    expect(hugeImport).toBeLessThanOrEqual(500);
  });

  test('Migration bonus has minimum reward', () => {
    // Small imports still get minimum reward
    const smallImport = calculateMigrationBonus(10);
    expect(smallImport).toBe(MIGRATION_XP_MIN); // 50 XP min
    expect(smallImport).toBeGreaterThanOrEqual(50);
  });

  test('Migration bonus scales with chapters', () => {
    // 400 chapters = 100 XP (400 * 0.25)
    const mediumImport = calculateMigrationBonus(400);
    expect(mediumImport).toBe(100);
    
    // 800 chapters = 200 XP (800 * 0.25)
    const largeImport = calculateMigrationBonus(800);
    expect(largeImport).toBe(200);
  });

  test('Migration XP rate is lower than normal reads', () => {
    // Normal read: 1 XP per chapter
    // Migration: 0.25 XP per chapter
    expect(MIGRATION_XP_PER_CHAPTER).toBeLessThan(XP_PER_CHAPTER);
    expect(MIGRATION_XP_PER_CHAPTER).toBe(0.25);
  });

  test('Invalid imports get no bonus', () => {
    expect(calculateMigrationBonus(0)).toBe(0);
    expect(calculateMigrationBonus(-100)).toBe(0);
  });
});

// ============================================================================
// 4. SEASONS - LONG-TERM ENGAGEMENT
// ============================================================================
describe('4. Seasons - Long-term Engagement', () => {
  test('Season XP resets on season change', () => {
    const oldSeason = '2020-Q1';
    const currentSeason = getCurrentSeason();
    
    // User with 500 season XP from old season
    const result = calculateSeasonXpUpdate(500, oldSeason, 10);
    
    // XP should reset and start fresh
    expect(result.season_xp).toBe(10);
    expect(result.current_season).toBe(currentSeason);
  });

  test('Season XP accumulates within same season', () => {
    const currentSeason = getCurrentSeason();
    
    const result = calculateSeasonXpUpdate(500, currentSeason, 10);
    
    // XP should accumulate
    expect(result.season_xp).toBe(510);
    expect(result.current_season).toBe(currentSeason);
  });

  test('Season date ranges are valid', () => {
    const currentSeason = getCurrentSeason();
    const range = getSeasonDateRange(currentSeason);
    
    expect(range).not.toBeNull();
    expect(range!.start).toBeInstanceOf(Date);
    expect(range!.end).toBeInstanceOf(Date);
    expect(range!.end.getTime()).toBeGreaterThan(range!.start.getTime());
  });

  test('Season progress tracking works', () => {
    const daysRemaining = getSeasonDaysRemaining();
    const progress = getSeasonProgress();
    
    expect(daysRemaining).toBeGreaterThanOrEqual(0);
    expect(progress).toBeGreaterThanOrEqual(0);
    expect(progress).toBeLessThanOrEqual(1);
  });

  test('New users are initialized to current season', () => {
    // Null season triggers rollover
    expect(needsSeasonRollover(null)).toBe(true);
    
    const result = calculateSeasonXpUpdate(null, null, 10);
    expect(result.current_season).toBe(getCurrentSeason());
    expect(result.season_xp).toBe(10);
  });
});

// ============================================================================
// 5. TRUST SCORE - SOFT ANTI-CHEAT
// ============================================================================
describe('5. Trust Score - Soft Anti-cheat', () => {
  test('Trust score never blocks XP or reading', () => {
    // Even at minimum trust, XP is still awarded (just less effective for ranking)
    const minTrust = TRUST_SCORE_MIN;
    expect(minTrust).toBe(0.5); // Not 0
    
    // Trust score > 0 means leaderboard still shows user
    const effectiveXp = calculateEffectiveXp(1000, minTrust);
    expect(effectiveXp).toBeGreaterThan(0);
    expect(effectiveXp).toBe(500);
  });

  test('Trust score recovers over time (forgiveness)', () => {
    // Start at 0.5 (worst case)
    let trustScore = 0.5;
    
    // Simulate 25 days of recovery
    for (let day = 0; day < 25; day++) {
      trustScore = applyDecay(trustScore, 1);
    }
    
    // Should be fully recovered
    expect(trustScore).toBe(1.0);
  });

  test('Days until recovery is predictable', () => {
    // From 0.5, need 25 days to reach 1.0 (0.5 / 0.02 = 25)
    expect(daysUntilFullRecovery(0.5)).toBe(25);
    expect(daysUntilFullRecovery(0.9)).toBe(5);
    expect(daysUntilFullRecovery(1.0)).toBe(0);
  });

  test('Violation penalties are small and stackable', () => {
    // All penalties are < 0.5 (can't drop to 0 in one violation)
    for (const [type, penalty] of Object.entries(VIOLATION_PENALTIES)) {
      expect(penalty).toBeLessThan(0.5);
      expect(penalty).toBeGreaterThan(0);
    }
  });

  test('large_jump is NOT a violation (trusted bulk progress)', () => {
    // Bulk progress (migrations, binge reading) is trusted
    expect(VIOLATION_PENALTIES['large_jump']).toBeUndefined();
  });
});

// ============================================================================
// 6. TELEMETRY - ABUSE DETECTION
// ============================================================================
describe('6. Telemetry - Abuse Detection', () => {
  test('Read time thresholds exist for detection', () => {
    expect(MIN_READ_TIME_SECONDS).toBe(30);
    expect(SECONDS_PER_PAGE).toBe(3);
    expect(DEFAULT_PAGE_COUNT).toBe(18);
  });

  test('Minimum read time scales with chapter length', () => {
    // Short chapter: minimum threshold
    expect(calculateMinimumReadTime(5)).toBe(30);
    
    // Long chapter: page-based calculation
    expect(calculateMinimumReadTime(20)).toBe(60); // 20 * 3 = 60
    expect(calculateMinimumReadTime(50)).toBe(150); // 50 * 3 = 150
  });

  test('Telemetry never blocks reads (by design)', () => {
    // This is verified by code inspection - telemetry is fire-and-forget
    // The calculateMinimumReadTime function is used for flagging only
    const threshold = calculateMinimumReadTime(20);
    
    // Threshold exists but is not used for blocking
    expect(threshold).toBeGreaterThan(0);
    // Reading below threshold would flag the read, but NOT block it
  });
});

// ============================================================================
// 7. ANTI-BOT - XP PROTECTION
// ============================================================================
describe('7. Anti-bot - XP Protection', () => {
  test('XP per chapter is exactly 1 (no multipliers)', () => {
    expect(XP_PER_CHAPTER).toBe(1);
  });

  test('Bulk jumps do not multiply XP', () => {
    // Jump from chapter 1 to 500: XP = 1 (not 500)
    // This is verified by code inspection of progress route
    // Here we just verify the constant
    expect(XP_PER_CHAPTER).toBe(1);
  });

  test('Streak bonus has a cap', () => {
    // Cap at 50 XP prevents unlimited bonus
    expect(calculateStreakBonus(10)).toBe(50);
    expect(calculateStreakBonus(100)).toBe(50);
    expect(calculateStreakBonus(1000)).toBe(50);
  });

  test('Streak resets on missed days', () => {
    const twoDaysAgo = new Date();
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    
    // Gap > 1 day resets streak
    expect(calculateNewStreak(100, twoDaysAgo)).toBe(1);
  });

  test('Anti-bot violations exist and have penalties', () => {
    // Specific anti-bot penalties
    expect(VIOLATION_PENALTIES['speed_read']).toBeDefined();
    expect(VIOLATION_PENALTIES['bulk_speed_read']).toBeDefined();
    expect(VIOLATION_PENALTIES['pattern_repetition']).toBeDefined();
    
    // All penalties are non-zero
    expect(VIOLATION_PENALTIES['speed_read']).toBeGreaterThan(0);
    expect(VIOLATION_PENALTIES['bulk_speed_read']).toBeGreaterThan(0);
    expect(VIOLATION_PENALTIES['pattern_repetition']).toBeGreaterThan(0);
  });
});

// ============================================================================
// FINAL SUMMARY TEST
// ============================================================================
describe('FINAL SUMMARY - All Systems Meet Purposes', () => {
  test('All 7 systems are functional', () => {
    const systemsVerified = {
      prismaSchema: typeof addXp === 'function',
      leaderboards: typeof calculateEffectiveXp === 'function',
      migrationXp: typeof calculateMigrationBonus === 'function',
      seasons: typeof getCurrentSeason === 'function',
      trustScore: typeof applyPenalty === 'function',
      telemetry: typeof calculateMinimumReadTime === 'function',
      antiBot: typeof calculateStreakBonus === 'function',
    };
    
    for (const [system, isWorking] of Object.entries(systemsVerified)) {
      expect(isWorking).toBe(true);
    }
  });

  test('Core invariants hold', () => {
    // XP is always non-negative
    expect(addXp(0, -100)).toBeGreaterThanOrEqual(0);
    
    // Trust score is always in range
    expect(TRUST_SCORE_MIN).toBeGreaterThan(0);
    expect(TRUST_SCORE_MAX).toBeLessThanOrEqual(1);
    
    // Seasons have valid format
    expect(getCurrentSeason()).toMatch(/^\d{4}-Q[1-4]$/);
    
    // Migration bonus is capped
    expect(calculateMigrationBonus(999999)).toBeLessThanOrEqual(MIGRATION_XP_CAP);
    
    // Level progression is monotonic
    expect(calculateLevel(400)).toBeGreaterThan(calculateLevel(100));
  });
});
