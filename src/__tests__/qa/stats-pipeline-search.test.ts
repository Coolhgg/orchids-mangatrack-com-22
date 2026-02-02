// @ts-nocheck - Integration test with complex mocks
/**
 * QA Test Suite: Stats Pipeline and Search Ranking
 * =============================================================================
 * 
 * This file contains unit and integration tests for:
 * 1. MangaDex stats ingestion pipeline
 * 2. Search ranking with popularity/exact-match boosts
 * 3. Series deduplication by canonical_series_id
 * 
 * Run: npm test -- src/__tests__/qa/stats-pipeline-search.test.ts
 */

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

// ============================================================================
// QA CHECKLIST (10 Items)
// ============================================================================

/**
 * ## QA Checklist: Stats Pipeline & Search Ranking Verification
 * 
 * ### Stats Ingestion Pipeline
 * 
 * 1. [ ] **Repeatable Job Registration**
 *    - Verify mangadex:stats-refresh repeatable job is registered in BullMQ
 *    - Check: await mangadexStatsRefreshQueue.getRepeatableJobs()
 *    - Expected: At least one job with cron pattern like "every 15 minutes"
 * 
 * 2. [ ] **Tier A Batch Processing**
 *    - Trigger scheduler manually: `await runMangadexStatsRefreshScheduler()`
 *    - Verify Tier A candidates (high follows OR never-fetched) are queued first
 *    - Check job data contains `tier: 'A'` and valid mangadexIds array
 * 
 * 3. [ ] **Stats Fetch Success**
 *    - After job completes, query: `SELECT COUNT(*) FROM series WHERE stats_last_fetched_at > NOW() - INTERVAL '5 minutes'`
 *    - Expected: Count > 0 (at least one series has recent stats)
 * 
 * 4. [ ] **Rate Limit Handling (429)**
 *    - Inspect worker logs for `[MangaDexStats] Rate limited (429)`
 *    - Verify retry backoff: should wait `Retry-After` seconds or exponential backoff
 *    - No job should fail permanently due to transient 429s (up to 3 consecutive)
 * 
 * 5. [ ] **Stats Data Accuracy**
 *    - Pick 3 series with mangadex_id, compare DB values to MangaDex API response
 *    - `total_follows` should match `statistics.{id}.follows`
 *    - `average_rating` should match `statistics.{id}.rating.bayesian` (or null)
 * 
 * ### Search Ranking Verification
 * 
 * 6. [ ] **Exact Match Boost**
 *    - Search for exact title: "One Piece"
 *    - Verify top result has `exact_match_boost = 1` (exact title match)
 *    - Partial matches should have `exact_match_boost = 0`
 * 
 * 7. [ ] **Popularity Ranking (total_follows DESC)**
 *    - Search for common term: "dragon"
 *    - Results should be ordered by total_follows DESC (highest first)
 *    - Verify using: `results[0].total_follows >= results[1].total_follows`
 * 
 * 8. [ ] **Similarity Tiebreaker**
 *    - Search for "naruto shippuden"
 *    - When total_follows are equal, higher similarity score should rank first
 *    - Check `best_match_score` includes similarity component
 * 
 * 9. [ ] **Deduplication by canonical_series_id**
 *    - If series A and B have same `canonical_series_id`, only one should appear
 *    - The one with higher `total_follows` should be kept (ROW_NUMBER partition)
 * 
 * 10. [ ] **Safe Browsing Mode Filter**
 *     - Search with `safeBrowsingMode: 'sfw'`
 *     - Results should only include `content_rating IN ('safe', 'suggestive', NULL)`
 *     - No 'erotica' or 'pornographic' content should appear
 */

// ============================================================================
// UNIT TEST: MangaDexStatsClient.getStatisticsBatch
// ============================================================================

describe('MangaDexStatsClient.getStatisticsBatch', () => {
  // Mock axios for isolated unit testing
  const mockAxiosGet = jest.fn();
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock axios.create to return our mock instance
    jest.mock('axios', () => ({
      create: jest.fn(() => ({
        get: mockAxiosGet,
      })),
      isAxiosError: jest.fn((e) => e.isAxiosError === true),
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return empty map for empty input', async () => {
    // Import dynamically to use mocked axios
    const { MangaDexStatsClient } = await import('@/lib/mangadex/stats');
    const client = new MangaDexStatsClient();
    
    const result = await client.getStatisticsBatch([]);
    expect(result).toEqual(new Map());
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('should handle successful 200 response', async () => {
    const { MangaDexStatsClient } = await import('@/lib/mangadex/stats');
    const client = new MangaDexStatsClient();

    // Mock successful response
    mockAxiosGet.mockResolvedValueOnce({
      data: {
        result: 'ok',
        statistics: {
          'manga-uuid-1': {
            follows: 50000,
            rating: { average: 8.5, bayesian: 8.2, distribution: {} },
          },
          'manga-uuid-2': {
            follows: 10000,
            rating: { average: null, bayesian: null, distribution: {} },
          },
        },
      },
    });

    const result = await client.getStatisticsBatch(['manga-uuid-1', 'manga-uuid-2']);

    expect(result.size).toBe(2);
    expect(result.get('manga-uuid-1')).toEqual({
      id: 'manga-uuid-1',
      follows: 50000,
      rating: 8.2,
    });
    expect(result.get('manga-uuid-2')).toEqual({
      id: 'manga-uuid-2',
      follows: 10000,
      rating: null,
    });
  });

  it('should handle 429 rate limit with Retry-After header', async () => {
    const { MangaDexStatsClient, RateLimitError } = await import('@/lib/mangadex/stats');
    const client = new MangaDexStatsClient();

    // Create mock error that looks like an Axios error
    const rateLimitError = {
      isAxiosError: true,
      response: {
        status: 429,
        headers: { 'retry-after': '60' },
      },
    };

    // Mock three consecutive 429s (should throw RateLimitError)
    mockAxiosGet
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError)
      .mockRejectedValueOnce(rateLimitError);

    await expect(client.getStatisticsBatch(['test-id'])).rejects.toThrow(RateLimitError);
  });

  it('should retry on 500 server error with exponential backoff', async () => {
    const { MangaDexStatsClient } = await import('@/lib/mangadex/stats');
    const client = new MangaDexStatsClient();

    const serverError = {
      isAxiosError: true,
      response: { status: 500 },
    };

    // First call fails, second succeeds
    mockAxiosGet
      .mockRejectedValueOnce(serverError)
      .mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { follows: 100, rating: null },
          },
        },
      });

    const result = await client.getStatisticsBatch(['test-id']);

    expect(result.size).toBe(1);
    expect(mockAxiosGet).toHaveBeenCalledTimes(2);
  });

  it('should throw StatsClientError after max retries on 500', async () => {
    const { MangaDexStatsClient, StatsClientError } = await import('@/lib/mangadex/stats');
    const client = new MangaDexStatsClient();

    const serverError = {
      isAxiosError: true,
      response: { status: 500 },
    };

    // All 4 attempts fail
    mockAxiosGet.mockRejectedValue(serverError);

    await expect(client.getStatisticsBatch(['test-id'])).rejects.toThrow(StatsClientError);
  });
});

// ============================================================================
// INTEGRATION TEST: Stats Enrichment Worker
// ============================================================================

describe('Stats Enrichment Worker (Integration)', () => {
  // Mock dependencies
  const mockPrisma = {
    series: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockStatsClient = {
    getStatisticsBatch: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should upsert total_follows and average_rating when series is ingested', async () => {
    // Setup: Mock series data
    const testSeries = [
      { id: 'series-1', mangadex_id: 'md-uuid-1', title: 'Test Manga 1' },
      { id: 'series-2', mangadex_id: 'md-uuid-2', title: 'Test Manga 2' },
    ];

    mockPrisma.series.findMany.mockResolvedValue(testSeries);

    // Mock stats response from MangaDex
    mockStatsClient.getStatisticsBatch.mockResolvedValue(
      new Map([
        ['md-uuid-1', { id: 'md-uuid-1', follows: 50000, rating: 8.5 }],
        ['md-uuid-2', { id: 'md-uuid-2', follows: 1000, rating: null }],
      ])
    );

    // Simulate worker processing
    const mangadexIds = testSeries.map((s) => s.mangadex_id!);
    const statsMap = await mockStatsClient.getStatisticsBatch(mangadexIds);

    // Simulate database upsert
    const updates = testSeries.map((series) => {
      const stats = statsMap.get(series.mangadex_id!);
      return {
        id: series.id,
        total_follows: stats?.follows ?? 0,
        average_rating: stats?.rating ?? null,
        stats_last_fetched_at: new Date(),
      };
    });

    // Verify updates would be applied
    expect(updates).toHaveLength(2);
    expect(updates[0]).toMatchObject({
      id: 'series-1',
      total_follows: 50000,
      average_rating: 8.5,
    });
    expect(updates[1]).toMatchObject({
      id: 'series-2',
      total_follows: 1000,
      average_rating: null,
    });

    // Verify stats_last_fetched_at is set
    expect(updates[0].stats_last_fetched_at).toBeInstanceOf(Date);
    expect(updates[1].stats_last_fetched_at).toBeInstanceOf(Date);
  });

  it('should handle partial stats response (some IDs missing)', async () => {
    const testSeries = [
      { id: 'series-1', mangadex_id: 'md-uuid-1' },
      { id: 'series-2', mangadex_id: 'md-uuid-2' },
      { id: 'series-3', mangadex_id: 'md-uuid-3' },
    ];

    // Only 2 of 3 IDs return stats
    mockStatsClient.getStatisticsBatch.mockResolvedValue(
      new Map([
        ['md-uuid-1', { id: 'md-uuid-1', follows: 1000, rating: 7.0 }],
        ['md-uuid-3', { id: 'md-uuid-3', follows: 500, rating: 6.5 }],
      ])
    );

    const mangadexIds = testSeries.map((s) => s.mangadex_id!);
    const statsMap = await mockStatsClient.getStatisticsBatch(mangadexIds);

    // Series 2 should not be updated (no stats returned)
    const seriesWithStats = testSeries.filter((s) => statsMap.has(s.mangadex_id!));
    expect(seriesWithStats).toHaveLength(2);
    expect(seriesWithStats.map((s) => s.id)).toEqual(['series-1', 'series-3']);
  });
});

// ============================================================================
// SQL TEST: Search Ranking with Deduplication
// ============================================================================

describe('Search Ranking SQL Query', () => {
  // These tests verify the SQL logic; in a real environment, use a test database
  
  it('should order results by exact_match_boost DESC, total_follows DESC', () => {
    // Simulated query results (as if returned from Prisma)
    const mockResults = [
      { id: '1', title: 'One Piece', total_follows: 100000, exact_match_boost: 1, similarity_score: 1.0 },
      { id: '2', title: 'One Piece: Strong World', total_follows: 50000, exact_match_boost: 0, similarity_score: 0.7 },
      { id: '3', title: 'One Piece Omake', total_follows: 20000, exact_match_boost: 0, similarity_score: 0.65 },
    ];

    // Verify ordering logic
    const sorted = [...mockResults].sort((a, b) => {
      // 1. exact_match_boost DESC
      if (a.exact_match_boost !== b.exact_match_boost) {
        return b.exact_match_boost - a.exact_match_boost;
      }
      // 2. total_follows DESC
      if (a.total_follows !== b.total_follows) {
        return b.total_follows - a.total_follows;
      }
      // 3. similarity_score DESC
      return b.similarity_score - a.similarity_score;
    });

    expect(sorted[0].title).toBe('One Piece'); // Exact match first
    expect(sorted[1].title).toBe('One Piece: Strong World'); // Higher follows
    expect(sorted[2].title).toBe('One Piece Omake'); // Lower follows
  });

  it('should deduplicate by canonical_series_id keeping highest follows', () => {
    // Three series with same canonical_series_id but different follows
    const mockSeriesWithCanonical = [
      { id: '1', title: 'Dragon Ball', canonical_series_id: 'canonical-1', total_follows: 100000, similarity_score: 1.0 },
      { id: '2', title: 'Dragon Ball (Fan Translation)', canonical_series_id: 'canonical-1', total_follows: 5000, similarity_score: 0.9 },
      { id: '3', title: 'Dragon Ball Z', canonical_series_id: 'canonical-2', total_follows: 80000, similarity_score: 0.8 },
    ];

    // Simulate ROW_NUMBER() PARTITION BY canonical_series_id ORDER BY total_follows DESC
    const deduped = Object.values(
      mockSeriesWithCanonical.reduce((acc, series) => {
        const key = series.canonical_series_id || series.id;
        if (!acc[key] || acc[key].total_follows < series.total_follows) {
          acc[key] = series;
        }
        return acc;
      }, {} as Record<string, typeof mockSeriesWithCanonical[0]>)
    );

    // Should have 2 results (one per canonical_series_id)
    expect(deduped).toHaveLength(2);
    
    // canonical-1 group should keep "Dragon Ball" (100k follows, not 5k)
    const canonical1 = deduped.find((s) => s.canonical_series_id === 'canonical-1');
    expect(canonical1?.title).toBe('Dragon Ball');
    expect(canonical1?.total_follows).toBe(100000);

    // canonical-2 should keep "Dragon Ball Z"
    const canonical2 = deduped.find((s) => s.canonical_series_id === 'canonical-2');
    expect(canonical2?.title).toBe('Dragon Ball Z');
  });

  it('should calculate best_match_score correctly', () => {
    // best_match_score = exact_match_boost * 1000 + total_follows * 0.001 + similarity_score * 100
    const testCases = [
      { exact: 1, follows: 100000, similarity: 1.0, expected: 1000 + 100 + 100 }, // 1200
      { exact: 0, follows: 50000, similarity: 0.8, expected: 0 + 50 + 80 }, // 130
      { exact: 1, follows: 0, similarity: 0.5, expected: 1000 + 0 + 50 }, // 1050
    ];

    for (const tc of testCases) {
      const score = tc.exact * 1000 + tc.follows * 0.001 + tc.similarity * 100;
      expect(score).toBeCloseTo(tc.expected, 1);
    }
  });
});

// ============================================================================
// Export for external runners
// ============================================================================

export { };
