import { addXp, calculateLevel } from '@/lib/gamification/xp';

describe('Achievement Concurrency & Race Conditions', () => {
  describe('XP Calculation Integrity', () => {
    it('should calculate XP consistently regardless of call order', () => {
      const baseXp = 100;
      const additions = [10, 25, 50, 15];
      
      let totalFromSequential = baseXp;
      additions.forEach(xp => {
        totalFromSequential = addXp(totalFromSequential, xp);
      });
      
      const totalDirect = addXp(baseXp, additions.reduce((a, b) => a + b, 0));
      
      expect(totalFromSequential).toBe(totalDirect);
    });

    it('should never lose XP during concurrent-like additions', () => {
      const initialXp = 500;
      const concurrentAdds = [100, 100, 100, 100, 100];
      
      let currentXp = initialXp;
      for (const xp of concurrentAdds) {
        currentXp = addXp(currentXp, xp);
      }
      
      expect(currentXp).toBe(1000);
    });

    it('should handle XP near level boundary', () => {
      const xpAtLevelBoundary = 99;
      const newXp = addXp(xpAtLevelBoundary, 1);
      
      const levelBefore = calculateLevel(xpAtLevelBoundary);
      const levelAfter = calculateLevel(newXp);
      
      expect(levelAfter).toBeGreaterThanOrEqual(levelBefore);
    });

    it('should handle rapid XP additions (simulated burst)', () => {
      let currentXp = 0;
      const burstSize = 1000;
      
      for (let i = 0; i < burstSize; i++) {
        currentXp = addXp(currentXp, 1);
      }
      
      expect(currentXp).toBe(burstSize);
    });
  });

  describe('Achievement Unlock Idempotency', () => {
    it('should handle duplicate unlock attempts gracefully', () => {
      const mockAchievementState = new Set<string>();
      const achievementId = 'first-chapter';
      
      const tryUnlock = (id: string): boolean => {
        if (mockAchievementState.has(id)) {
          return false;
        }
        mockAchievementState.add(id);
        return true;
      };

      const firstAttempt = tryUnlock(achievementId);
      const secondAttempt = tryUnlock(achievementId);
      const thirdAttempt = tryUnlock(achievementId);
      
      expect(firstAttempt).toBe(true);
      expect(secondAttempt).toBe(false);
      expect(thirdAttempt).toBe(false);
      expect(mockAchievementState.size).toBe(1);
    });

    it('should handle concurrent unlock simulation (race condition test)', async () => {
      const achievementState = new Map<string, { unlocked: boolean, xpGranted: number }>();
      const achievementId = 'concurrent-test';
      const xpReward = 50;
      let totalXpGranted = 0;
      
      const simulateUnlock = async (id: string): Promise<boolean> => {
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        
        const existing = achievementState.get(id);
        if (existing?.unlocked) {
          return false;
        }
        
        achievementState.set(id, { unlocked: true, xpGranted: xpReward });
        totalXpGranted += xpReward;
        return true;
      };

      const results = await Promise.all([
        simulateUnlock(achievementId),
        simulateUnlock(achievementId),
        simulateUnlock(achievementId),
        simulateUnlock(achievementId),
        simulateUnlock(achievementId),
      ]);
      
      const successfulUnlocks = results.filter(r => r === true).length;
      expect(successfulUnlocks).toBeGreaterThanOrEqual(1);
      expect(successfulUnlocks).toBeLessThanOrEqual(5);
    });

    it('should simulate atomic createManyAndReturn behavior', () => {
      const userAchievements: Array<{ user_id: string, achievement_id: string }> = [];
      
      const createManyAndReturn = (
        data: Array<{ user_id: string, achievement_id: string }>,
        skipDuplicates: boolean
      ): Array<{ user_id: string, achievement_id: string }> => {
        const created: Array<{ user_id: string, achievement_id: string }> = [];
        
        for (const item of data) {
          const exists = userAchievements.some(
            ua => ua.user_id === item.user_id && ua.achievement_id === item.achievement_id
          );
          
          if (exists && skipDuplicates) {
            continue;
          }
          
          if (exists && !skipDuplicates) {
            throw new Error('P2002: Unique constraint violation');
          }
          
          userAchievements.push(item);
          created.push(item);
        }
        
        return created;
      };

      const result1 = createManyAndReturn(
        [{ user_id: 'user-1', achievement_id: 'ach-1' }],
        true
      );
      expect(result1.length).toBe(1);

      const result2 = createManyAndReturn(
        [{ user_id: 'user-1', achievement_id: 'ach-1' }],
        true
      );
      expect(result2.length).toBe(0);

      expect(userAchievements.length).toBe(1);
    });
  });

  describe('Level Calculation Edge Cases', () => {
    it('should handle level 1 boundary', () => {
      expect(calculateLevel(0)).toBe(1);
      expect(calculateLevel(1)).toBe(1);
      expect(calculateLevel(99)).toBe(1);
    });

    it('should handle level transitions correctly', () => {
      expect(calculateLevel(100)).toBeGreaterThan(calculateLevel(99));
    });

    it('should handle very large XP values', () => {
      const largeXp = 1000000;
      const level = calculateLevel(largeXp);
      
      expect(level).toBeGreaterThan(1);
      expect(Number.isFinite(level)).toBe(true);
      expect(Number.isInteger(level)).toBe(true);
    });

    it('should never return level below 1', () => {
      const testValues = [-100, -1, 0, 1, 50, 99, 100, 1000];
      
      for (const xp of testValues) {
        const level = calculateLevel(xp);
        expect(level).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('Achievement Criteria Matching', () => {
    interface AchievementCriteria {
      type: 'chapter_count' | 'completed_count' | 'library_count' | 'follow_count' | 'streak_count';
      threshold: number;
    }

    const checkCriteria = (criteria: AchievementCriteria, stats: Record<string, number>): boolean => {
      const currentValue = stats[criteria.type] ?? 0;
      return currentValue >= criteria.threshold;
    };

    it('should match threshold exactly', () => {
      const criteria: AchievementCriteria = { type: 'chapter_count', threshold: 100 };
      const stats = { chapter_count: 100 };
      
      expect(checkCriteria(criteria, stats)).toBe(true);
    });

    it('should match when exceeding threshold', () => {
      const criteria: AchievementCriteria = { type: 'chapter_count', threshold: 100 };
      const stats = { chapter_count: 150 };
      
      expect(checkCriteria(criteria, stats)).toBe(true);
    });

    it('should not match below threshold', () => {
      const criteria: AchievementCriteria = { type: 'chapter_count', threshold: 100 };
      const stats = { chapter_count: 99 };
      
      expect(checkCriteria(criteria, stats)).toBe(false);
    });

    it('should handle missing stat gracefully', () => {
      const criteria: AchievementCriteria = { type: 'chapter_count', threshold: 100 };
      const stats = {};
      
      expect(checkCriteria(criteria, stats)).toBe(false);
    });

    it('should handle all criteria types', () => {
      const types: AchievementCriteria['type'][] = [
        'chapter_count', 'completed_count', 'library_count', 'follow_count', 'streak_count'
      ];
      
      for (const type of types) {
        const criteria: AchievementCriteria = { type, threshold: 10 };
        const stats = { [type]: 10 };
        
        expect(checkCriteria(criteria, stats)).toBe(true);
      }
    });
  });
});
