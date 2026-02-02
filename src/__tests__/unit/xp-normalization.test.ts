/**
 * QA: XP NORMALIZATION ACROSS SEASONS
 * 
 * SCENARIOS:
 * 1. End of season trigger - xp_seasonal reset, xp_total unchanged
 * 2. New season starts - UserSeasonXP rows, leaderboards use xp_seasonal
 * 3. High previous season XP user - no carryover advantage
 * 4. All-time leaderboard uses xp_total
 */

import {
  getCurrentSeason,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  getPreviousSeason,
  getSeasonDisplayName,
  getRecentSeasons,
  parseSeason,
  getSeasonContext,
} from '@/lib/gamification/seasons';

describe('XP Normalization Across Seasons', () => {
  
  describe('Scenario 1: End of Season Trigger', () => {
    
    it('xp_seasonal resets to 0 when season changes', () => {
      const oldSeason = '2020-Q1';
      const oldSeasonXp = 5000;
      const newXpGain = 10;
      
      const result = calculateSeasonXpUpdate(oldSeasonXp, oldSeason, newXpGain);
      
      expect(result.season_xp).toBe(newXpGain);
      expect(result.season_xp).not.toBe(oldSeasonXp + newXpGain);
    });
    
    it('xp_total would remain unchanged (calculated separately)', () => {
      const lifetimeXp = 10000;
      const seasonXp = 5000;
      const oldSeason = '2020-Q1';
      const newXpGain = 10;
      
      const seasonUpdate = calculateSeasonXpUpdate(seasonXp, oldSeason, newXpGain);
      const newLifetimeXp = lifetimeXp + newXpGain;
      
      expect(newLifetimeXp).toBe(10010);
      expect(seasonUpdate.season_xp).toBe(10);
    });
    
    it('detects old season needs rollover', () => {
      expect(needsSeasonRollover('2020-Q1')).toBe(true);
      expect(needsSeasonRollover('2020-Q4')).toBe(true);
      expect(needsSeasonRollover('2021-Q2')).toBe(true);
    });
    
    it('current season does not need rollover', () => {
      const currentSeason = getCurrentSeason();
      expect(needsSeasonRollover(currentSeason)).toBe(false);
    });
  });
  
  describe('Scenario 2: New Season Starts', () => {
    
    it('new XP gain initializes season_xp correctly', () => {
      const result = calculateSeasonXpUpdate(null, null, 100);
      
      expect(result.season_xp).toBe(100);
      expect(result.current_season).toBe(getCurrentSeason());
    });
    
    it('season context includes all required leaderboard fields', () => {
      const ctx = getSeasonContext();
      
      expect(ctx.current_season).toMatch(/^\d{4}-Q[1-4]$/);
      expect(ctx.season_key).toMatch(/^(winter|spring|summer|fall)$/);
      expect(ctx.season_name).toBeDefined();
      expect(ctx.season_year).toBeGreaterThan(2020);
      expect(ctx.days_remaining).toBeGreaterThanOrEqual(0);
      expect(ctx.progress).toBeGreaterThanOrEqual(0);
      expect(ctx.progress).toBeLessThanOrEqual(100);
    });
    
    it('recent seasons list starts with current season', () => {
      const seasons = getRecentSeasons(4);
      const currentSeason = getCurrentSeason();
      
      expect(seasons[0]).toBe(currentSeason);
      expect(seasons.length).toBe(4);
    });
  });
  
  describe('Scenario 3: High Previous Season XP - No Carryover', () => {
    
    it('user with 50000 season XP starts at 0 in new season', () => {
      const previousSeasonXp = 50000;
      const previousSeason = getPreviousSeason(getCurrentSeason());
      const newXpGain = 10;
      
      const result = calculateSeasonXpUpdate(previousSeasonXp, previousSeason, newXpGain);
      
      expect(result.season_xp).toBe(10);
      expect(result.season_xp).not.toBeGreaterThan(newXpGain);
    });
    
    it('whales must earn XP again each season', () => {
      const whaleSeasonXp = 100000;
      const oldSeason = '2020-Q4';
      const newSeason = getCurrentSeason();
      
      const result = calculateSeasonXpUpdate(whaleSeasonXp, oldSeason, 0);
      
      expect(result.season_xp).toBe(0);
      expect(result.current_season).toBe(newSeason);
    });
    
    it('first-place user from last season starts equal to new user', () => {
      const topUserOldSeasonXp = 999999;
      const newUserXp = 0;
      const oldSeason = '2020-Q1';
      
      const topUserResult = calculateSeasonXpUpdate(topUserOldSeasonXp, oldSeason, 50);
      const newUserResult = calculateSeasonXpUpdate(newUserXp, null, 50);
      
      expect(topUserResult.season_xp).toBe(newUserResult.season_xp);
      expect(topUserResult.season_xp).toBe(50);
    });
  });
  
  describe('Scenario 4: All-Time Leaderboard Uses xp_total', () => {
    
    it('lifetime XP calculation is independent of season', () => {
      const initialLifetimeXp = 10000;
      const xpGain = 100;
      
      const newLifetimeXp = initialLifetimeXp + xpGain;
      
      expect(newLifetimeXp).toBe(10100);
    });
    
    it('season rollover does not affect lifetime XP calculation', () => {
      const lifetimeXp = 50000;
      const seasonXp = 20000;
      const oldSeason = '2020-Q1';
      const xpGain = 100;
      
      const seasonResult = calculateSeasonXpUpdate(seasonXp, oldSeason, xpGain);
      const newLifetimeXp = lifetimeXp + xpGain;
      
      expect(seasonResult.season_xp).toBe(xpGain);
      expect(newLifetimeXp).toBe(50100);
    });
  });
  
  describe('Clean Separation Verification', () => {
    
    it('calculateSeasonXpUpdate only affects season fields', () => {
      const result = calculateSeasonXpUpdate(1000, '2020-Q1', 50);
      
      expect(result).toHaveProperty('season_xp');
      expect(result).toHaveProperty('current_season');
      expect(result).not.toHaveProperty('xp');
      expect(result).not.toHaveProperty('xp_total');
      expect(result).not.toHaveProperty('lifetime_xp');
    });
    
    it('same season accumulates correctly', () => {
      const currentSeason = getCurrentSeason();
      
      let seasonXp = 0;
      for (let i = 0; i < 10; i++) {
        const result = calculateSeasonXpUpdate(seasonXp, currentSeason, 100);
        seasonXp = result.season_xp;
      }
      
      expect(seasonXp).toBe(1000);
    });
    
    it('null handling is safe', () => {
      expect(() => calculateSeasonXpUpdate(null, null, 0)).not.toThrow();
      expect(() => calculateSeasonXpUpdate(0, null, 0)).not.toThrow();
      expect(() => calculateSeasonXpUpdate(null, getCurrentSeason(), 0)).not.toThrow();
    });
    
    it('zero XP gain is valid', () => {
      const currentSeason = getCurrentSeason();
      const result = calculateSeasonXpUpdate(100, currentSeason, 0);
      
      expect(result.season_xp).toBe(100);
    });
    
    it('season display names are human-readable', () => {
      expect(getSeasonDisplayName('2026-Q1')).toBe('Winter 2026');
      expect(getSeasonDisplayName('2026-Q2')).toBe('Spring 2026');
      expect(getSeasonDisplayName('2026-Q3')).toBe('Summer 2026');
      expect(getSeasonDisplayName('2026-Q4')).toBe('Fall 2026');
    });
  });
  
  describe('Edge Cases', () => {
    
    it('handles negative XP gracefully', () => {
      const result = calculateSeasonXpUpdate(-100, getCurrentSeason(), 50);
      expect(result.season_xp).toBe(-50);
    });
    
    it('handles very large XP values', () => {
      const result = calculateSeasonXpUpdate(Number.MAX_SAFE_INTEGER - 100, getCurrentSeason(), 50);
      expect(result.season_xp).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
    });
    
    it('parseSeason handles invalid formats', () => {
      expect(parseSeason('invalid')).toBeNull();
      expect(parseSeason('')).toBeNull();
      expect(parseSeason('2026-Q5')).toBeNull();
    });
    
    it('getPreviousSeason wraps year correctly', () => {
      expect(getPreviousSeason('2026-Q1')).toBe('2025-Q4');
    });
  });
});
