import { calculateDecayedScore, isEligibleForDiscover, SUPPRESSION_THRESHOLDS } from '@/lib/series-scoring';

describe('Series Scoring & Suppression Integration', () => {
  const now = new Date('2026-01-13T12:00:00Z');

  test('Dead manga (25mo no update, 7mo no activity) is hard suppressed', () => {
    const series = {
      last_chapter_at: new Date('2023-12-10T12:00:00Z'), // ~25 months ago
      last_activity_at: new Date('2025-06-10T12:00:00Z'), // 7 months ago
      total_follows: 1000,
      stats: { total_readers: 500, weekly_readers: 0 }
    } as any;
    
    const score = calculateDecayedScore(series, now);
    expect(score).toBe(0);
    expect(isEligibleForDiscover(series, score, now)).toBe(false);
  });

  test('Manga with no updates for 13mo but high legacy popularity is eligible for Discover', () => {
    const series = {
      last_chapter_at: new Date('2024-12-10T12:00:00Z'), // 13 months ago
      last_activity_at: new Date('2026-01-10T12:00:00Z'), // Recent activity
      total_follows: 2000,
      stats: { total_readers: 1500, weekly_readers: 2.0 }
    } as any;
    
    const score = calculateDecayedScore(series, now);
    // 2000*1 + 1500*2 + 2*0.5 = 2000 + 3000 + 1 = 5001
    // Decay factor for 13mo is 0.5
    // 5001 * 0.5 = 2500.5 -> 2501
    expect(score).toBeGreaterThan(SUPPRESSION_THRESHOLDS.SOFT);
    expect(isEligibleForDiscover(series, score, now)).toBe(true);
  });

  test('Viral manga with high engagement override is eligible even if stale', () => {
    const series = {
      last_chapter_at: new Date('2024-12-10T12:00:00Z'), // 13 months ago
      last_activity_at: new Date('2026-01-13T11:00:00Z'), // Just now
      total_follows: 100,
      stats: { total_readers: 50, weekly_readers: 20.0 } // High weekly velocity
    } as any;
    
    const score = calculateDecayedScore(series, now);
    // (100*1 + 50*2 + 20*0.5) * 0.5 = (100 + 100 + 10) * 0.5 = 210 * 0.5 = 105
    expect(score).toBeGreaterThan(SUPPRESSION_THRESHOLDS.SOFT);
    expect(isEligibleForDiscover(series, score, now)).toBe(true);
  });

  test('Quiet but active manga is visible but not promoted', () => {
    const series = {
      last_chapter_at: new Date('2026-01-12T12:00:00Z'), // Yesterday
      last_activity_at: new Date('2026-01-12T12:00:00Z'),
      total_follows: 5,
      stats: { total_readers: 2, weekly_readers: 0.1 }
    } as any;
    
    const score = calculateDecayedScore(series, now);
    // (5*1 + 2*2 + 0.1*0.5) * 1.0 = 9.05 -> 9
    expect(score).toBeLessThan(SUPPRESSION_THRESHOLDS.MEDIUM);
    expect(isEligibleForDiscover(series, score, now)).toBe(false);
  });
});
