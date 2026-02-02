/**
 * ANTI-BOT HEURISTICS TESTS
 * 
 * TRIGGERS:
 * - <30s read time repeatedly → speed_read
 * - 3+ suspicious reads in 5 min → bulk_speed_read
 * - Pattern repetition (std dev < 2s) → pattern_repetition
 * 
 * ACTION:
 * - Record TrustViolation
 * - Reduce trust_score
 * - NEVER block XP or reading
 */

import {
  calculateMinimumReadTime,
  MIN_READ_TIME_SECONDS,
  SECONDS_PER_PAGE,
  DEFAULT_PAGE_COUNT,
  BULK_SPEED_READ_COUNT,
  BULK_SPEED_READ_WINDOW_MS,
  PATTERN_INTERVAL_COUNT,
  PATTERN_STD_DEV_THRESHOLD,
  PATTERN_MIN_INTERVAL_MS,
  getEstimatedReadTime,
} from '@/lib/gamification/read-time-validation';

import {
  VIOLATION_PENALTIES,
  applyPenalty,
  TRUST_SCORE_MIN,
  TRUST_SCORE_MAX,
  TRUST_SCORE_DEFAULT,
} from '@/lib/gamification/trust-score';

describe('Anti-Bot Heuristics', () => {
  
  describe('Violation Types Exist', () => {
    it('speed_read penalty is defined', () => {
      expect(VIOLATION_PENALTIES.speed_read).toBe(0.02);
    });
    
    it('bulk_speed_read penalty is defined', () => {
      expect(VIOLATION_PENALTIES.bulk_speed_read).toBe(0.04);
    });
    
    it('pattern_repetition penalty is defined', () => {
      expect(VIOLATION_PENALTIES.pattern_repetition).toBe(0.08);
    });
    
    it('pattern_repetition has highest penalty among heuristics', () => {
      expect(VIOLATION_PENALTIES.pattern_repetition).toBeGreaterThan(VIOLATION_PENALTIES.bulk_speed_read);
      expect(VIOLATION_PENALTIES.bulk_speed_read).toBeGreaterThan(VIOLATION_PENALTIES.speed_read);
    });
  });
  
  describe('Trigger 1: <30s Read Time Repeatedly', () => {
    it('minimum read time is 30 seconds', () => {
      expect(MIN_READ_TIME_SECONDS).toBe(30);
    });
    
    it('calculateMinimumReadTime returns at least 30s', () => {
      expect(calculateMinimumReadTime(null)).toBeGreaterThanOrEqual(30);
      expect(calculateMinimumReadTime(5)).toBeGreaterThanOrEqual(30);
      expect(calculateMinimumReadTime(1)).toBeGreaterThanOrEqual(30);
    });
    
    it('per-page minimum is 3 seconds', () => {
      expect(SECONDS_PER_PAGE).toBe(3);
    });
    
    it('calculateMinimumReadTime scales with page count', () => {
      expect(calculateMinimumReadTime(20)).toBe(60); // 20 * 3 = 60
      expect(calculateMinimumReadTime(50)).toBe(150); // 50 * 3 = 150
    });
    
    it('speed_read penalty reduces trust_score', () => {
      const newScore = applyPenalty(TRUST_SCORE_DEFAULT, VIOLATION_PENALTIES.speed_read);
      expect(newScore).toBe(0.98);
    });
  });
  
  describe('Trigger 2: 3+ Suspicious Reads in 5 Min', () => {
    it('bulk threshold is 3 reads', () => {
      expect(BULK_SPEED_READ_COUNT).toBe(3);
    });
    
    it('bulk window is 5 minutes', () => {
      expect(BULK_SPEED_READ_WINDOW_MS).toBe(300000);
    });
    
    it('bulk_speed_read penalty is higher than single speed_read', () => {
      expect(VIOLATION_PENALTIES.bulk_speed_read).toBeGreaterThan(VIOLATION_PENALTIES.speed_read);
    });
    
    it('bulk_speed_read penalty reduces trust_score', () => {
      const newScore = applyPenalty(TRUST_SCORE_DEFAULT, VIOLATION_PENALTIES.bulk_speed_read);
      expect(newScore).toBe(0.96);
    });
  });
  
  describe('Trigger 3: Pattern Repetition', () => {
    it('requires 5+ intervals for detection', () => {
      expect(PATTERN_INTERVAL_COUNT).toBe(5);
    });
    
    it('standard deviation threshold is 2 seconds', () => {
      expect(PATTERN_STD_DEV_THRESHOLD).toBe(2.0);
    });
    
    it('ignores intervals < 5 seconds', () => {
      expect(PATTERN_MIN_INTERVAL_MS).toBe(5000);
    });
    
    it('pattern_repetition penalty reduces trust_score', () => {
      const newScore = applyPenalty(TRUST_SCORE_DEFAULT, VIOLATION_PENALTIES.pattern_repetition);
      expect(newScore).toBe(0.92);
    });
  });
  
  describe('Trust Score Bounds', () => {
    it('trust score cannot go below 0.5', () => {
      let score = TRUST_SCORE_DEFAULT;
      for (let i = 0; i < 100; i++) {
        score = applyPenalty(score, VIOLATION_PENALTIES.pattern_repetition);
      }
      expect(score).toBe(TRUST_SCORE_MIN);
      expect(score).toBe(0.5);
    });
    
    it('trust score cannot exceed 1.0', () => {
      const score = applyPenalty(TRUST_SCORE_MAX + 0.5, -0.5);
      expect(score).toBeLessThanOrEqual(TRUST_SCORE_MAX);
    });
    
    it('multiple violations stack penalties', () => {
      let score = TRUST_SCORE_DEFAULT;
      score = applyPenalty(score, VIOLATION_PENALTIES.speed_read); // 0.98
      score = applyPenalty(score, VIOLATION_PENALTIES.speed_read); // 0.96
      score = applyPenalty(score, VIOLATION_PENALTIES.bulk_speed_read); // 0.92
      expect(score).toBeCloseTo(0.92, 5);
    });
  });
  
  describe('NEVER Block XP or Reading', () => {
    it('speed_read penalty does not set score to 0', () => {
      const newScore = applyPenalty(TRUST_SCORE_MIN, VIOLATION_PENALTIES.speed_read);
      expect(newScore).toBeGreaterThan(0);
      expect(newScore).toBe(TRUST_SCORE_MIN);
    });
    
    it('bulk_speed_read penalty does not set score to 0', () => {
      const newScore = applyPenalty(TRUST_SCORE_MIN, VIOLATION_PENALTIES.bulk_speed_read);
      expect(newScore).toBeGreaterThan(0);
    });
    
    it('pattern_repetition penalty does not set score to 0', () => {
      const newScore = applyPenalty(TRUST_SCORE_MIN, VIOLATION_PENALTIES.pattern_repetition);
      expect(newScore).toBeGreaterThan(0);
    });
    
    it('even maximum penalty leaves score at 0.5', () => {
      let score = TRUST_SCORE_DEFAULT;
      for (let i = 0; i < 10; i++) {
        score = applyPenalty(score, VIOLATION_PENALTIES.api_spam); // 0.10 penalty
      }
      expect(score).toBe(TRUST_SCORE_MIN);
    });
  });
  
  describe('Utility Functions', () => {
    it('getEstimatedReadTime returns valid structure', () => {
      const result = getEstimatedReadTime(20);
      expect(result).toHaveProperty('minimumSeconds');
      expect(result).toHaveProperty('averageSeconds');
      expect(result).toHaveProperty('displayText');
    });
    
    it('getEstimatedReadTime uses default page count when null', () => {
      const result = getEstimatedReadTime(null);
      expect(result.minimumSeconds).toBe(DEFAULT_PAGE_COUNT * SECONDS_PER_PAGE);
    });
    
    it('displayText is human-readable', () => {
      const result = getEstimatedReadTime(10);
      expect(result.displayText).toMatch(/~\d+ mins?/);
    });
  });
  
  describe('Pattern Detection Math', () => {
    it('standard deviation of identical values is 0', () => {
      const intervals = [60, 60, 60, 60, 60];
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      expect(stdDev).toBe(0);
      expect(stdDev).toBeLessThan(PATTERN_STD_DEV_THRESHOLD);
    });
    
    it('standard deviation of varied values exceeds threshold', () => {
      const intervals = [30, 90, 45, 120, 60];
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      expect(stdDev).toBeGreaterThan(PATTERN_STD_DEV_THRESHOLD);
    });
    
    it('slight variations still trigger detection', () => {
      const intervals = [60.5, 59.5, 60.0, 60.2, 59.8];
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      expect(stdDev).toBeLessThan(PATTERN_STD_DEV_THRESHOLD);
    });
    
    it('human reading patterns have high variance', () => {
      const intervals = [45, 120, 30, 90, 180];
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      const variance = intervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / intervals.length;
      const stdDev = Math.sqrt(variance);
      
      expect(stdDev).toBeGreaterThan(PATTERN_STD_DEV_THRESHOLD);
    });
  });
});
