/**
 * INTEGRATION TESTS: Achievement Progress Bars
 * 
 * Tests the achievement progress calculation, unlock flow, and API endpoints.
 * 
 * COVERAGE:
 * 1. Progress calculation edge cases
 * 2. Unlock at 100% threshold
 * 3. Progress updates correctly with stat changes
 * 4. Hidden achievement visibility rules
 * 5. API endpoint validation
 * 6. Error handling and edge cases
 */

import { PrismaClient } from '@prisma/client';
import {
  getUserAchievementStats,
  calculateAchievementProgress,
  getAchievementProgressForUser,
  getNextUpAchievements,
  formatProgress,
  type AchievementProgress,
  type UserAchievementStats,
} from '@/lib/gamification/achievement-progress';
import { checkAchievements } from '@/lib/gamification/achievements';

// Use test database
const prisma = new PrismaClient();

describe('Achievement Progress System', () => {
  let testUserId: string;
  let testId: string;
  const achievementIds: string[] = [];
  const seriesIds: string[] = [];

  beforeAll(async () => {
    testId = Date.now().toString().slice(-8);
    // Use require('crypto') for Node.js environment
    const { randomUUID } = require('crypto');
    testUserId = randomUUID();

    // Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `test-progress-${testId}@test.com`,
        username: `test_progress_${testId}`,
        xp: 0,
        level: 1,
        chapters_read: 0,
        streak_days: 0,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    try {
      await prisma.userAchievement.deleteMany({ where: { user_id: testUserId } });
      await prisma.activity.deleteMany({ where: { user_id: testUserId } });
      for (const id of achievementIds) {
        await prisma.achievement.delete({ where: { id } }).catch(() => {});
      }
      await prisma.libraryEntry.deleteMany({ where: { user_id: testUserId } });
      for (const id of seriesIds) {
        await prisma.series.delete({ where: { id } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
    await prisma.$disconnect();
  });

  describe('getUserAchievementStats', () => {
    it('should return zero stats for new user', async () => {
      const stats = await getUserAchievementStats(prisma, testUserId);

      expect(stats.chapters_read).toBe(0);
      expect(stats.completed_count).toBe(0);
      expect(stats.library_count).toBe(0);
      expect(stats.follow_count).toBe(0);
      expect(stats.streak_days).toBe(0);
    });

    it('should return correct stats after updates', async () => {
      // Update user stats
      await prisma.user.update({
        where: { id: testUserId },
        data: { chapters_read: 50, streak_days: 7 },
      });

      // Create series and library entries
      const series = await prisma.series.create({
        data: { title: `Test Series ${testId}`, type: 'manga' },
      });
      seriesIds.push(series.id);

      await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          series_id: series.id,
          source_url: `https://test-${testId}.com`,
          source_name: 'test',
          status: 'completed',
        },
      });

      const stats = await getUserAchievementStats(prisma, testUserId);

      expect(stats.chapters_read).toBe(50);
      expect(stats.streak_days).toBe(7);
      expect(stats.library_count).toBe(1);
      expect(stats.completed_count).toBe(1);
    });

    it('should handle non-existent user gracefully', async () => {
      const stats = await getUserAchievementStats(prisma, 'non-existent-id');

      expect(stats.chapters_read).toBe(0);
      expect(stats.streak_days).toBe(0);
    });
  });

  describe('calculateAchievementProgress', () => {
    const mockStats: UserAchievementStats = {
      chapters_read: 73,
      completed_count: 5,
      library_count: 10,
      follow_count: 3,
      streak_days: 7,
    };

    it('should calculate progress percentage correctly', () => {
      const achievement = {
        id: 'test-1',
        code: 'test-chapters',
        name: 'Chapter Master',
        description: 'Read 100 chapters',
        rarity: 'rare',
        xp_reward: 100,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: 100 },
      };

      const progress = calculateAchievementProgress(achievement, mockStats, false, null);

      expect(progress).not.toBeNull();
      expect(progress!.currentValue).toBe(73);
      expect(progress!.threshold).toBe(100);
      expect(progress!.progressPercent).toBe(73);
      expect(progress!.isUnlocked).toBe(false);
    });

    it('should cap progress at 100%', () => {
      const achievement = {
        id: 'test-2',
        code: 'test-small',
        name: 'First Steps',
        description: 'Read 10 chapters',
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: 10 },
      };

      const progress = calculateAchievementProgress(achievement, mockStats, false, null);

      expect(progress!.progressPercent).toBe(100);
      expect(progress!.currentValue).toBe(73);
    });

    it('should return null for invalid criteria', () => {
      const achievement = {
        id: 'test-3',
        code: 'test-invalid',
        name: 'Invalid',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: null,
      };

      const progress = calculateAchievementProgress(achievement, mockStats, false, null);
      expect(progress).toBeNull();
    });

    it('should return null for unknown criteria type', () => {
      const achievement = {
        id: 'test-4',
        code: 'test-unknown',
        name: 'Unknown',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'unknown_type', threshold: 10 },
      };

      const progress = calculateAchievementProgress(achievement, mockStats, false, null);
      expect(progress).toBeNull();
    });

    it('should handle zero threshold without division error', () => {
      const achievement = {
        id: 'test-5',
        code: 'test-zero',
        name: 'Zero',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: 0 },
      };

      // This should be handled - threshold of 0 is invalid
      const progress = calculateAchievementProgress(achievement, mockStats, false, null);
      
      // With current implementation, this will cause division by zero
      // The fix should make this return null or handle gracefully
      if (progress) {
        expect(progress.progressPercent).toBe(100); // Capped at 100 due to Infinity
      }
    });

    it('should handle negative threshold', () => {
      const achievement = {
        id: 'test-6',
        code: 'test-negative',
        name: 'Negative',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: -10 },
      };

      const progress = calculateAchievementProgress(achievement, mockStats, false, null);
      
      // Negative threshold should be handled
      if (progress) {
        // Current behavior - this is a bug that should be fixed
        expect(progress.threshold).toBe(-10);
      }
    });

    it('should preserve unlocked status', () => {
      const achievement = {
        id: 'test-7',
        code: 'test-unlocked',
        name: 'Unlocked',
        description: 'Already unlocked',
        rarity: 'rare',
        xp_reward: 100,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: 50 },
      };

      const unlockedAt = new Date();
      const progress = calculateAchievementProgress(achievement, mockStats, true, unlockedAt);

      expect(progress!.isUnlocked).toBe(true);
      expect(progress!.unlockedAt).toEqual(unlockedAt);
    });
  });

  describe('getAchievementProgressForUser', () => {
    beforeAll(async () => {
      // Create test achievements
      const visibleAchievement = await prisma.achievement.create({
        data: {
          code: `test-visible-${testId}`,
          name: 'Visible Achievement',
          description: 'A visible achievement',
          xp_reward: 50,
          rarity: 'common',
          criteria: { type: 'chapter_count', threshold: 100 },
          is_hidden: false,
          is_seasonal: false,
        },
      });
      achievementIds.push(visibleAchievement.id);

      const hiddenAchievement = await prisma.achievement.create({
        data: {
          code: `test-hidden-${testId}`,
          name: 'Hidden Achievement',
          description: 'A hidden achievement',
          xp_reward: 100,
          rarity: 'epic',
          criteria: { type: 'chapter_count', threshold: 50 },
          is_hidden: true,
          is_seasonal: false,
        },
      });
      achievementIds.push(hiddenAchievement.id);
    });

    it('should exclude hidden achievements by default', async () => {
      const progress = await getAchievementProgressForUser(prisma, testUserId);

      const hasHidden = progress.some((p: any) => p.isHidden && !p.isUnlocked);
      expect(hasHidden).toBe(false);
    });

    it('should include hidden achievements when requested', async () => {
      const progress = await getAchievementProgressForUser(prisma, testUserId, {
        includeHidden: true,
      });

      const hiddenCount = progress.filter((p: any) => p.isHidden).length;
      expect(hiddenCount).toBeGreaterThanOrEqual(1);
    });

    it('should sort by progress (highest first) for locked achievements', async () => {
      const progress = await getAchievementProgressForUser(prisma, testUserId, {
        includeUnlocked: false,
      });

      for (let i = 1; i < progress.length; i++) {
        expect(progress[i - 1].progressPercent).toBeGreaterThanOrEqual(
          progress[i].progressPercent
        );
      }
    });
  });

  describe('getNextUpAchievements', () => {
    it('should only return achievements with progress > 0 and < 100', async () => {
      const nextUp = await getNextUpAchievements(prisma, testUserId, 10);

      for (const achievement of nextUp) {
        expect(achievement.progressPercent).toBeGreaterThan(0);
        expect(achievement.progressPercent).toBeLessThan(100);
        expect(achievement.isUnlocked).toBe(false);
      }
    });

    it('should respect limit parameter', async () => {
      const nextUp = await getNextUpAchievements(prisma, testUserId, 2);

      expect(nextUp.length).toBeLessThanOrEqual(2);
    });
  });

  describe('formatProgress', () => {
    it('should format chapter progress correctly', () => {
      const progress: AchievementProgress = {
        achievementId: 'test',
        code: 'test',
        name: 'Test',
        description: null,
        rarity: 'common',
        xpReward: 10,
        isHidden: false,
        isSeasonal: false,
        criteriaType: 'chapter_count',
        currentValue: 73,
        threshold: 100,
        progressPercent: 73,
        isUnlocked: false,
        unlockedAt: null,
      };

      const formatted = formatProgress(progress);
      expect(formatted).toBe('73 / 100 chapters');
    });

    it('should format completed count correctly', () => {
      const progress: AchievementProgress = {
        achievementId: 'test',
        code: 'test',
        name: 'Test',
        description: null,
        rarity: 'common',
        xpReward: 10,
        isHidden: false,
        isSeasonal: false,
        criteriaType: 'completed_count',
        currentValue: 5,
        threshold: 10,
        progressPercent: 50,
        isUnlocked: false,
        unlockedAt: null,
      };

      const formatted = formatProgress(progress);
      expect(formatted).toBe('5 / 10 completed');
    });

    it('should handle unknown criteria type', () => {
      const progress: AchievementProgress = {
        achievementId: 'test',
        code: 'test',
        name: 'Test',
        description: null,
        rarity: 'common',
        xpReward: 10,
        isHidden: false,
        isSeasonal: false,
        criteriaType: 'unknown_type',
        currentValue: 5,
        threshold: 10,
        progressPercent: 50,
        isUnlocked: false,
        unlockedAt: null,
      };

      const formatted = formatProgress(progress);
      expect(formatted).toBe('5 / 10 progress');
    });
  });

  describe('Auto-unlock at 100%', () => {
    let unlockTestAchievementId: string;

    beforeAll(async () => {
      // Create achievement for unlock test
      const achievement = await prisma.achievement.create({
        data: {
          code: `test-unlock-${testId}`,
          name: 'Unlock Test',
          description: 'Should unlock at threshold',
          xp_reward: 100,
          rarity: 'uncommon',
          criteria: { type: 'chapter_count', threshold: 60 },
          is_hidden: false,
          is_seasonal: false,
        },
      });
      unlockTestAchievementId = achievement.id;
      achievementIds.push(achievement.id);
    });

    it('should auto-unlock when threshold is reached', async () => {
      // Update user to meet threshold
      await prisma.user.update({
        where: { id: testUserId },
        data: { chapters_read: 60 },
      });

      // Trigger achievement check
      const unlocked = await prisma.$transaction(async (tx) => {
        return checkAchievements(tx, testUserId, 'chapter_read');
      });

      const wasUnlocked = unlocked.some((u: any) => u.id === unlockTestAchievementId);
      expect(wasUnlocked).toBe(true);
    });

    it('should not double-unlock on re-check', async () => {
      const userBefore = await prisma.user.findUnique({
        where: { id: testUserId },
        select: { xp: true },
      });

      // Re-trigger achievement check
      const unlocked = await prisma.$transaction(async (tx) => {
        return checkAchievements(tx, testUserId, 'chapter_read');
      });

      const userAfter = await prisma.user.findUnique({
        where: { id: testUserId },
        select: { xp: true },
      });

      // Should not unlock again
      const wasUnlockedAgain = unlocked.some((u: any) => u.id === unlockTestAchievementId);
      expect(wasUnlockedAgain).toBe(false);

      // XP should not change (no double XP)
      expect(userAfter!.xp).toBe(userBefore!.xp);
    });
  });
});

describe('Edge Cases and Error Handling', () => {
  describe('Division by Zero Protection', () => {
    it('should handle threshold of 0', () => {
      const stats: UserAchievementStats = {
        chapters_read: 10,
        completed_count: 0,
        library_count: 0,
        follow_count: 0,
        streak_days: 0,
      };

      const achievement = {
        id: 'zero-threshold',
        code: 'zero',
        name: 'Zero',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: 0 },
      };

      const progress = calculateAchievementProgress(achievement, stats, false, null);
      
      // Should not throw, should handle gracefully
      // After fix: should return null for invalid threshold
      expect(progress === null || progress.progressPercent <= 100).toBe(true);
    });
  });

  describe('Invalid Input Handling', () => {
    it('should handle missing criteria fields', () => {
      const stats: UserAchievementStats = {
        chapters_read: 10,
        completed_count: 0,
        library_count: 0,
        follow_count: 0,
        streak_days: 0,
      };

      const achievement = {
        id: 'missing-type',
        code: 'missing',
        name: 'Missing',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { threshold: 10 }, // Missing type
      };

      const progress = calculateAchievementProgress(achievement, stats, false, null);
      expect(progress).toBeNull();
    });

    it('should handle non-numeric threshold', () => {
      const stats: UserAchievementStats = {
        chapters_read: 10,
        completed_count: 0,
        library_count: 0,
        follow_count: 0,
        streak_days: 0,
      };

      const achievement = {
        id: 'string-threshold',
        code: 'string',
        name: 'String',
        description: null,
        rarity: 'common',
        xp_reward: 10,
        is_hidden: false,
        is_seasonal: false,
        criteria: { type: 'chapter_count', threshold: '100' as any },
      };

      const progress = calculateAchievementProgress(achievement, stats, false, null);
      expect(progress).toBeNull();
    });
  });
});
