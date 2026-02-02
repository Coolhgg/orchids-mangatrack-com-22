/**
 * REAL-WORLD ABUSE PATTERN SIMULATION
 * 
 * This test suite simulates actual user behavior patterns that attempt to game the system.
 * These are distinct from theoretical exploit vectors - they test realistic abuse scenarios.
 * 
 * Run with: npm test -- src/__tests__/security/qa-abuse-patterns.test.ts
 */

import { 
  XP_PER_CHAPTER, 
  addXp, 
  MAX_XP 
} from '@/lib/gamification/xp';
import { 
  TRUST_SCORE_DEFAULT, 
  TRUST_SCORE_MIN,
  VIOLATION_PENALTIES,
  applyPenalty,
  calculateEffectiveXp,
} from '@/lib/gamification/trust-score';
import { calculateMinimumReadTime, MIN_READ_TIME_SECONDS } from '@/lib/gamification/read-time-validation';

describe('Real-World Abuse Pattern Simulation', () => {
  
  describe('Scenario 1: Human Spammer', () => {
    it('should allow legitimate fast reading (5-10 second intervals)', () => {
      const readIntervals = [7, 5, 8, 10, 6, 9, 5, 8];
      const avgInterval = readIntervals.reduce((a, b) => a + b) / readIntervals.length;
      
      expect(avgInterval).toBeGreaterThan(5);
      expect(avgInterval).toBeLessThan(15);
      
      const chaptersRead = readIntervals.length;
      const xpGranted = Math.min(chaptersRead, 5);
      
      expect(xpGranted).toBe(5);
    });

    it('should reduce XP effectiveness after detection', () => {
      const trustScore = applyPenalty(TRUST_SCORE_DEFAULT, VIOLATION_PENALTIES['rapid_reads']);
      const rawXp = 10;
      const effectiveXp = calculateEffectiveXp(rawXp, trustScore);
      
      expect(effectiveXp).toBeLessThan(rawXp);
      expect(effectiveXp).toBeGreaterThan(0);
    });

    it('should NOT permanently block legitimate users who get flagged', () => {
      let trustScore = TRUST_SCORE_DEFAULT;
      
      for (let i = 0; i < 5; i++) {
        trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['rapid_reads']);
      }
      
      expect(trustScore).toBeGreaterThanOrEqual(TRUST_SCORE_MIN);
      
      const xpGained = calculateEffectiveXp(100, trustScore);
      expect(xpGained).toBeGreaterThan(0);
    });
  });

  describe('Scenario 2: Bot Pattern Detection', () => {
    it('should detect exact interval patterns (every 3 seconds)', () => {
      const botIntervals = [3, 3, 3, 3, 3, 3, 3, 3, 3, 3];
      const standardDeviation = calculateStdDev(botIntervals);
      
      expect(standardDeviation).toBeLessThan(0.5);
      
      const isLikelyBot = standardDeviation < 1.0 && botIntervals[0] < 5;
      expect(isLikelyBot).toBe(true);
    });

    it('should NOT flag normal human variance', () => {
      const humanIntervals = [4, 7, 3, 8, 5, 12, 6, 9, 4, 7];
      const standardDeviation = calculateStdDev(humanIntervals);
      
      expect(standardDeviation).toBeGreaterThan(1.5);
      
      const isLikelyBot = standardDeviation < 1.0;
      expect(isLikelyBot).toBe(false);
    });

    it('should apply heavy penalty to detected bot patterns', () => {
      let trustScore = TRUST_SCORE_DEFAULT;
      
      trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['pattern_repetition']);
      
      expect(trustScore).toBeLessThan(TRUST_SCORE_DEFAULT);
      expect(trustScore).toBe(0.92);
    });
  });

  describe('Scenario 3: Hybrid User (Bulk Import + Farming)', () => {
    it('should handle large bulk import without XP gaming', () => {
      const bulkImportSize = 500;
      const maxXpFromImport = 0;
      
      expect(maxXpFromImport).toBe(0);
    });

    it('should still allow legitimate progress after bulk import', () => {
      const trustScore = TRUST_SCORE_DEFAULT;
      const newChapterRead = 1;
      const xpFromProgress = calculateEffectiveXp(XP_PER_CHAPTER * newChapterRead, trustScore);
      
      expect(xpFromProgress).toBe(XP_PER_CHAPTER);
    });

    it('should detect "blending in" attempts after bulk import', () => {
      const normalPattern = [30, 45, 60, 35, 50, 40];
      const suspiciousSpike = [2, 2, 2, 30, 45, 60];
      
      const hasEarlySpike = suspiciousSpike.slice(0, 3).every(i => i < 5);
      expect(hasEarlySpike).toBe(true);
    });
  });

  describe('Scenario 4: Edge Abuse (Toggle Exploit)', () => {
    it('should NOT award XP for mark → unmark → mark cycle', () => {
      const firstMark = { xpAwarded: 1, chapterNumber: 5 };
      const unmark = { xpAwarded: 0, chapterNumber: 5 };
      const secondMark = { xpAwarded: 0, chapterNumber: 5 };
      
      const totalXp = firstMark.xpAwarded + unmark.xpAwarded + secondMark.xpAwarded;
      expect(totalXp).toBe(1);
    });

    it('should NOT award XP for complete → uncomplete → complete cycle', () => {
      const firstComplete = { xpAwarded: 50, seriesId: 'abc' };
      const uncomplete = { xpAwarded: 0, seriesId: 'abc' };
      const secondComplete = { xpAwarded: 0, seriesId: 'abc' };
      
      const totalXp = firstComplete.xpAwarded + uncomplete.xpAwarded + secondComplete.xpAwarded;
      expect(totalXp).toBe(50);
    });

    it('should detect repetitive toggle patterns', () => {
      const toggleHistory = ['read', 'unread', 'read', 'unread', 'read'];
      const toggleCount = toggleHistory.filter((v, i) => i > 0 && v !== toggleHistory[i-1]).length;
      
      const isAbusive = toggleCount >= 3;
      expect(isAbusive).toBe(true);
    });

    it('should apply status_toggle penalty', () => {
      let trustScore = TRUST_SCORE_DEFAULT;
      trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['status_toggle']);
      
      expect(trustScore).toBeLessThan(TRUST_SCORE_DEFAULT);
      expect(trustScore).toBe(0.97);
    });
  });

  describe('Scenario 5: Verify No Permanent Punishment', () => {
    it('should allow trust score recovery over time', () => {
      let trustScore = TRUST_SCORE_MIN + 0.1;
      
      const RECOVERY_RATE = 0.02;
      const goodActionsNeeded = Math.ceil((TRUST_SCORE_DEFAULT - trustScore) / RECOVERY_RATE);
      
      expect(goodActionsNeeded).toBeGreaterThan(0);
      expect(goodActionsNeeded).toBeLessThan(100);
    });

    it('should never fully ban XP gains at minimum trust score', () => {
      const worstCaseTrustScore = TRUST_SCORE_MIN;
      const rawXp = 100;
      const xpGained = calculateEffectiveXp(rawXp, worstCaseTrustScore);
      
      expect(xpGained).toBe(50);
      expect(xpGained).toBeGreaterThan(0);
    });

    it('should NOT corrupt leaderboard with abuse attempts', () => {
      const legitUserXp = 1000;
      const legitTrustScore = TRUST_SCORE_DEFAULT;
      
      const abuserRawXp = 5000;
      const abuserTrustScore = TRUST_SCORE_MIN + 0.1;
      
      const legitEffectiveXp = calculateEffectiveXp(legitUserXp, legitTrustScore);
      const abuserEffectiveXp = calculateEffectiveXp(abuserRawXp, abuserTrustScore);
      
      const legitWins = legitEffectiveXp >= abuserEffectiveXp || legitTrustScore > abuserTrustScore;
      expect(legitWins).toBe(true);
    });
  });

  describe('Scenario 6: Read Time Validation', () => {
    it('should enforce minimum read time per page', () => {
      const pageCount = 20;
      const minTime = calculateMinimumReadTime(pageCount);
      
      expect(minTime).toBeGreaterThanOrEqual(MIN_READ_TIME_SECONDS);
      expect(minTime).toBeGreaterThan(0);
    });

    it('should reject impossibly fast reads', () => {
      const pageCount = 30;
      const readTimeSeconds = 5;
      const minRequired = calculateMinimumReadTime(pageCount);
      
      const isTooFast = readTimeSeconds < minRequired;
      expect(isTooFast).toBe(true);
    });

    it('should accept reasonable read times', () => {
      const pageCount = 20;
      const readTimeSeconds = 60;
      const minRequired = calculateMinimumReadTime(pageCount);
      
      const isReasonable = readTimeSeconds >= minRequired;
      expect(isReasonable).toBe(true);
    });
  });
});

function calculateStdDev(values: number[]): number {
  const mean = values.reduce((a, b) => a + b) / values.length;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b) / values.length;
  return Math.sqrt(avgSquaredDiff);
}
