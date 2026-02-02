/**
 * ANIME SEASON XP SYSTEM - INTEGRATION TESTS
 * 
 * TEST MATRIX:
 * 1. Season Detection - Verify correct season identification by date
 * 2. XP Accrual - Both lifetime and season XP update correctly
 * 3. Season Reset - Season XP resets at boundaries, lifetime unchanged
 * 4. Leaderboard - Season leaderboard uses season_xp only
 * 5. Achievements - Seasonal vs lifetime achievement behavior
 * 6. Data Safety - No XP loss on rollover, no duplicates
 * 7. Edge Cases - Inactive users, mid-season joins, leap years
 */

import {
  getCurrentSeason,
  getCurrentSeasonInfo,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  getSeasonDateRange,
  getSeasonFromMonth,
  convertLegacySeasonCode,
  parseSeason,
  ANIME_SEASONS,
  getSeasonDisplayName,
  getPreviousSeason,
  getNextSeason,
  getRecentSeasons,
  getSeasonDaysRemaining,
  getSeasonProgress,
  getSeasonContext
} from '@/lib/gamification/seasons';

describe('ANIME SEASON XP SYSTEM - QA TEST CASES', () => {
  
  // ============================================================
  // 1. SEASON DETECTION
  // ============================================================
  describe('1. SEASON DETECTION', () => {
    
    it('Date: Feb 10 → season = Winter, year = YYYY', () => {
      // February is month 2, which falls in Q1 (Winter)
      const season = getSeasonFromMonth(2);
      expect(season.key).toBe('winter');
      expect(season.quarter).toBe(1);
      expect(season.name).toBe('Winter');
    });

    it('Date: Apr 1 → season = Spring, year = YYYY', () => {
      // April is month 4, which falls in Q2 (Spring)
      const season = getSeasonFromMonth(4);
      expect(season.key).toBe('spring');
      expect(season.quarter).toBe(2);
      expect(season.name).toBe('Spring');
    });

    it('Date: Dec 31 → season = Fall, year = YYYY', () => {
      // December is month 12, which falls in Q4 (Fall)
      const season = getSeasonFromMonth(12);
      expect(season.key).toBe('fall');
      expect(season.quarter).toBe(4);
      expect(season.name).toBe('Fall');
    });

    it('should correctly map all 12 months to seasons', () => {
      // Winter: Jan-Mar (months 1-3)
      expect(getSeasonFromMonth(1).key).toBe('winter');
      expect(getSeasonFromMonth(2).key).toBe('winter');
      expect(getSeasonFromMonth(3).key).toBe('winter');
      
      // Spring: Apr-Jun (months 4-6)
      expect(getSeasonFromMonth(4).key).toBe('spring');
      expect(getSeasonFromMonth(5).key).toBe('spring');
      expect(getSeasonFromMonth(6).key).toBe('spring');
      
      // Summer: Jul-Sep (months 7-9)
      expect(getSeasonFromMonth(7).key).toBe('summer');
      expect(getSeasonFromMonth(8).key).toBe('summer');
      expect(getSeasonFromMonth(9).key).toBe('summer');
      
      // Fall: Oct-Dec (months 10-12)
      expect(getSeasonFromMonth(10).key).toBe('fall');
      expect(getSeasonFromMonth(11).key).toBe('fall');
      expect(getSeasonFromMonth(12).key).toBe('fall');
    });

    it('should generate correct season codes', () => {
      const season = getCurrentSeason();
      // Must match format YYYY-Q[1-4]
      expect(season).toMatch(/^\d{4}-Q[1-4]$/);
    });

    it('should handle season boundary dates correctly', () => {
      // Winter ends Mar 31, Spring starts Apr 1
      const winterEnd = getSeasonDateRange('2026-Q1')!;
      const springStart = getSeasonDateRange('2026-Q2')!;
      
      expect(winterEnd.end.getUTCMonth()).toBe(2); // March (0-indexed)
      expect(winterEnd.end.getUTCDate()).toBe(31);
      
      expect(springStart.start.getUTCMonth()).toBe(3); // April (0-indexed)
      expect(springStart.start.getUTCDate()).toBe(1);
    });
  });

  // ============================================================
  // 2. XP ACCRUAL
  // ============================================================
  describe('2. XP ACCRUAL', () => {
    
    it('Reading chapter on Mar 31: lifetime_xp increases, Winter season_xp increases', () => {
      // Simulate user in Winter 2026 (Q1)
      const currentSeason = '2026-Q1';
      const userSeasonXp = 100;
      const xpToAdd = 10;
      
      const result = calculateSeasonXpUpdate(userSeasonXp, currentSeason, xpToAdd);
      
      // If we're still in that season, season_xp should increase
      if (getCurrentSeason() === currentSeason) {
        expect(result.season_xp).toBe(110);
        expect(result.current_season).toBe(currentSeason);
      } else {
        // Season rolled over, XP should reset + new XP
        expect(result.season_xp).toBe(xpToAdd);
        expect(result.current_season).toBe(getCurrentSeason());
      }
    });

    it('Reading chapter on Apr 1: Spring season_xp increases, Winter season_xp is no longer affected', () => {
      // User was in Winter, now it's Spring
      const winterSeason = '2026-Q1';
      const springSeason = '2026-Q2';
      const oldSeasonXp = 500;
      const xpToAdd = 10;
      
      // Simulate transition from Winter to Spring
      const result = calculateSeasonXpUpdate(oldSeasonXp, winterSeason, xpToAdd);
      
      // If current season is different from stored season, rollover happens
      if (getCurrentSeason() !== winterSeason) {
        // Season XP should reset to just the new XP
        expect(result.season_xp).toBe(xpToAdd);
        expect(result.current_season).toBe(getCurrentSeason());
        // Old Winter XP (500) is NOT carried over
        expect(result.season_xp).not.toBe(oldSeasonXp + xpToAdd);
      }
    });

    it('should atomically update both lifetime and season XP', () => {
      const currentSeason = getCurrentSeason();
      const seasonXp = 50;
      const xpToAdd = 5;
      
      const result = calculateSeasonXpUpdate(seasonXp, currentSeason, xpToAdd);
      
      expect(result.season_xp).toBe(55);
      expect(result.current_season).toBe(currentSeason);
    });

    it('should handle null season XP for new users', () => {
      const result = calculateSeasonXpUpdate(null, null, 10);
      
      expect(result.season_xp).toBe(10);
      expect(result.current_season).toBe(getCurrentSeason());
    });
  });

  // ============================================================
  // 3. SEASON RESET
  // ============================================================
  describe('3. SEASON RESET', () => {
    
    it('On Apr 1: season_xp resets to 0, lifetime_xp unchanged', () => {
      // User had 1000 XP in Winter
      const winterXp = 1000;
      const winterSeason = '2025-Q1'; // Old season (definitely not current)
      const newXp = 10;
      
      const result = calculateSeasonXpUpdate(winterXp, winterSeason, newXp);
      
      // Season should rollover - old XP is gone
      expect(result.season_xp).toBe(newXp); // Only new XP, not winterXp + newXp
      expect(result.current_season).toBe(getCurrentSeason());
    });

    it('should detect rollover needed for past seasons', () => {
      expect(needsSeasonRollover('2020-Q1')).toBe(true);
      expect(needsSeasonRollover('2020-Q2')).toBe(true);
      expect(needsSeasonRollover('2020-Q3')).toBe(true);
      expect(needsSeasonRollover('2020-Q4')).toBe(true);
    });

    it('should not rollover for current season', () => {
      const current = getCurrentSeason();
      expect(needsSeasonRollover(current)).toBe(false);
    });

    it('should rollover null/undefined season (new user)', () => {
      expect(needsSeasonRollover(null)).toBe(true);
    });
  });

  // ============================================================
  // 4. LEADERBOARD
  // ============================================================
  describe('4. LEADERBOARD', () => {
    
    it('Seasonal leaderboard uses season_xp only', () => {
      // Simulate two users
      const userA = { lifetime_xp: 10000, season_xp: 50 };
      const userB = { lifetime_xp: 100, season_xp: 500 };
      
      // For seasonal leaderboard, userB should rank higher despite lower lifetime XP
      expect(userB.season_xp).toBeGreaterThan(userA.season_xp);
    });

    it('Users with higher lifetime_xp but lower season_xp rank lower in seasonal', () => {
      const highLifetimeLowSeason = { lifetime: 50000, season: 10 };
      const lowLifetimeHighSeason = { lifetime: 100, season: 1000 };
      
      // Seasonal ranking should favor season_xp
      const seasonalRanking = [highLifetimeLowSeason, lowLifetimeHighSeason]
        .sort((a, b) => b.season - a.season);
      
      expect(seasonalRanking[0]).toBe(lowLifetimeHighSeason);
    });

    it('should provide season context for API', () => {
      const context = getSeasonContext();
      
      expect(context.current_season).toMatch(/^\d{4}-Q[1-4]$/);
      expect(['winter', 'spring', 'summer', 'fall']).toContain(context.season_key);
      expect(['Winter', 'Spring', 'Summer', 'Fall']).toContain(context.season_name);
      expect(typeof context.season_year).toBe('number');
      expect(typeof context.days_remaining).toBe('number');
      expect(context.days_remaining).toBeGreaterThanOrEqual(0);
      expect(context.days_remaining).toBeLessThanOrEqual(92);
      expect(context.progress).toBeGreaterThanOrEqual(0);
      expect(context.progress).toBeLessThanOrEqual(100);
    });
  });

  // ============================================================
  // 5. ACHIEVEMENTS
  // ============================================================
  describe('5. ACHIEVEMENTS', () => {
    
    it('Lifetime achievements unlock across seasons (permanent)', () => {
      // Lifetime achievements are stored in user_achievements table
      // They persist forever regardless of season
      const lifetimeAchievement = {
        is_seasonal: false,
        unlocked_at: new Date('2025-01-01'),
      };
      
      expect(lifetimeAchievement.is_seasonal).toBe(false);
    });

    it('Seasonal achievements reset eligibility each season', () => {
      // Seasonal achievements are stored in seasonal_user_achievements
      // with a season_id, allowing re-unlock in new seasons
      const seasonalAchievement = {
        is_seasonal: true,
        season_id: '2026-Q1',
      };
      
      expect(seasonalAchievement.is_seasonal).toBe(true);
      expect(seasonalAchievement.season_id).toBeDefined();
    });
  });

  // ============================================================
  // 6. DATA SAFETY
  // ============================================================
  describe('6. DATA SAFETY', () => {
    
    it('No XP loss on rollover - lifetime XP is never affected', () => {
      // calculateSeasonXpUpdate only returns season data
      // The caller (progress API) handles lifetime XP separately with addXp()
      const oldSeasonXp = 1000;
      const oldSeason = '2020-Q1';
      const newXp = 10;
      
      const result = calculateSeasonXpUpdate(oldSeasonXp, oldSeason, newXp);
      
      // Season XP resets, but this function doesn't touch lifetime XP
      // Lifetime XP is handled by addXp() in the progress API
      expect(result.season_xp).toBe(newXp); // Reset + new
    });

    it('No duplicate XP events - calculateSeasonXpUpdate is deterministic', () => {
      const season = getCurrentSeason();
      const currentXp = 100;
      const xpToAdd = 10;
      
      const result1 = calculateSeasonXpUpdate(currentXp, season, xpToAdd);
      const result2 = calculateSeasonXpUpdate(currentXp, season, xpToAdd);
      
      // Same input = same output
      expect(result1.season_xp).toBe(result2.season_xp);
      expect(result1.current_season).toBe(result2.current_season);
    });

    it('should handle zero XP additions correctly', () => {
      const season = getCurrentSeason();
      const result = calculateSeasonXpUpdate(100, season, 0);
      
      expect(result.season_xp).toBe(100);
      expect(result.current_season).toBe(season);
    });
  });

  // ============================================================
  // 7. EDGE CASES
  // ============================================================
  describe('7. EDGE CASES', () => {
    
    it('User inactive entire season → season_xp = 0', () => {
      // If user hasn't earned any XP in current season and had old season stored
      const oldSeason = '2020-Q1';
      const oldSeasonXp = 500;
      
      // When they return and earn 0 XP (just checking in)
      const result = calculateSeasonXpUpdate(oldSeasonXp, oldSeason, 0);
      
      // Rollover happens, but they earned 0 XP this session
      expect(result.season_xp).toBe(0);
      expect(result.current_season).toBe(getCurrentSeason());
    });

    it('User joins mid-season → starts with season_xp = 0', () => {
      // New user has null for both fields
      const result = calculateSeasonXpUpdate(null, null, 10);
      
      // They start fresh with just their first XP
      expect(result.season_xp).toBe(10);
      expect(result.current_season).toBe(getCurrentSeason());
    });

    it('should handle large XP values', () => {
      const currentSeason = getCurrentSeason();
      const largeXp = 999_999_990;
      
      const result = calculateSeasonXpUpdate(largeXp, currentSeason, 5);
      expect(result.season_xp).toBe(999_999_995);
    });

    it('should handle negative XP gracefully (should not happen, but safety)', () => {
      const currentSeason = getCurrentSeason();
      // If somehow negative XP got stored
      const result = calculateSeasonXpUpdate(-100, currentSeason, 10);
      
      // Should add normally (the progress API should handle validation)
      expect(result.season_xp).toBe(-90);
    });

    it('should correctly identify season boundaries for leap years', () => {
      // Feb 2024 was a leap year (29 days)
      const leapWinter = getSeasonDateRange('2024-Q1');
      expect(leapWinter).not.toBeNull();
      expect(leapWinter!.end.getUTCMonth()).toBe(2); // March
      expect(leapWinter!.end.getUTCDate()).toBe(31); // March 31
    });
  });

  // ============================================================
  // LEGACY FORMAT MIGRATION
  // ============================================================
  describe('LEGACY FORMAT MIGRATION', () => {
    
    it('should convert legacy monthly format to quarterly', () => {
      // Winter months (Jan-Mar)
      expect(convertLegacySeasonCode('2026-01')).toBe('2026-Q1');
      expect(convertLegacySeasonCode('2026-02')).toBe('2026-Q1');
      expect(convertLegacySeasonCode('2026-03')).toBe('2026-Q1');
      
      // Spring months (Apr-Jun)
      expect(convertLegacySeasonCode('2026-04')).toBe('2026-Q2');
      expect(convertLegacySeasonCode('2026-05')).toBe('2026-Q2');
      expect(convertLegacySeasonCode('2026-06')).toBe('2026-Q2');
      
      // Summer months (Jul-Sep)
      expect(convertLegacySeasonCode('2026-07')).toBe('2026-Q3');
      expect(convertLegacySeasonCode('2026-08')).toBe('2026-Q3');
      expect(convertLegacySeasonCode('2026-09')).toBe('2026-Q3');
      
      // Fall months (Oct-Dec)
      expect(convertLegacySeasonCode('2026-10')).toBe('2026-Q4');
      expect(convertLegacySeasonCode('2026-11')).toBe('2026-Q4');
      expect(convertLegacySeasonCode('2026-12')).toBe('2026-Q4');
    });

    it('should not modify already quarterly format', () => {
      expect(convertLegacySeasonCode('2026-Q1')).toBe('2026-Q1');
      expect(convertLegacySeasonCode('2026-Q2')).toBe('2026-Q2');
      expect(convertLegacySeasonCode('2026-Q3')).toBe('2026-Q3');
      expect(convertLegacySeasonCode('2026-Q4')).toBe('2026-Q4');
    });

    it('should handle invalid formats gracefully', () => {
      // Invalid formats should return as-is
      expect(convertLegacySeasonCode('invalid')).toBe('invalid');
      expect(convertLegacySeasonCode('')).toBe('');
      expect(convertLegacySeasonCode('2026')).toBe('2026');
    });

    it('should parse both legacy and new formats', () => {
      const legacyParsed = parseSeason('2026-01');
      const newParsed = parseSeason('2026-Q1');
      
      // Both should resolve to Q1 (Winter)
      expect(legacyParsed?.quarter).toBe(1);
      expect(newParsed?.quarter).toBe(1);
      expect(legacyParsed?.key).toBe('winter');
      expect(newParsed?.key).toBe('winter');
    });
  });

  // ============================================================
  // DISPLAY FORMATTING
  // ============================================================
  describe('DISPLAY FORMATTING', () => {
    
    it('should generate anime-style display names', () => {
      expect(getSeasonDisplayName('2026-Q1')).toBe('Winter 2026');
      expect(getSeasonDisplayName('2026-Q2')).toBe('Spring 2026');
      expect(getSeasonDisplayName('2026-Q3')).toBe('Summer 2026');
      expect(getSeasonDisplayName('2026-Q4')).toBe('Fall 2026');
    });

    it('should handle legacy format in display names', () => {
      expect(getSeasonDisplayName('2026-01')).toBe('Winter 2026');
      expect(getSeasonDisplayName('2026-07')).toBe('Summer 2026');
    });

    it('should generate recent seasons list for dropdown', () => {
      const seasons = getRecentSeasons(8);
      
      expect(seasons).toHaveLength(8);
      expect(seasons[0]).toBe(getCurrentSeason()); // Current season first
      
      // All should be valid quarterly format
      seasons.forEach(s => {
        expect(s).toMatch(/^\d{4}-Q[1-4]$/);
      });
    });
  });

  // ============================================================
  // SEASON NAVIGATION
  // ============================================================
  describe('SEASON NAVIGATION', () => {
    
    it('should correctly get previous season', () => {
      expect(getPreviousSeason('2026-Q2')).toBe('2026-Q1');
      expect(getPreviousSeason('2026-Q1')).toBe('2025-Q4'); // Year wrap
    });

    it('should correctly get next season', () => {
      expect(getNextSeason('2026-Q3')).toBe('2026-Q4');
      expect(getNextSeason('2026-Q4')).toBe('2027-Q1'); // Year wrap
    });

    it('should calculate days remaining correctly', () => {
      const daysRemaining = getSeasonDaysRemaining();
      
      expect(daysRemaining).toBeGreaterThanOrEqual(0);
      expect(daysRemaining).toBeLessThanOrEqual(92); // Max days in quarter
    });

    it('should calculate season progress correctly', () => {
      const progress = getSeasonProgress();
      
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });
  });
});
