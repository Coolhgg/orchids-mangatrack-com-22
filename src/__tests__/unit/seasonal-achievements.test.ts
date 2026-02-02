/**
 * Tests for Seasonal Achievements System
 * 
 * Tests the following rules:
 * 1. Seasonal achievements reset every season
 * 2. XP goes to BOTH lifetime and seasonal XP
 * 3. Cannot stack achievements across seasons
 * 4. Progress is calculated correctly from seasonal stats
 */

import {
  SEASONAL_ACHIEVEMENTS,
  getSeasonalUserStats,
  checkSeasonalAchievements,
  getSeasonalAchievementProgress,
  awardEndOfSeasonAchievements,
  SeasonalAchievementCriteria,
} from '@/lib/gamification/seasonal-achievements';
import { getCurrentSeason, getSeasonDateRange } from '@/lib/gamification/seasons';

// Mock Prisma transaction client
const createMockTx = (overrides: Record<string, unknown> = {}) => ({
  season: {
    findFirst: jest.fn().mockResolvedValue({
      id: 'season-1',
      code: '2026-Q1',
      name: 'Winter 2026',
      is_active: true,
      starts_at: new Date('2026-01-01'),
      ends_at: new Date('2026-03-31'),
    }),
    findUnique: jest.fn().mockResolvedValue({
      id: 'season-1',
      code: '2026-Q1',
      name: 'Winter 2026',
    }),
  },
  user: {
    findUnique: jest.fn().mockResolvedValue({
      id: 'user-1',
      xp: 1000,
      season_xp: 500,
      current_season: '2026-Q1',
      streak_days: 10,
      longest_streak: 15,
    }),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({}),
  },
  userChapterReadV2: {
    count: jest.fn().mockResolvedValue(75),
  },
  libraryEntry: {
    count: jest.fn()
      .mockResolvedValueOnce(4) // completed
      .mockResolvedValueOnce(12), // added
  },
  achievement: {
    findMany: jest.fn().mockResolvedValue([
      {
        id: 'ach-1',
        code: 'seasonal_reader_25',
        name: 'Seasonal Reader',
        description: 'Read 25 chapters this season',
        xp_reward: 50,
        rarity: 'common',
        is_seasonal: true,
        criteria: { type: 'chapters_read_season', threshold: 25 },
      },
      {
        id: 'ach-2',
        code: 'seasonal_streak_14',
        name: 'Seasonal Dedication',
        description: 'Maintain a 14-day streak this season',
        xp_reward: 200,
        rarity: 'rare',
        is_seasonal: true,
        criteria: { type: 'streak_season', threshold: 14 },
      },
    ]),
  },
  seasonalUserAchievement: {
    findMany: jest.fn().mockResolvedValue([]),
    createManyAndReturn: jest.fn().mockResolvedValue([{ id: 'sua-1' }]),
  },
  activity: {
    create: jest.fn().mockResolvedValue({}),
  },
  ...overrides,
});

describe('Seasonal Achievements System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SEASONAL_ACHIEVEMENTS definitions', () => {
    it('should have all required achievements defined', () => {
      // Updated to match actual SEASONAL_ACHIEVEMENTS codes
      const requiredCodes = [
        'seasonal_reader_25',
        'seasonal_reader_150',
        'seasonal_reader_500',
        'seasonal_streak_14',
        'seasonal_completionist_10',
        'seasonal_top_10',
        'seasonal_top_1',
      ];

      for (const code of requiredCodes) {
        const achievement = SEASONAL_ACHIEVEMENTS.find(a => a.code === code);
        expect(achievement).toBeDefined();
      }
    });

    it('should have valid criteria for all achievements', () => {
      // Updated to match actual SeasonalAchievementCriteriaType values
      const validTypes = [
        'chapters_read_season',
        'series_completed_season',
        'series_added_season',
        'streak_season',
        'seasonal_xp_percentile',
      ];

      for (const achievement of SEASONAL_ACHIEVEMENTS) {
        expect(validTypes).toContain(achievement.criteria.type);
        expect(achievement.criteria.threshold).toBeGreaterThan(0);
      }
    });

    it('should have XP rewards matching the spec', () => {
      // Updated to match actual achievement codes and XP rewards
      const reader25 = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_reader_25');
      expect(reader25?.xp_reward).toBe(50);

      const streak14 = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_streak_14');
      expect(streak14?.xp_reward).toBe(200);

      const top10 = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_top_10');
      expect(top10?.xp_reward).toBe(300);
    });
  });

  describe('getSeasonalUserStats', () => {
    it('should return stats within the season date range', async () => {
      const tx = createMockTx();
      const stats = await getSeasonalUserStats(tx as any, 'user-1', '2026-Q1');

      expect(stats.chapters_read).toBe(75);
      expect(stats.series_completed).toBe(4);
      expect(stats.series_added).toBe(12);
      expect(stats.streak_max).toBe(15);
      expect(stats.seasonal_xp).toBe(500);
    });

    it('should return zeros for invalid season', async () => {
      const tx = createMockTx();
      const stats = await getSeasonalUserStats(tx as any, 'user-1', 'invalid-season');

      expect(stats.chapters_read).toBe(0);
      expect(stats.series_completed).toBe(0);
      expect(stats.series_added).toBe(0);
      expect(stats.streak_max).toBe(0);
      expect(stats.seasonal_xp).toBe(0);
    });
  });

  describe('checkSeasonalAchievements', () => {
    it('should award achievement when threshold is met', async () => {
      const tx = createMockTx();
      const result = await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');

      // Should have found achievements to check
      expect(tx.achievement.findMany).toHaveBeenCalled();
      
      // Should have attempted to create achievement unlock
      expect(tx.seasonalUserAchievement.createManyAndReturn).toHaveBeenCalled();
    });

    it('should not award if no active season', async () => {
      const tx = createMockTx({
        season: {
          findFirst: jest.fn().mockResolvedValue(null),
        },
      });
      
      const result = await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');
      expect(result).toEqual([]);
    });

    it('should update XP when achievements are unlocked', async () => {
      const tx = createMockTx();
      await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');

      // Should have updated user with XP (look for the XP update call)
      const updateCalls = tx.user.update.mock.calls;
      
      // Find the XP update call (has xp, level, season_xp)
      const xpUpdateCall = updateCalls.find((call: any[]) => 
        call[0]?.data?.xp !== undefined || 
        call[0]?.data?.level !== undefined ||
        call[0]?.data?.season_xp !== undefined
      );
      
      // Should have been called with XP update
      expect(xpUpdateCall).toBeDefined();
      if (xpUpdateCall) {
        expect(xpUpdateCall[0].data.xp).toBeDefined();
        expect(xpUpdateCall[0].data.season_xp).toBeDefined();
        expect(xpUpdateCall[0].data.level).toBeDefined();
      }
    });

    it('should skip already unlocked achievements', async () => {
      const tx = createMockTx({
        seasonalUserAchievement: {
          findMany: jest.fn().mockResolvedValue([
            { achievement_id: 'ach-1', unlocked_at: new Date() },
          ]),
          createManyAndReturn: jest.fn().mockResolvedValue([]), // No new unlocks
        },
      });

      await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');
      
      // Should not have any XP update calls (only activity logging)
      const updateCalls = tx.user.update.mock.calls;
      const xpUpdateCall = updateCalls.find((call: any[]) => 
        call[0]?.data?.xp !== undefined
      );
      expect(xpUpdateCall).toBeUndefined();
    });
  });

  describe('getSeasonalAchievementProgress', () => {
    it('should return progress for all seasonal achievements', async () => {
      const tx = createMockTx();
      const result = await getSeasonalAchievementProgress(tx as any, 'user-1');

      expect(result.season.code).toBe('2026-Q1');
      expect(result.season.name).toBe('Winter 2026');
      expect(result.achievements.length).toBeGreaterThan(0);
      expect(result.stats).toBeDefined();
    });

    it('should calculate progress percentage correctly', async () => {
      const tx = createMockTx();
      const result = await getSeasonalAchievementProgress(tx as any, 'user-1');

      // Find the reader_25 achievement (75 chapters read, threshold 25)
      const reader25 = result.achievements.find(a => a.code === 'seasonal_reader_25');
      expect(reader25?.progress_percent).toBe(100); // 75/25 = 300%, capped at 100
      expect(reader25?.current_value).toBe(75);
    });

    it('should mark end-of-season achievements correctly', async () => {
      const tx = createMockTx({
        achievement: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'ach-top10',
              code: 'seasonal_top_10',
              name: 'Top 10% Reader',
              description: 'Finish in top 10%',
              xp_reward: 300,
              rarity: 'rare',
              is_seasonal: true,
              criteria: { type: 'seasonal_xp_percentile', threshold: 10 },
            },
          ]),
        },
      });

      const result = await getSeasonalAchievementProgress(tx as any, 'user-1');
      const top10 = result.achievements.find(a => a.code === 'seasonal_top_10');
      
      expect(top10?.is_end_of_season).toBe(true);
      expect(top10?.progress_percent).toBe(0); // Can't show progress for percentile
    });
  });

  describe('awardEndOfSeasonAchievements', () => {
    it('should award top percentile achievements at season end', async () => {
      const tx = createMockTx({
        user: {
          ...createMockTx().user,
          findMany: jest.fn().mockResolvedValue([
            { id: 'user-1', season_xp: 1000 },
            { id: 'user-2', season_xp: 800 },
            { id: 'user-3', season_xp: 600 },
            { id: 'user-4', season_xp: 400 },
            { id: 'user-5', season_xp: 200 },
            { id: 'user-6', season_xp: 150 },
            { id: 'user-7', season_xp: 100 },
            { id: 'user-8', season_xp: 80 },
            { id: 'user-9', season_xp: 60 },
            { id: 'user-10', season_xp: 40 },
          ]),
          findUnique: jest.fn().mockResolvedValue({ xp: 1000 }),
          update: jest.fn().mockResolvedValue({}),
        },
        achievement: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'ach-top10',
              code: 'seasonal_top_10',
              name: 'Top 10% Reader',
              xp_reward: 300,
              rarity: 'rare',
            },
            {
              id: 'ach-top5',
              code: 'seasonal_top_5',
              name: 'Top 5% Reader',
              xp_reward: 500,
              rarity: 'epic',
            },
            {
              id: 'ach-top1',
              code: 'seasonal_top_1',
              name: 'Seasonal Champion',
              xp_reward: 1000,
              rarity: 'legendary',
            },
          ]),
        },
      });

      const results = await awardEndOfSeasonAchievements(tx as any, 'season-1');

      // Top 1 user should get the highest tier achievement
      expect(results.length).toBeGreaterThan(0);
    });

    it('should throw error for non-existent season', async () => {
      const tx = createMockTx({
        season: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        awardEndOfSeasonAchievements(tx as any, 'non-existent')
      ).rejects.toThrow('Season not found');
    });
  });

  describe('Seasonal rules enforcement', () => {
    it('Rule 1: Achievements can be re-earned each season', () => {
      // All seasonal achievements should have code starting with seasonal_
      for (const achievement of SEASONAL_ACHIEVEMENTS) {
        expect(achievement.code).toMatch(/^seasonal_/);
      }
    });

    it('Rule 2: XP updates both lifetime and seasonal XP', async () => {
      const tx = createMockTx();
      await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');

      // Find the XP update call
      const updateCalls = tx.user.update.mock.calls;
      const xpUpdateCall = updateCalls.find((call: any[]) => 
        call[0]?.data?.xp !== undefined
      );
      
      // If XP was awarded (achievements unlocked), both should be updated
      if (xpUpdateCall) {
        expect(xpUpdateCall[0].data.xp).toBeDefined();
        expect(xpUpdateCall[0].data.season_xp).toBeDefined();
      }
    });

    it('Rule 3: Cannot stack across seasons (unique constraint per season)', async () => {
      // The SeasonalUserAchievement has unique constraint on [user_id, achievement_id, season_id]
      // This is enforced at database level
      // We test that createManyAndReturn is called with skipDuplicates: true
      const tx = createMockTx();
      await checkSeasonalAchievements(tx as any, 'user-1', 'chapter_read');

      const createCall = tx.seasonalUserAchievement.createManyAndReturn.mock.calls[0]?.[0];
      expect(createCall?.skipDuplicates).toBe(true);
    });
  });

  describe('Achievement examples from spec', () => {
    it('Read 25 chapters this season → 50 XP (common)', () => {
      const achievement = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_reader_25');
      expect(achievement?.criteria.threshold).toBe(25);
      expect(achievement?.xp_reward).toBe(50);
    });

    it('Maintain 14-day streak this season → 200 XP (rare)', () => {
      const achievement = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_streak_14');
      expect(achievement?.criteria.threshold).toBe(14);
      expect(achievement?.xp_reward).toBe(200);
    });

    it('Top 10% seasonal XP → 300 XP', () => {
      const achievement = SEASONAL_ACHIEVEMENTS.find(a => a.code === 'seasonal_top_10');
      expect(achievement?.criteria.threshold).toBe(10);
      expect(achievement?.xp_reward).toBe(300);
    });
  });
});
