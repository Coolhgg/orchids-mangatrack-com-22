/**
 * Trust Score Decay Model Tests
 * 
 * Tests the forgiveness system:
 * - trust_score ∈ [0.5, 1.0]
 * - Decays upward daily: trust_score += 0.02/day
 * - Cap at 1.0
 * - Prevents permanent punishment
 */

import {
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  TRUST_SCORE_DEFAULT,
  DECAY_PER_DAY,
  VIOLATION_PENALTIES,
  applyPenalty,
  applyDecay,
  daysUntilFullRecovery,
  calculateEffectiveXp,
} from '@/lib/gamification/trust-score';

describe('Trust Score Decay Model', () => {
  describe('Constants', () => {
    it('should have correct bounds', () => {
      expect(TRUST_SCORE_MIN).toBe(0.5);
      expect(TRUST_SCORE_MAX).toBe(1.0);
      expect(TRUST_SCORE_DEFAULT).toBe(1.0);
    });

    it('should have decay rate of 0.02/day', () => {
      expect(DECAY_PER_DAY).toBe(0.02);
    });
  });

  describe('applyDecay() - Upward Recovery', () => {
    it('should add 0.02 per day', () => {
      expect(applyDecay(0.5, 1)).toBe(0.52);
      expect(applyDecay(0.7, 1)).toBe(0.72);
      expect(applyDecay(0.98, 1)).toBe(1.0); // Capped at 1.0
    });

    it('should support multi-day recovery', () => {
      expect(applyDecay(0.5, 5)).toBe(0.6);   // 0.5 + (5 * 0.02) = 0.6
      expect(applyDecay(0.5, 25)).toBe(1.0);  // 0.5 + (25 * 0.02) = 1.0
      expect(applyDecay(0.5, 50)).toBe(1.0);  // Capped at 1.0
    });

    it('should cap at 1.0', () => {
      expect(applyDecay(0.99, 1)).toBe(1.0);
      expect(applyDecay(1.0, 1)).toBe(1.0);
      expect(applyDecay(0.5, 100)).toBe(1.0);
    });

    it('should clamp to minimum when given negative days', () => {
      // applyDecay clamps to [0.5, 1.0] range
      expect(applyDecay(0.5, 0)).toBe(0.5);
      expect(applyDecay(0.5, -1)).toBe(0.5); // Clamped to minimum
    });
  });

  describe('daysUntilFullRecovery()', () => {
    it('should calculate correct recovery time', () => {
      // From minimum (0.5) to max (1.0) = 0.5 / 0.02 = 25 days
      expect(daysUntilFullRecovery(0.5)).toBe(25);
      
      // From 0.9 to 1.0 = 0.1 / 0.02 = 5 days
      expect(daysUntilFullRecovery(0.9)).toBe(5);
      
      // From 0.99 to 1.0 = 0.01 / 0.02 = 0.5 → ceil = 1 day
      expect(daysUntilFullRecovery(0.99)).toBe(1);
    });

    it('should return 0 for fully trusted users', () => {
      expect(daysUntilFullRecovery(1.0)).toBe(0);
      expect(daysUntilFullRecovery(1.1)).toBe(0); // Edge case
    });

    it('should handle floating point edge cases with ceil', () => {
      // daysUntilFullRecovery uses Math.ceil, so any deficit results in at least 1 day
      // 0.96 → 0.04 deficit → 0.04/0.02 = 2, but floating point may give 2.0000001
      const days = daysUntilFullRecovery(0.96);
      expect(days).toBeGreaterThanOrEqual(2);
      expect(days).toBeLessThanOrEqual(3);
    });
  });

  describe('Penalty + Recovery Cycle', () => {
    it('should allow recovery after penalty', () => {
      // Start trusted
      let score = 1.0;
      
      // Apply rapid_reads penalty (-0.05)
      score = applyPenalty(score, VIOLATION_PENALTIES.rapid_reads);
      expect(score).toBe(0.95);
      
      // Recover over 3 days (+0.06)
      score = applyDecay(score, 3);
      expect(score).toBeCloseTo(1.0);
    });

    it('should recover from worst case in 25 days', () => {
      // Start at minimum
      let score = 0.5;
      
      // Apply daily decay for 25 days
      score = applyDecay(score, 25);
      expect(score).toBe(1.0);
    });

    it('should handle repeated violations with gradual recovery', () => {
      let score = 1.0;
      
      // Day 1: api_spam penalty (-0.10)
      score = applyPenalty(score, VIOLATION_PENALTIES.api_spam);
      expect(score).toBe(0.9);
      
      // Day 2: decay (+0.02)
      score = applyDecay(score, 1);
      expect(score).toBe(0.92);
      
      // Day 3: another penalty (-0.10)
      score = applyPenalty(score, VIOLATION_PENALTIES.api_spam);
      expect(score).toBeCloseTo(0.82); // Use toBeCloseTo for float precision
      
      // Days 4-12: 9 days of clean decay (+0.18)
      score = applyDecay(score, 9);
      expect(score).toBe(1.0);
    });
  });

  describe('Effective XP Calculation', () => {
    it('should apply trust score as multiplier', () => {
      expect(calculateEffectiveXp(1000, 1.0)).toBe(1000);
      expect(calculateEffectiveXp(1000, 0.5)).toBe(500);
      expect(calculateEffectiveXp(1000, 0.75)).toBe(750);
    });

    it('should clamp trust score to bounds', () => {
      expect(calculateEffectiveXp(1000, 0.3)).toBe(500);  // Clamped to 0.5
      expect(calculateEffectiveXp(1000, 1.5)).toBe(1000); // Clamped to 1.0
    });

    it('should floor the result', () => {
      expect(calculateEffectiveXp(1000, 0.51)).toBe(510);
      expect(calculateEffectiveXp(1001, 0.51)).toBe(510); // Floor(1001 * 0.51) = 510
    });
  });

  describe('Forgiveness Over Time (No Permanent Punishment)', () => {
    it('should allow ANY user to fully recover eventually', () => {
      // Even worst offender at 0.5 can recover to 1.0
      const worstScore = TRUST_SCORE_MIN;
      const daysToRecover = daysUntilFullRecovery(worstScore);
      
      // Should take 25 days max
      expect(daysToRecover).toBe(25);
      
      // Verify recovery actually works
      const recoveredScore = applyDecay(worstScore, daysToRecover);
      expect(recoveredScore).toBe(1.0);
    });

    it('should be unconditional - decay always applies', () => {
      // The decay function doesn't check for violations
      // It just adds 0.02/day regardless
      // This is by design - recovery is unconditional
      
      let score = 0.5;
      
      // Day 1: decay happens
      score = applyDecay(score, 1);
      expect(score).toBe(0.52);
      
      // Then penalty (simulating violation on same day)
      score = applyPenalty(score, VIOLATION_PENALTIES.rapid_reads);
      // 0.52 - 0.05 = 0.47, but clamped to 0.5 (minimum)
      expect(score).toBe(0.5);
    });

    it('should demonstrate net recovery even with occasional violations', () => {
      // Scenario: User at 0.6, gets one violation per week
      let score = 0.6;
      
      // Week 1: 7 days decay (+0.14), 1 violation (-0.05)
      score = applyDecay(score, 7);
      expect(score).toBeCloseTo(0.74);
      score = applyPenalty(score, VIOLATION_PENALTIES.rapid_reads);
      expect(score).toBeCloseTo(0.69);
      
      // Week 2: 7 days decay (+0.14), 1 violation (-0.05)
      score = applyDecay(score, 7);
      expect(score).toBeCloseTo(0.83);
      score = applyPenalty(score, VIOLATION_PENALTIES.rapid_reads);
      expect(score).toBeCloseTo(0.78);
      
      // Week 3: 7 days decay (+0.14), 1 violation (-0.05)
      score = applyDecay(score, 7);
      expect(score).toBeCloseTo(0.92);
      score = applyPenalty(score, VIOLATION_PENALTIES.rapid_reads);
      expect(score).toBeCloseTo(0.87);
      
      // Net positive recovery over time
      expect(score).toBeGreaterThan(0.6);
    });
  });
});
