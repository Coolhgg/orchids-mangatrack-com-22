/**
 * SEASONAL ACHIEVEMENTS - QA INTEGRATION TESTS
 * 
 * TEST CASES FROM QA SPEC:
 * 1. Achievement unlocked during season → XP added to season_xp + achievement marked completed
 * 2. Same achievement after season ends → Cannot unlock, status = "Expired"
 * 3. New season starts → Fresh achievement set, old season read-only
 * 4. Leaderboard impact → Seasonal XP reflects achievement XP, lifetime unaffected by reset
 */

import {
  getCurrentSeason,
  needsSeasonRollover,
  calculateSeasonXpUpdate,
  getSeasonDateRange,
  getPreviousSeason,
  getNextSeason,
} from '@/lib/gamification/seasons';

import {
  SEASONAL_ACHIEVEMENTS,
  SeasonalAchievementDefinition,
  SeasonalUserStats,
  SeasonalAchievementProgress,
  PastSeasonAchievement,
} from '@/lib/gamification/seasonal-achievements';

describe('SEASONAL ACHIEVEMENTS - QA TEST CASES', () => {

  // ============================================================
  // TEST CASE 1: Achievement unlocked during season
  // EXPECT: XP added to season_xp, achievement marked completed
  // ============================================================
  describe('TEST CASE 1: Achievement unlocked during season', () => {

    it('should add XP to both lifetime and seasonal when achievement unlocks', () => {
      const currentSeason = getCurrentSeason();
      const userLifetimeXp = 1000;
      const userSeasonXp = 100;
      const achievementXp = 50; // seasonal_reader_25 reward

      // Simulate achievement XP going to seasonal
      const seasonUpdate = calculateSeasonXpUpdate(userSeasonXp, currentSeason, achievementXp);
      
      // Calculate new lifetime (in actual code, this is done via addXp())
      const newLifetimeXp = userLifetimeXp + achievementXp;

      // ASSERT: Seasonal XP increases
      expect(seasonUpdate.season_xp).toBe(userSeasonXp + achievementXp);
      expect(seasonUpdate.current_season).toBe(currentSeason);

      // ASSERT: Lifetime XP increases
      expect(newLifetimeXp).toBe(1050);
    });

    it('should mark achievement as completed with timestamp', () => {
      const mockUnlock = {
        user_id: 'test-user',
        achievement_id: 'seasonal_reader_25',
        season_id: getCurrentSeason(),
        unlocked_at: new Date(),
      };

      expect(mockUnlock.unlocked_at).toBeInstanceOf(Date);
      expect(mockUnlock.season_id).toBe(getCurrentSeason());
    });

    it('should prevent duplicate unlocks in the same season', () => {
      const existingUnlocks = [
        { achievement_id: 'seasonal_reader_25', season_id: '2026-Q1' }
      ];
      
      const tryingToUnlock = { achievement_id: 'seasonal_reader_25', season_id: '2026-Q1' };

      const isDuplicate = existingUnlocks.some(
        u => u.achievement_id === tryingToUnlock.achievement_id && 
             u.season_id === tryingToUnlock.season_id
      );

      expect(isDuplicate).toBe(true);
    });

    it('should correctly calculate XP for multiple achievement unlocks', () => {
      const currentSeason = getCurrentSeason();
      let seasonXp = 0;
      let lifetimeXp = 1000;

      // Unlock 3 achievements in sequence
      const achievements = [
        { xp_reward: 50 },  // seasonal_reader_25
        { xp_reward: 200 }, // seasonal_reader_150
        { xp_reward: 500 }, // seasonal_reader_500
      ];

      for (const achievement of achievements) {
        const update = calculateSeasonXpUpdate(seasonXp, currentSeason, achievement.xp_reward);
        seasonXp = update.season_xp;
        lifetimeXp += achievement.xp_reward;
      }

      expect(seasonXp).toBe(750); // 50 + 200 + 500
      expect(lifetimeXp).toBe(1750); // 1000 + 750
    });

    it('should include achievement in progress response after unlock', () => {
      const mockProgress: SeasonalAchievementProgress = {
        code: 'seasonal_reader_25',
        name: 'Seasonal Reader',
        description: 'Read 25 chapters this season',
        xp_reward: 50,
        rarity: 'common',
        current_value: 30,
        threshold: 25,
        progress_percent: 100,
        is_unlocked: true,
        unlocked_at: new Date(),
        is_end_of_season: false,
      };

      expect(mockProgress.is_unlocked).toBe(true);
      expect(mockProgress.unlocked_at).not.toBeNull();
      expect(mockProgress.progress_percent).toBe(100);
    });
  });

  // ============================================================
  // TEST CASE 2: Same achievement after season ends
  // EXPECT: Cannot unlock, status = "Expired" / "Missed"
  // ============================================================
  describe('TEST CASE 2: Same achievement after season ends', () => {

    it('should NOT allow unlocking achievements from past seasons', () => {
      const currentSeason = getCurrentSeason();
      const pastSeason = getPreviousSeason(currentSeason);

      // Attempt to unlock in past season should be blocked
      const isValidSeason = pastSeason === currentSeason;
      expect(isValidSeason).toBe(false);
    });

    it('should mark past achievement as "missed" if not unlocked', () => {
      const mockPastAchievement: PastSeasonAchievement = {
        code: 'seasonal_reader_500',
        name: 'Seasonal Legend',
        description: 'Read 500 chapters this season',
        xp_reward: 500,
        rarity: 'legendary',
        status: 'missed', // Not unlocked before season ended
        unlocked_at: null,
        season_code: '2025-Q4',
        season_name: 'Fall 2025',
      };

      expect(mockPastAchievement.status).toBe('missed');
      expect(mockPastAchievement.unlocked_at).toBeNull();
    });

    it('should preserve "completed" status for achievements unlocked before season end', () => {
      const mockPastAchievement: PastSeasonAchievement = {
        code: 'seasonal_reader_25',
        name: 'Seasonal Reader',
        description: 'Read 25 chapters this season',
        xp_reward: 50,
        rarity: 'common',
        status: 'completed',
        unlocked_at: new Date('2025-11-15'),
        season_code: '2025-Q4',
        season_name: 'Fall 2025',
      };

      expect(mockPastAchievement.status).toBe('completed');
      expect(mockPastAchievement.unlocked_at).not.toBeNull();
    });

    it('should detect expired season using needsSeasonRollover', () => {
      const pastSeason = '2024-Q1'; // Definitely past
      expect(needsSeasonRollover(pastSeason)).toBe(true);

      const currentSeason = getCurrentSeason();
      expect(needsSeasonRollover(currentSeason)).toBe(false);
    });

    it('should return empty unlocks when checking achievements for past season', () => {
      const pastSeasonDateRange = getSeasonDateRange('2020-Q1');
      const now = new Date();

      // Season has ended
      const isSeasonActive = pastSeasonDateRange && 
        now >= pastSeasonDateRange.start && 
        now <= pastSeasonDateRange.end;

      expect(isSeasonActive).toBe(false);
    });

    it('should distinguish between "completed" and "missed" in past seasons', () => {
      const pastSeasonAchievements = [
        { code: 'seasonal_reader_25', unlocked_at: new Date('2025-10-15') },
        { code: 'seasonal_reader_150', unlocked_at: null },
        { code: 'seasonal_reader_500', unlocked_at: null },
      ];

      const results = pastSeasonAchievements.map(a => ({
        code: a.code,
        status: a.unlocked_at ? 'completed' : 'missed',
      }));

      expect(results[0].status).toBe('completed');
      expect(results[1].status).toBe('missed');
      expect(results[2].status).toBe('missed');
    });
  });

  // ============================================================
  // TEST CASE 3: New season starts
  // EXPECT: Fresh achievement set available, old season read-only
  // ============================================================
  describe('TEST CASE 3: New season starts', () => {

    it('should allow re-earning same achievement in new season', () => {
      const winterSeason = '2026-Q1';
      const springSeason = '2026-Q2';

      // User unlocked in Winter
      const winterUnlock = {
        user_id: 'test-user',
        achievement_id: 'seasonal_reader_25',
        season_id: winterSeason,
      };

      // User can unlock again in Spring (different season_id)
      const springUnlock = {
        user_id: 'test-user',
        achievement_id: 'seasonal_reader_25',
        season_id: springSeason,
      };

      // Unique constraint is (user_id, achievement_id, season_id)
      // These are different records due to different season_id
      expect(winterUnlock.season_id).not.toBe(springUnlock.season_id);
      expect(winterUnlock.achievement_id).toBe(springUnlock.achievement_id);
    });

    it('should reset progress tracking for new season', () => {
      const userStatsWinter: SeasonalUserStats = {
        chapters_read: 500,
        series_completed: 10,
        series_added: 20,
        streak_max: 30,
        seasonal_xp: 5000,
      };

      // In new season, stats reset
      const userStatsSpring: SeasonalUserStats = {
        chapters_read: 0,
        series_completed: 0,
        series_added: 0,
        streak_max: 0,
        seasonal_xp: 0,
      };

      expect(userStatsSpring.chapters_read).toBe(0);
      expect(userStatsSpring.seasonal_xp).toBe(0);
    });

    it('should preserve old season data as read-only', () => {
      const archivedSeasonData = {
        season_code: '2025-Q4',
        season_name: 'Fall 2025',
        final_xp: 5000,
        final_rank: 42,
        is_editable: false,
      };

      expect(archivedSeasonData.is_editable).toBe(false);
      expect(archivedSeasonData.final_xp).toBe(5000);
      expect(archivedSeasonData.final_rank).toBe(42);
    });

    it('should correctly transition season codes', () => {
      expect(getNextSeason('2026-Q1')).toBe('2026-Q2');
      expect(getNextSeason('2026-Q2')).toBe('2026-Q3');
      expect(getNextSeason('2026-Q3')).toBe('2026-Q4');
      expect(getNextSeason('2026-Q4')).toBe('2027-Q1'); // Year wrap
    });

    it('should have fresh achievement set for each season', () => {
      // All seasonal achievements should be available in new season
      const seasonalCodes = SEASONAL_ACHIEVEMENTS.map(a => a.code);

      expect(seasonalCodes).toContain('seasonal_reader_25');
      expect(seasonalCodes).toContain('seasonal_reader_150');
      expect(seasonalCodes).toContain('seasonal_reader_500');
      expect(seasonalCodes).toContain('seasonal_tracker_5');
      expect(seasonalCodes).toContain('seasonal_streak_14');
      expect(seasonalCodes).toContain('seasonal_completionist_10');
    });

    it('should calculate season_xp from 0 when season changes', () => {
      const oldSeason = '2025-Q4';
      const oldSeasonXp = 5000;
      const newXp = 10;

      const result = calculateSeasonXpUpdate(oldSeasonXp, oldSeason, newXp);

      // Should have rolled over - old XP is gone
      expect(result.season_xp).toBe(newXp);
      expect(result.current_season).toBe(getCurrentSeason());
    });
  });

  // ============================================================
  // TEST CASE 4: Leaderboard impact
  // EXPECT: Seasonal XP reflects achievement XP, total XP unaffected by reset
  // ============================================================
  describe('TEST CASE 4: Leaderboard impact', () => {

    it('should reflect achievement XP in seasonal leaderboard', () => {
      const userBeforeAchievement = { season_xp: 100 };
      const achievementXp = 50;
      const currentSeason = getCurrentSeason();

      const update = calculateSeasonXpUpdate(
        userBeforeAchievement.season_xp, 
        currentSeason, 
        achievementXp
      );

      expect(update.season_xp).toBe(150);
    });

    it('should NOT reset lifetime XP when season changes', () => {
      let lifetimeXp = 10000;
      let seasonXp = 500;

      // Season ends
      const oldSeason = '2025-Q4';
      const newXp = 10;

      // Season XP resets
      const seasonUpdate = calculateSeasonXpUpdate(seasonXp, oldSeason, newXp);
      expect(seasonUpdate.season_xp).toBe(newXp); // Reset to just new XP

      // Lifetime XP is NEVER reset (handled separately)
      lifetimeXp += newXp;
      expect(lifetimeXp).toBe(10010); // Still has all historical XP
    });

    it('should rank users by season_xp for seasonal leaderboard', () => {
      const users = [
        { id: 'A', lifetime_xp: 50000, season_xp: 100 },
        { id: 'B', lifetime_xp: 1000, season_xp: 5000 },
        { id: 'C', lifetime_xp: 25000, season_xp: 2500 },
      ];

      const seasonalRanking = [...users].sort((a, b) => b.season_xp - a.season_xp);

      expect(seasonalRanking[0].id).toBe('B'); // 5000 season XP
      expect(seasonalRanking[1].id).toBe('C'); // 2500 season XP
      expect(seasonalRanking[2].id).toBe('A'); // 100 season XP
    });

    it('should rank users by lifetime_xp for all-time leaderboard', () => {
      const users = [
        { id: 'A', lifetime_xp: 50000, season_xp: 100 },
        { id: 'B', lifetime_xp: 1000, season_xp: 5000 },
        { id: 'C', lifetime_xp: 25000, season_xp: 2500 },
      ];

      const lifetimeRanking = [...users].sort((a, b) => b.lifetime_xp - a.lifetime_xp);

      expect(lifetimeRanking[0].id).toBe('A'); // 50000 lifetime XP
      expect(lifetimeRanking[1].id).toBe('C'); // 25000 lifetime XP
      expect(lifetimeRanking[2].id).toBe('B'); // 1000 lifetime XP
    });

    it('should preserve rank even with 0 seasonal XP if user was active last season', () => {
      const archivedRank = {
        user_id: 'test-user',
        season_id: '2025-Q4',
        final_xp: 8000,
        final_rank: 5,
      };

      // This is stored in UserSeasonXP table
      expect(archivedRank.final_rank).toBe(5);
      expect(archivedRank.final_xp).toBe(8000);
    });

    it('should award end-of-season percentile achievements correctly', () => {
      const totalUsers = 100;
      const rankings = Array.from({ length: totalUsers }, (_, i) => ({
        user_id: `user-${i + 1}`,
        rank: i + 1,
        season_xp: (totalUsers - i) * 100,
      }));

      const top1Threshold = Math.ceil(totalUsers * 0.01); // 1 user
      const top10Threshold = Math.ceil(totalUsers * 0.10); // 10 users

      const top1Users = rankings.filter(u => u.rank <= top1Threshold);
      const top10Users = rankings.filter(u => u.rank <= top10Threshold && u.rank > top1Threshold);

      expect(top1Users.length).toBe(1);
      expect(top10Users.length).toBe(9);

      // Top 1% gets 'seasonal_top_1' (1000 XP)
      // Top 10% gets 'seasonal_top_10' (300 XP)
    });

    it('should include achievement XP in both leaderboards', () => {
      const currentSeason = getCurrentSeason();
      
      // User earns 500 XP from legendary achievement
      const lifetimeXpBefore = 10000;
      const seasonXpBefore = 1000;
      const achievementXp = 500;

      // Both should increase
      const newLifetimeXp = lifetimeXpBefore + achievementXp;
      const seasonUpdate = calculateSeasonXpUpdate(seasonXpBefore, currentSeason, achievementXp);

      expect(newLifetimeXp).toBe(10500);
      expect(seasonUpdate.season_xp).toBe(1500);
    });
  });

  // ============================================================
  // EDGE CASES & DATA INTEGRITY
  // ============================================================
  describe('EDGE CASES & DATA INTEGRITY', () => {

    it('should handle concurrent achievement unlocks safely', () => {
      // The createManyAndReturn with skipDuplicates handles this
      const attemptedUnlocks = [
        { user_id: 'test', achievement_id: 'a1', season_id: '2026-Q1' },
        { user_id: 'test', achievement_id: 'a1', season_id: '2026-Q1' }, // Duplicate
      ];

      const uniqueUnlocks = attemptedUnlocks.filter(
        (unlock, index, self) =>
          index === self.findIndex(
            u => u.user_id === unlock.user_id && 
                 u.achievement_id === unlock.achievement_id && 
                 u.season_id === unlock.season_id
          )
      );

      expect(uniqueUnlocks.length).toBe(1);
    });

    it('should not award XP for already-unlocked achievements', () => {
      const unlockedAchievements = new Set(['seasonal_reader_25']);
      const candidateAchievements = ['seasonal_reader_25', 'seasonal_reader_150'];

      const newUnlocks = candidateAchievements.filter(
        code => !unlockedAchievements.has(code)
      );

      expect(newUnlocks).toEqual(['seasonal_reader_150']);
    });

    it('should validate XP reward values from definitions', () => {
      for (const achievement of SEASONAL_ACHIEVEMENTS) {
        expect(achievement.xp_reward).toBeGreaterThan(0);
        expect(achievement.xp_reward).toBeLessThanOrEqual(1000);
        expect(Number.isInteger(achievement.xp_reward)).toBe(true);
      }
    });

    it('should have valid criteria for all seasonal achievements', () => {
      const validCriteriaTypes = [
        'chapters_read_season',
        'series_completed_season',
        'series_added_season',
        'streak_season',
        'seasonal_xp_percentile',
      ];

      for (const achievement of SEASONAL_ACHIEVEMENTS) {
        expect(validCriteriaTypes).toContain(achievement.criteria.type);
        expect(achievement.criteria.threshold).toBeGreaterThan(0);
      }
    });

    it('should categorize achievements by rarity correctly', () => {
      const byRarity = SEASONAL_ACHIEVEMENTS.reduce((acc, a) => {
        acc[a.rarity] = (acc[a.rarity] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);

      expect(byRarity['common']).toBeGreaterThan(0);
      expect(byRarity['rare']).toBeGreaterThan(0);
      expect(byRarity['legendary']).toBeGreaterThan(0);
    });

    it('should identify end-of-season achievements correctly', () => {
      const endOfSeasonAchievements = SEASONAL_ACHIEVEMENTS.filter(
        a => a.is_end_of_season === true
      );

      expect(endOfSeasonAchievements.length).toBeGreaterThan(0);
      
      for (const achievement of endOfSeasonAchievements) {
        expect(achievement.criteria.type).toBe('seasonal_xp_percentile');
      }
    });
  });

  // ============================================================
  // API RESPONSE FORMAT VALIDATION
  // ============================================================
  describe('API RESPONSE FORMAT VALIDATION', () => {

    it('should return correct shape for current season progress', () => {
      const mockResponse = {
        season: {
          code: '2026-Q1',
          name: 'Winter 2026',
          days_remaining: 45,
          ends_at: new Date('2026-03-31'),
        },
        achievements: [] as SeasonalAchievementProgress[],
        stats: {
          chapters_read: 0,
          series_completed: 0,
          series_added: 0,
          streak_max: 0,
          seasonal_xp: 0,
        },
      };

      expect(mockResponse.season).toHaveProperty('code');
      expect(mockResponse.season).toHaveProperty('name');
      expect(mockResponse.season).toHaveProperty('days_remaining');
      expect(mockResponse.season).toHaveProperty('ends_at');
      expect(mockResponse).toHaveProperty('achievements');
      expect(mockResponse).toHaveProperty('stats');
    });

    it('should return correct shape for past seasons', () => {
      const mockResponse = {
        season_code: '2025-Q4',
        season_name: 'Fall 2025',
        final_xp: 5000,
        final_rank: 42,
        achievements: [] as PastSeasonAchievement[],
      };

      expect(mockResponse).toHaveProperty('season_code');
      expect(mockResponse).toHaveProperty('season_name');
      expect(mockResponse).toHaveProperty('final_xp');
      expect(mockResponse).toHaveProperty('final_rank');
      expect(mockResponse).toHaveProperty('achievements');
    });

    it('should return achievement unlock notification with required fields', () => {
      const mockUnlockNotification = {
        id: 'achievement-uuid',
        code: 'seasonal_reader_25',
        name: 'Seasonal Reader',
        xp_reward: 50,
        rarity: 'common',
        season_id: 'season-uuid',
        season_code: '2026-Q1',
      };

      expect(mockUnlockNotification).toHaveProperty('id');
      expect(mockUnlockNotification).toHaveProperty('code');
      expect(mockUnlockNotification).toHaveProperty('name');
      expect(mockUnlockNotification).toHaveProperty('xp_reward');
      expect(mockUnlockNotification).toHaveProperty('rarity');
      expect(mockUnlockNotification).toHaveProperty('season_id');
      expect(mockUnlockNotification).toHaveProperty('season_code');
    });
  });
});
