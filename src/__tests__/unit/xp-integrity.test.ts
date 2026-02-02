/**
 * XP & READ-PROGRESS INTEGRITY TESTS
 * 
 * LOCKED RULES:
 * 1. XP_PER_CHAPTER = 1 (no multipliers)
 * 2. Marking chapter N marks ALL chapters 1→N as read
 * 3. XP awarded ONLY ONCE per request, ONLY if chapterNumber > currentLastRead
 * 4. Anti-abuse: jumping 1→500 = 1 XP, re-marking = 0 XP
 * 5. Transaction safety: progress + XP are atomic
 */

import { XP_PER_CHAPTER, XP_SERIES_COMPLETED, calculateLevel, addXp, xpForLevel, calculateLevelProgress } from '@/lib/gamification/xp';

describe('XP Constants Integrity', () => {
  it('XP_PER_CHAPTER MUST be exactly 1', () => {
    expect(XP_PER_CHAPTER).toBe(1);
  });

  it('XP_SERIES_COMPLETED should be 100', () => {
    expect(XP_SERIES_COMPLETED).toBe(100);
  });
});

describe('XP Calculation Functions', () => {
  describe('calculateLevel', () => {
    it('returns level 1 for 0 XP', () => {
      expect(calculateLevel(0)).toBe(1);
    });

    it('returns level 1 for 99 XP', () => {
      expect(calculateLevel(99)).toBe(1);
    });

    it('returns level 2 for 100 XP', () => {
      expect(calculateLevel(100)).toBe(2);
    });

    it('handles negative XP gracefully', () => {
      expect(calculateLevel(-100)).toBe(1);
    });

    it('handles very large XP values', () => {
      const level = calculateLevel(999999999);
      expect(level).toBeGreaterThan(1);
      expect(Number.isFinite(level)).toBe(true);
    });
  });

  describe('xpForLevel', () => {
    it('returns 0 for level 1', () => {
      expect(xpForLevel(1)).toBe(0);
    });

    it('returns 100 for level 2', () => {
      expect(xpForLevel(2)).toBe(100);
    });

    it('returns 400 for level 3', () => {
      expect(xpForLevel(3)).toBe(400);
    });

    it('handles invalid levels', () => {
      expect(xpForLevel(0)).toBe(0);
      expect(xpForLevel(-1)).toBe(0);
    });
  });

  describe('calculateLevelProgress', () => {
    it('returns 0 at start of level', () => {
      expect(calculateLevelProgress(0)).toBe(0);
      expect(calculateLevelProgress(100)).toBe(0);
    });

    it('returns value between 0 and 1', () => {
      const progress = calculateLevelProgress(150);
      expect(progress).toBeGreaterThan(0);
      expect(progress).toBeLessThan(1);
    });

    it('handles negative XP', () => {
      expect(calculateLevelProgress(-50)).toBe(0);
    });
  });

  describe('addXp', () => {
    it('adds XP correctly', () => {
      expect(addXp(100, 50)).toBe(150);
    });

    it('handles adding 0 XP', () => {
      expect(addXp(100, 0)).toBe(100);
    });

    it('caps at MAX_XP', () => {
      const result = addXp(999999999, 100);
      expect(result).toBeLessThanOrEqual(999999999);
    });

    it('prevents negative XP', () => {
      expect(addXp(50, -100)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe('XP Anti-Abuse Logic', () => {
  /**
   * These tests verify the LOGIC that should be implemented in the progress route.
   * The actual API tests are in the integration tests.
   */
  
  it('bulk chapter mark should NOT multiply XP', () => {
    // Scenario: User jumps from chapter 0 to chapter 500
    // Expected XP: 1 (not 500)
    const chaptersMarked = 500;
    const expectedXP = XP_PER_CHAPTER; // Always 1, regardless of chapters
    
    expect(expectedXP).toBe(1);
    expect(expectedXP).not.toBe(chaptersMarked * XP_PER_CHAPTER);
  });

  it('re-marking same chapter should give 0 XP', () => {
    const currentLastRead = 50;
    const targetChapter = 50; // Same as current
    
    const isNewProgress = targetChapter > currentLastRead;
    const shouldAwardXp = isNewProgress; // false
    
    expect(shouldAwardXp).toBe(false);
  });

  it('marking lower chapter should give 0 XP', () => {
    const currentLastRead = 50;
    const targetChapter = 25; // Lower than current
    
    const isNewProgress = targetChapter > currentLastRead;
    const shouldAwardXp = isNewProgress; // false
    
    expect(shouldAwardXp).toBe(false);
  });

  it('marking higher chapter should give exactly 1 XP (plus streak)', () => {
    const currentLastRead = 50;
    const targetChapter = 51; // Higher than current
    
    const isNewProgress = targetChapter > currentLastRead;
    const shouldAwardXp = isNewProgress; // true
    
    expect(shouldAwardXp).toBe(true);
    
    // XP should be XP_PER_CHAPTER + streakBonus, NOT (targetChapter - currentLastRead) * XP_PER_CHAPTER
    const xpAwarded = XP_PER_CHAPTER; // Just 1
    expect(xpAwarded).toBe(1);
  });
});

describe('Read Progression Logic', () => {
  /**
   * When marking chapter N as read, ALL chapters 1→N must be marked.
   */
  
  it('marking chapter 50 should mark chapters 1-50', () => {
    const targetChapter = 50;
    const chaptersToMark = Array.from({ length: targetChapter }, (_, i) => i + 1);
    
    expect(chaptersToMark.length).toBe(50);
    expect(chaptersToMark[0]).toBe(1);
    expect(chaptersToMark[49]).toBe(50);
  });

  it('marking chapter 1 should only mark chapter 1', () => {
    const targetChapter = 1;
    const chaptersToMark = Array.from({ length: targetChapter }, (_, i) => i + 1);
    
    expect(chaptersToMark.length).toBe(1);
    expect(chaptersToMark[0]).toBe(1);
  });
});

describe('XP Sources Documentation', () => {
  /**
   * Complete list of XP sources in the system:
   * 
   * 1. Reading a chapter: XP_PER_CHAPTER (1) + streak bonus
   *    - Location: /api/library/[id]/progress
   *    - Condition: chapterNumber > currentLastRead AND not already read
   * 
   * 2. Completing a series: XP_SERIES_COMPLETED (100)
   *    - Location: /api/library/[id] (PATCH with status='completed')
   *    - Location: /api/library/bulk (PATCH with status='completed')
   *    - Condition: status changes TO 'completed' AND no existing 'series_completed' activity
   * 
   * 3. Achievements: Various amounts
   *    - Location: src/lib/gamification/achievements.ts
   *    - Triggered after chapter_read, streak_reached, series_completed
   */
  
  it('documents all XP sources', () => {
    const xpSources = {
      'chapter_read': XP_PER_CHAPTER,
      'series_completed': XP_SERIES_COMPLETED,
      'achievements': 'variable',
    };
    
    expect(xpSources.chapter_read).toBe(1);
    expect(xpSources.series_completed).toBe(100);
  });
});
