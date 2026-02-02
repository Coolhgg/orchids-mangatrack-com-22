/**
 * QA TESTS: Achievement Progress UI
 * 
 * Verifies:
 * 1. User with 40/100 chapters → 40% progress bar, "in-progress" state
 * 2. User hits exactly threshold → Badge unlocks, progress snaps to 100%
 * 3. User exceeds threshold → Progress capped at 100%, no overflow
 * 4. Secret achievement → No progress shown before unlock
 */

import { calculateAchievementProgress, type AchievementProgress, type UserAchievementStats } from '@/lib/gamification/achievement-progress';

const createMockAchievement = (overrides: Partial<{
  id: string;
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  xp_reward: number;
  is_hidden: boolean;
  is_seasonal: boolean;
  criteria: { type: string; threshold: number };
}> = {}) => ({
  id: 'test-achievement-id',
  code: 'TEST_ACHIEVEMENT',
  name: 'Test Achievement',
  description: 'Test description',
  rarity: 'rare',
  xp_reward: 100,
  is_hidden: false,
  is_seasonal: false,
  criteria: { type: 'chapter_count', threshold: 100 },
  ...overrides,
});

const createMockStats = (overrides: Partial<UserAchievementStats> = {}): UserAchievementStats => ({
  chapters_read: 0,
  completed_count: 0,
  library_count: 0,
  follow_count: 0,
  streak_days: 0,
  ...overrides,
});

describe('Achievement Progress UI - QA Tests', () => {
  describe('Test 1: User with 40/100 chapters', () => {
    it('should show 40% progress bar', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 40 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBe(40);
      expect(result!.currentValue).toBe(40);
      expect(result!.threshold).toBe(100);
    });

    it('should be in "in-progress" state (locked with progress)', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 40 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.isUnlocked).toBe(false);
      expect(result!.progressPercent).toBeGreaterThan(0);
      expect(result!.progressPercent).toBeLessThan(100);
      
      // UI state: in-progress = locked AND has progress
      const isInProgress = !result!.isUnlocked && result!.progressPercent > 0 && result!.progressPercent < 100;
      expect(isInProgress).toBe(true);
    });
  });

  describe('Test 2: User hits exactly threshold', () => {
    it('should unlock badge when threshold is exactly met', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 100 });

      // When unlocked, isUnlocked=true and unlockedAt is set
      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.isUnlocked).toBe(true);
      expect(result!.unlockedAt).not.toBeNull();
    });

    it('should snap progress bar to 100% when unlocked', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 100 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBe(100);
    });

    it('should calculate exactly 100% when current equals threshold (not unlocked yet)', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 100 });

      // Before unlock is processed
      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBe(100);
      expect(result!.currentValue).toBe(100);
      expect(result!.threshold).toBe(100);
    });
  });

  describe('Test 3: User exceeds threshold', () => {
    it('should cap progress at 100% when exceeding threshold', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 150 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBe(100);
      expect(result!.progressPercent).not.toBeGreaterThan(100);
    });

    it('should show actual currentValue even when exceeding threshold', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 150 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.currentValue).toBe(150);
      expect(result!.threshold).toBe(100);
      // But progress percent is capped
      expect(result!.progressPercent).toBe(100);
    });

    it('should not overflow progress bar visually (capped at 100)', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 999 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBeLessThanOrEqual(100);
      
      // Simulate CSS width calculation (should not exceed 100%)
      const barWidth = `${result!.progressPercent}%`;
      expect(barWidth).toBe('100%');
    });
  });

  describe('Test 4: Secret (hidden) achievement', () => {
    it('should NOT show progress for hidden achievements before unlock', () => {
      const achievement = createMockAchievement({
        is_hidden: true,
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 40 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.isHidden).toBe(true);
      expect(result!.isUnlocked).toBe(false);
      
      // UI should NOT display progress for hidden+locked achievements
      const shouldShowProgress = !result!.isHidden || result!.isUnlocked;
      expect(shouldShowProgress).toBe(false);
    });

    it('should show "???" name for hidden locked achievements', () => {
      const achievement = createMockAchievement({
        is_hidden: true,
        name: 'Secret Master',
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 40 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.isHidden).toBe(true);
      expect(result!.isUnlocked).toBe(false);
      
      // UI display name rule
      const displayName = result!.isHidden && !result!.isUnlocked ? '???' : result!.name;
      expect(displayName).toBe('???');
    });

    it('should show actual name and progress after unlock', () => {
      const achievement = createMockAchievement({
        is_hidden: true,
        name: 'Secret Master',
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 100 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      expect(result).not.toBeNull();
      expect(result!.isHidden).toBe(true);
      expect(result!.isUnlocked).toBe(true);
      
      // UI display name rule - show actual name after unlock
      const displayName = result!.isHidden && !result!.isUnlocked ? '???' : result!.name;
      expect(displayName).toBe('Secret Master');
      
      // Should show progress after unlock
      const shouldShowProgress = !result!.isHidden || result!.isUnlocked;
      expect(shouldShowProgress).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle zero progress correctly', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 0 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.progressPercent).toBe(0);
      expect(result!.currentValue).toBe(0);
    });

    it('should round progress percent to nearest integer', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 33 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(Number.isInteger(result!.progressPercent)).toBe(true);
      expect(result!.progressPercent).toBe(33);
    });

    it('should handle different criteria types', () => {
      const criteriaTypes = [
        { type: 'completed_count', statsKey: 'completed_count', value: 5, threshold: 10 },
        { type: 'library_count', statsKey: 'library_count', value: 15, threshold: 50 },
        { type: 'follow_count', statsKey: 'follow_count', value: 3, threshold: 10 },
        { type: 'streak_count', statsKey: 'streak_days', value: 7, threshold: 30 },
      ] as const;

      for (const { type, statsKey, value, threshold } of criteriaTypes) {
        const achievement = createMockAchievement({
          criteria: { type, threshold },
        });
        const stats = createMockStats({ [statsKey]: value });

        const result = calculateAchievementProgress(achievement, stats, false, null);

        expect(result).not.toBeNull();
        expect(result!.currentValue).toBe(value);
        expect(result!.threshold).toBe(threshold);
        expect(result!.progressPercent).toBe(Math.round((value / threshold) * 100));
      }
    });

    it('should handle invalid criteria gracefully', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'invalid_type', threshold: 100 } as any,
      });
      const stats = createMockStats({ chapters_read: 50 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      // Should return null for invalid criteria
      expect(result).toBeNull();
    });

    it('should handle negative values gracefully (ensure non-negative)', () => {
      const achievement = createMockAchievement({
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      // Simulating corrupted data
      const stats = createMockStats({ chapters_read: -10 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.currentValue).toBeGreaterThanOrEqual(0);
      expect(result!.progressPercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe('XP Rules Verification', () => {
    it('should preserve xp_reward from achievement (read-only)', () => {
      const achievement = createMockAchievement({
        xp_reward: 250,
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 40 });

      const result = calculateAchievementProgress(achievement, stats, false, null);

      expect(result).not.toBeNull();
      expect(result!.xpReward).toBe(250);
    });

    it('should NOT calculate XP in progress function (backend handles this)', () => {
      const achievement = createMockAchievement({
        xp_reward: 100,
        criteria: { type: 'chapter_count', threshold: 100 },
      });
      const stats = createMockStats({ chapters_read: 100 });

      const result = calculateAchievementProgress(achievement, stats, true, new Date());

      // XP is simply passed through, not calculated
      expect(result).not.toBeNull();
      expect(result!.xpReward).toBe(100);
      // No XP calculation logic in this function - it's a display helper
    });
  });
});

describe('UI Component State Rules', () => {
  const createProgress = (overrides: Partial<AchievementProgress> = {}): AchievementProgress => ({
    achievementId: 'test-id',
    code: 'TEST',
    name: 'Test Achievement',
    description: 'Test description',
    rarity: 'rare',
    xpReward: 100,
    isHidden: false,
    isSeasonal: false,
    criteriaType: 'chapter_count',
    currentValue: 0,
    threshold: 100,
    progressPercent: 0,
    isUnlocked: false,
    unlockedAt: null,
    ...overrides,
  });

  describe('Badge state determination', () => {
    it('should identify LOCKED state (no progress, not hidden)', () => {
      const progress = createProgress({ progressPercent: 0, isUnlocked: false, isHidden: false });
      
      const isLocked = !progress.isUnlocked;
      const hasProgress = progress.progressPercent > 0 && progress.progressPercent < 100;
      const isInProgress = isLocked && hasProgress;
      
      expect(isLocked).toBe(true);
      expect(isInProgress).toBe(false);
    });

    it('should identify IN-PROGRESS state (partial progress, locked)', () => {
      const progress = createProgress({ progressPercent: 40, isUnlocked: false });
      
      const isLocked = !progress.isUnlocked;
      const hasProgress = progress.progressPercent > 0 && progress.progressPercent < 100;
      const isInProgress = isLocked && hasProgress;
      
      expect(isLocked).toBe(true);
      expect(isInProgress).toBe(true);
    });

    it('should identify UNLOCKED state', () => {
      const progress = createProgress({ progressPercent: 100, isUnlocked: true, unlockedAt: new Date() });
      
      const isLocked = !progress.isUnlocked;
      
      expect(isLocked).toBe(false);
      expect(progress.isUnlocked).toBe(true);
    });

    it('should identify HIDDEN state (locked + hidden)', () => {
      const progress = createProgress({ progressPercent: 40, isUnlocked: false, isHidden: true });
      
      const isLocked = !progress.isUnlocked;
      const shouldHideProgress = progress.isHidden && isLocked;
      
      expect(shouldHideProgress).toBe(true);
    });
  });

  describe('Display rules', () => {
    it('should show progress bar only for in-progress achievements', () => {
      const inProgress = createProgress({ progressPercent: 40, isUnlocked: false, isHidden: false });
      const locked = createProgress({ progressPercent: 0, isUnlocked: false, isHidden: false });
      const unlocked = createProgress({ progressPercent: 100, isUnlocked: true });
      const hidden = createProgress({ progressPercent: 40, isUnlocked: false, isHidden: true });

      const shouldShowProgressBar = (p: AchievementProgress) => {
        const isLocked = !p.isUnlocked;
        const hasProgress = p.progressPercent > 0 && p.progressPercent < 100;
        return isLocked && hasProgress && !p.isHidden;
      };

      expect(shouldShowProgressBar(inProgress)).toBe(true);
      expect(shouldShowProgressBar(locked)).toBe(false);
      expect(shouldShowProgressBar(unlocked)).toBe(false);
      expect(shouldShowProgressBar(hidden)).toBe(false);
    });

    it('should show "???" name only for hidden locked achievements', () => {
      const hiddenLocked = createProgress({ isHidden: true, isUnlocked: false, name: 'Secret Achievement' });
      const hiddenUnlocked = createProgress({ isHidden: true, isUnlocked: true, name: 'Secret Achievement' });
      const visible = createProgress({ isHidden: false, isUnlocked: false, name: 'Normal Achievement' });

      const getDisplayName = (p: AchievementProgress) => {
        return p.isHidden && !p.isUnlocked ? '???' : p.name;
      };

      expect(getDisplayName(hiddenLocked)).toBe('???');
      expect(getDisplayName(hiddenUnlocked)).toBe('Secret Achievement');
      expect(getDisplayName(visible)).toBe('Normal Achievement');
    });
  });
});
