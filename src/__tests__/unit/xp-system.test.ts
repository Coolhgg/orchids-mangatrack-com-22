import {
  XP_PER_CHAPTER,
  XP_SERIES_COMPLETED,
  XP_DAILY_STREAK_BONUS,
  MAX_XP,
  SAFE_XP_MULTIPLIER_MAX,
  calculateLevel,
  xpForLevel,
  calculateLevelProgress,
  addXp,
  multiplyXp,
  isValidXp,
  clampXp,
} from '@/lib/gamification/xp';

describe('XP System', () => {
  describe('Constants', () => {
    it('should have XP_PER_CHAPTER equal to 1', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });

    it('should have reasonable MAX_XP value', () => {
      expect(MAX_XP).toBe(999_999_999);
      expect(MAX_XP).toBeLessThan(Number.MAX_SAFE_INTEGER);
    });
  });

  describe('calculateLevel', () => {
    it('should return level 1 for 0 XP', () => {
      expect(calculateLevel(0)).toBe(1);
    });

    it('should return level 1 for XP below 100', () => {
      expect(calculateLevel(99)).toBe(1);
    });

    it('should return level 2 for 100 XP', () => {
      expect(calculateLevel(100)).toBe(2);
    });

    it('should return level 3 for 400 XP', () => {
      expect(calculateLevel(400)).toBe(3);
    });

    it('should handle negative XP safely', () => {
      expect(calculateLevel(-100)).toBe(1);
    });

    it('should handle XP at MAX_XP', () => {
      const level = calculateLevel(MAX_XP);
      expect(level).toBeGreaterThan(1);
      expect(Number.isFinite(level)).toBe(true);
    });

    it('should handle XP exceeding MAX_XP', () => {
      const level = calculateLevel(MAX_XP + 1000000);
      expect(Number.isFinite(level)).toBe(true);
    });
  });

  describe('xpForLevel', () => {
    it('should return 0 for level 1', () => {
      expect(xpForLevel(1)).toBe(0);
    });

    it('should return 0 for level 0 or negative', () => {
      expect(xpForLevel(0)).toBe(0);
      expect(xpForLevel(-1)).toBe(0);
    });

    it('should return 100 for level 2', () => {
      expect(xpForLevel(2)).toBe(100);
    });

    it('should return 400 for level 3', () => {
      expect(xpForLevel(3)).toBe(400);
    });

    it('should handle very high levels without overflow', () => {
      const xp = xpForLevel(10000);
      expect(Number.isFinite(xp)).toBe(true);
    });

    it('should cap level to prevent overflow', () => {
      const xp = xpForLevel(1000000);
      expect(Number.isFinite(xp)).toBe(true);
    });
  });

  describe('calculateLevelProgress', () => {
    it('should return 0 at start of level', () => {
      expect(calculateLevelProgress(0)).toBe(0);
      expect(calculateLevelProgress(100)).toBe(0);
    });

    it('should return progress between 0 and 1', () => {
      const progress = calculateLevelProgress(50);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });

    it('should return close to 1 near level boundary', () => {
      const progress = calculateLevelProgress(99);
      expect(progress).toBeGreaterThan(0.9);
    });

    it('should handle negative XP', () => {
      expect(calculateLevelProgress(-50)).toBe(0);
    });

    it('should handle MAX_XP', () => {
      const progress = calculateLevelProgress(MAX_XP);
      expect(progress).toBeGreaterThanOrEqual(0);
      expect(progress).toBeLessThanOrEqual(1);
    });
  });

  describe('addXp', () => {
    it('should add XP correctly', () => {
      expect(addXp(100, 50)).toBe(150);
    });

    it('should not allow total below 0', () => {
      expect(addXp(50, -100)).toBe(0);
    });

    it('should cap at MAX_XP', () => {
      expect(addXp(MAX_XP, 1)).toBe(MAX_XP);
    });

    it('should handle adding to MAX_XP', () => {
      expect(addXp(MAX_XP - 10, 100)).toBe(MAX_XP);
    });

    it('should handle NaN inputs', () => {
      expect(addXp(NaN, 100)).toBe(0);
      expect(addXp(100, NaN)).toBe(100);
    });

    it('should handle Infinity inputs', () => {
      expect(addXp(Infinity, 100)).toBe(MAX_XP);
      // Infinity for xpToAdd is not finite, so it's clamped to currentXp value
      expect(addXp(100, Infinity)).toBe(100);
    });

    it('should handle negative Infinity', () => {
      expect(addXp(-Infinity, 100)).toBe(0);
      // -Infinity is not finite, so clampedAdd becomes 0, result is 100
      expect(addXp(100, -Infinity)).toBe(100);
    });
  });

  describe('multiplyXp', () => {
    it('should multiply XP correctly', () => {
      expect(multiplyXp(100, 2)).toBe(200);
    });

    it('should cap multiplier at SAFE_XP_MULTIPLIER_MAX', () => {
      const result = multiplyXp(100, 100);
      expect(result).toBe(multiplyXp(100, SAFE_XP_MULTIPLIER_MAX));
    });

    it('should handle zero multiplier', () => {
      expect(multiplyXp(100, 0)).toBe(0);
    });

    it('should handle negative multiplier', () => {
      expect(multiplyXp(100, -5)).toBe(0);
    });

    it('should cap result at MAX_XP', () => {
      expect(multiplyXp(MAX_XP, 2)).toBe(MAX_XP);
    });

    it('should handle NaN inputs', () => {
      expect(multiplyXp(NaN, 2)).toBe(0);
      expect(multiplyXp(100, NaN)).toBe(100);
    });

    it('should floor the result', () => {
      expect(multiplyXp(10, 1.5)).toBe(15);
    });
  });

  describe('isValidXp', () => {
    it('should return true for valid XP', () => {
      expect(isValidXp(0)).toBe(true);
      expect(isValidXp(100)).toBe(true);
      expect(isValidXp(MAX_XP)).toBe(true);
    });

    it('should return false for negative XP', () => {
      expect(isValidXp(-1)).toBe(false);
    });

    it('should return false for XP exceeding MAX_XP', () => {
      expect(isValidXp(MAX_XP + 1)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidXp(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isValidXp(Infinity)).toBe(false);
      expect(isValidXp(-Infinity)).toBe(false);
    });
  });

  describe('clampXp', () => {
    it('should return value if within range', () => {
      expect(clampXp(100)).toBe(100);
    });

    it('should clamp negative values to 0', () => {
      expect(clampXp(-100)).toBe(0);
    });

    it('should clamp values exceeding MAX_XP', () => {
      expect(clampXp(MAX_XP + 1000)).toBe(MAX_XP);
    });

    it('should return 0 for NaN', () => {
      expect(clampXp(NaN)).toBe(0);
    });

    it('should clamp Infinity to 0 (not finite)', () => {
      // Infinity is not finite, so clampXp returns 0
      expect(clampXp(Infinity)).toBe(0);
    });

    it('should clamp negative Infinity to 0', () => {
      expect(clampXp(-Infinity)).toBe(0);
    });
  });

  describe('Level/XP Consistency', () => {
    it('should have consistent level<->xp mapping', () => {
      for (let level = 1; level <= 50; level++) {
        const xp = xpForLevel(level);
        expect(calculateLevel(xp)).toBe(level);
      }
    });

    it('should return correct level just before level boundary', () => {
      expect(calculateLevel(99)).toBe(1);
      expect(calculateLevel(399)).toBe(2);
      expect(calculateLevel(899)).toBe(3);
    });

    it('should handle edge case at exactly level boundary', () => {
      expect(calculateLevel(100)).toBe(2);
      expect(calculateLevel(400)).toBe(3);
      expect(calculateLevel(900)).toBe(4);
    });
  });
});
