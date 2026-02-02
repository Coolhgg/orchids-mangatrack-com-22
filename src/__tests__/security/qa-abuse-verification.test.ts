/**
 * ABUSE SIMULATION VERIFICATION TEST
 * 
 * Verifies the expected behavior under abuse simulation:
 * - Abuse detected softly (trust_score affected, not XP)
 * - XP still granted but normalized for leaderboard
 * - trust_score decreases temporarily
 * - No permanent bans
 * 
 * Run: npm test -- src/__tests__/security/qa-abuse-verification.test.ts
 */

import { 
  TRUST_SCORE_DEFAULT, 
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  VIOLATION_PENALTIES,
  applyPenalty,
  applyDecay,
  calculateEffectiveXp,
  daysUntilFullRecovery,
  DECAY_PER_DAY,
} from '@/lib/gamification/trust-score';

import { 
  calculateMinimumReadTime, 
  MIN_READ_TIME_SECONDS,
  SECONDS_PER_PAGE,
} from '@/lib/gamification/read-time-validation';

import { XP_PER_CHAPTER } from '@/lib/gamification/xp';

describe('Abuse Simulation Verification', () => {
  
  describe('RULE 1: Abuse detected SOFTLY', () => {
    it('trust_score penalties are proportional to violation severity', () => {
      expect(VIOLATION_PENALTIES['speed_read']).toBe(0.02);
      expect(VIOLATION_PENALTIES['rapid_reads']).toBe(0.05);
      expect(VIOLATION_PENALTIES['pattern_repetition']).toBe(0.08);
      expect(VIOLATION_PENALTIES['api_spam']).toBe(0.10);
    });

    it('single violation does not cause drastic trust_score drop', () => {
      const afterRapidRead = applyPenalty(TRUST_SCORE_DEFAULT, VIOLATION_PENALTIES['rapid_reads']);
      expect(afterRapidRead).toBe(0.95);
      expect(afterRapidRead).toBeGreaterThan(0.9);
    });

    it('multiple violations still keep trust_score above minimum', () => {
      let score = TRUST_SCORE_DEFAULT;
      
      for (let i = 0; i < 10; i++) {
        score = applyPenalty(score, VIOLATION_PENALTIES['rapid_reads']);
      }
      
      expect(score).toBeGreaterThanOrEqual(TRUST_SCORE_MIN);
      expect(score).toBe(0.5);
    });
  });

  describe('RULE 2: XP still granted but NORMALIZED', () => {
    it('raw XP is always preserved (trust_score only affects leaderboard)', () => {
      const rawXp = 100;
      const lowTrustScore = 0.6;
      
      const effectiveXp = calculateEffectiveXp(rawXp, lowTrustScore);
      
      expect(effectiveXp).toBe(60);
      expect(effectiveXp).toBeGreaterThan(0);
    });

    it('at TRUST_SCORE_MIN (0.5), user still gets 50% effective XP', () => {
      const rawXp = 100;
      const effectiveXp = calculateEffectiveXp(rawXp, TRUST_SCORE_MIN);
      
      expect(effectiveXp).toBe(50);
    });

    it('at TRUST_SCORE_DEFAULT (1.0), user gets 100% effective XP', () => {
      const rawXp = 100;
      const effectiveXp = calculateEffectiveXp(rawXp, TRUST_SCORE_DEFAULT);
      
      expect(effectiveXp).toBe(100);
    });

    it('XP per chapter is constant regardless of trust_score', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });
  });

  describe('RULE 3: trust_score decreases TEMPORARILY', () => {
    it('trust_score recovers at +0.02 per day', () => {
      expect(DECAY_PER_DAY).toBe(0.02);
    });

    it('applyDecay increases trust_score toward 1.0', () => {
      const lowScore = 0.7;
      const afterOneDay = applyDecay(lowScore, 1);
      
      expect(afterOneDay).toBe(0.72);
      expect(afterOneDay).toBeGreaterThan(lowScore);
    });

    it('multiple days of decay progressively recover trust_score', () => {
      const lowScore = 0.6;
      const after5Days = applyDecay(lowScore, 5);
      
      expect(after5Days).toBe(0.7);
    });

    it('decay caps at TRUST_SCORE_MAX (1.0)', () => {
      const highScore = 0.99;
      const afterDecay = applyDecay(highScore, 1);
      
      expect(afterDecay).toBe(1.0);
    });

    it('daysUntilFullRecovery calculates correctly', () => {
      expect(daysUntilFullRecovery(0.9)).toBe(5);
      expect(daysUntilFullRecovery(0.8)).toBe(10);
      expect(daysUntilFullRecovery(0.5)).toBe(25);
      expect(daysUntilFullRecovery(1.0)).toBe(0);
    });
  });

  describe('RULE 4: NO BANS (hard limits enforced)', () => {
    it('trust_score cannot go below TRUST_SCORE_MIN (0.5)', () => {
      let score = TRUST_SCORE_DEFAULT;
      
      for (let i = 0; i < 100; i++) {
        score = applyPenalty(score, 0.1);
      }
      
      expect(score).toBe(TRUST_SCORE_MIN);
      expect(score).not.toBeLessThan(TRUST_SCORE_MIN);
    });

    it('even at minimum trust_score, XP is still granted', () => {
      const xp = calculateEffectiveXp(100, TRUST_SCORE_MIN);
      expect(xp).toBe(50);
      expect(xp).toBeGreaterThan(0);
    });

    it('worst-case user still has path to full recovery', () => {
      const days = daysUntilFullRecovery(TRUST_SCORE_MIN);
      
      expect(days).toBe(25);
      expect(days).toBeLessThan(30);
    });

    it('trust_score bounds are correctly enforced', () => {
      expect(TRUST_SCORE_MIN).toBe(0.5);
      expect(TRUST_SCORE_MAX).toBe(1.0);
      expect(TRUST_SCORE_DEFAULT).toBe(1.0);
    });
  });

  describe('Full Abuse Scenario Simulation', () => {
    it('simulates human spammer over a week', () => {
      let trustScore = TRUST_SCORE_DEFAULT;
      let totalRawXp = 0;
      let totalEffectiveXp = 0;
      
      for (let day = 0; day < 7; day++) {
        for (let i = 0; i < 3; i++) {
          trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['rapid_reads']);
        }
        
        const rawXpToday = 50 * XP_PER_CHAPTER;
        totalRawXp += rawXpToday;
        totalEffectiveXp += calculateEffectiveXp(rawXpToday, trustScore);
        
        trustScore = applyDecay(trustScore, 1);
      }
      
      expect(totalRawXp).toBe(350);
      expect(totalEffectiveXp).toBeLessThan(totalRawXp);
      expect(totalEffectiveXp).toBeGreaterThan(0);
      expect(trustScore).toBeGreaterThanOrEqual(TRUST_SCORE_MIN);
    });

    it('simulates reformed user recovery', () => {
      let trustScore = TRUST_SCORE_MIN + 0.05;
      
      for (let day = 0; day < 30; day++) {
        trustScore = applyDecay(trustScore, 1);
        if (trustScore >= TRUST_SCORE_MAX) break;
      }
      
      expect(trustScore).toBe(TRUST_SCORE_MAX);
    });

    it('simulates bot detection and penalty', () => {
      let trustScore = TRUST_SCORE_DEFAULT;
      
      trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['pattern_repetition']);
      trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['bulk_speed_read']);
      trustScore = applyPenalty(trustScore, VIOLATION_PENALTIES['api_spam']);
      
      expect(trustScore).toBe(0.78);
      
      const daysToRecover = daysUntilFullRecovery(trustScore);
      expect(daysToRecover).toBe(11);
      
      const effectiveXp = calculateEffectiveXp(1000, trustScore);
      expect(effectiveXp).toBe(780);
    });
  });

  describe('Read Time Validation (Soft)', () => {
    it('calculates minimum read time correctly', () => {
      expect(calculateMinimumReadTime(20)).toBe(60);
      expect(calculateMinimumReadTime(10)).toBe(MIN_READ_TIME_SECONDS);
      expect(calculateMinimumReadTime(null)).toBe(54);
    });

    it('minimum read time formula is correct', () => {
      const pages = 25;
      const expected = pages * SECONDS_PER_PAGE;
      
      expect(calculateMinimumReadTime(pages)).toBe(expected);
      expect(expected).toBe(75);
    });

    it('constants are set to reasonable values', () => {
      expect(MIN_READ_TIME_SECONDS).toBe(30);
      expect(SECONDS_PER_PAGE).toBe(3);
    });
  });
});
