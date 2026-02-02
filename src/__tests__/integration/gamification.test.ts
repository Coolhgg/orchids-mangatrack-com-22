import { calculateLevel, xpForLevel, calculateLevelProgress, addXp, MAX_XP } from '@/lib/gamification/xp';

describe('Gamification (XP) Logic', () => {
  describe('calculateLevel', () => {
    it('should return level 1 for 0 XP', () => {
      expect(calculateLevel(0)).toBe(1);
    });

    it('should return level 2 for 100 XP', () => {
      expect(calculateLevel(100)).toBe(2);
    });

    it('should return level 3 for 400 XP', () => {
      expect(calculateLevel(400)).toBe(3);
    });

    it('should handle large XP values safely', () => {
      expect(calculateLevel(MAX_XP)).toBeLessThan(100000);
    });

    it('should handle negative XP by treating it as 0', () => {
      expect(calculateLevel(-100)).toBe(1);
    });
  });

  describe('xpForLevel', () => {
    it('should return 0 for level 1', () => {
      expect(xpForLevel(1)).toBe(0);
    });

    it('should return 100 for level 2', () => {
      expect(xpForLevel(2)).toBe(100);
    });

    it('should return 400 for level 3', () => {
      expect(xpForLevel(3)).toBe(400);
    });
  });

  describe('calculateLevelProgress', () => {
    it('should return 0.5 for 50 XP (Level 1)', () => {
      // Level 1 is 0-99. Progress from 0 to 100.
      expect(calculateLevelProgress(50)).toBe(0.5);
    });

    it('should return 0 for exactly 100 XP (Level 2 start)', () => {
      expect(calculateLevelProgress(100)).toBe(0);
    });

    it('should return 0.5 for 250 XP (Level 2 progress)', () => {
      // Level 2 is 100-399. Progress from 100 to 400.
      // (250-100)/(400-100) = 150/300 = 0.5
      expect(calculateLevelProgress(250)).toBe(0.5);
    });
  });

  describe('addXp', () => {
    it('should add XP correctly', () => {
      expect(addXp(100, 50)).toBe(150);
    });

    it('should cap XP at MAX_XP', () => {
      expect(addXp(MAX_XP, 10)).toBe(MAX_XP);
    });

    it('should not allow negative XP', () => {
      expect(addXp(10, -20)).toBe(0);
    });
  });
});
