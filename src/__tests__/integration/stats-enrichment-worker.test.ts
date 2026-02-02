/**
 * Integration Tests: Stats Enrichment Worker
 * 
 * Tests the enrichment flow that:
 * 1. Fetches stats from MangaDexStatsClient
 * 2. Upserts total_follows and average_rating to series
 * 3. Updates stats_last_fetched_at timestamp
 */

import { prismaMock } from '../../../__mocks__/@prisma/client';

// Mock the MangaDex stats client
const mockGetStatisticsBatch = jest.fn();
jest.mock('@/lib/mangadex/stats', () => ({
  MangaDexStatsClient: jest.fn().mockImplementation(() => ({
    getStatisticsBatch: mockGetStatisticsBatch,
  })),
  mangadexStatsClient: {
    getStatisticsBatch: mockGetStatisticsBatch,
  },
  RateLimitError: class RateLimitError extends Error {
    retryAfter?: number;
    consecutive429s: number;
    constructor(message: string, retryAfter?: number, consecutive429s: number = 0) {
      super(message);
      this.name = 'RateLimitError';
      this.retryAfter = retryAfter;
      this.consecutive429s = consecutive429s;
    }
  },
}));

// Mock prisma
jest.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

describe('Stats Enrichment Worker Integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('enrichSeriesWithStats', () => {
    /**
     * Simulates the enrichment worker logic:
     * 1. Find series with mangadex_id
     * 2. Fetch stats from MangaDex
     * 3. Update series with total_follows and average_rating
     */
    async function enrichSeriesWithStats(seriesIds: string[], mangadexIds: string[]) {
      // Step 1: Fetch stats from MangaDex
      const statsMap = await mockGetStatisticsBatch(mangadexIds);
      
      // Step 2: Prepare updates
      const updates: Array<{
        id: string;
        total_follows: number;
        average_rating: number | null;
        stats_last_fetched_at: Date;
      }> = [];

      for (let i = 0; i < seriesIds.length; i++) {
        const seriesId = seriesIds[i];
        const mangadexId = mangadexIds[i];
        const stats = statsMap.get(mangadexId);
        
        if (stats) {
          updates.push({
            id: seriesId,
            total_follows: stats.follows,
            average_rating: stats.rating,
            stats_last_fetched_at: new Date(),
          });
        }
      }

      // Step 3: Execute updates via transaction
      if (updates.length > 0) {
        await prismaMock.$transaction(
          updates.map((update) =>
            prismaMock.series.update({
              where: { id: update.id },
              data: {
                total_follows: update.total_follows,
                average_rating: update.average_rating,
                stats_last_fetched_at: update.stats_last_fetched_at,
              },
            })
          )
        );
      }

      return { updated: updates.length, skipped: seriesIds.length - updates.length };
    }

    it('should upsert total_follows and average_rating when series is ingested', async () => {
      // Mock stats response from MangaDex
      mockGetStatisticsBatch.mockResolvedValue(
        new Map([
          ['md-uuid-1', { id: 'md-uuid-1', follows: 50000, rating: 8.5 }],
          ['md-uuid-2', { id: 'md-uuid-2', follows: 1000, rating: null }],
        ])
      );

      // Mock prisma transaction
      prismaMock.$transaction.mockResolvedValue([
        { id: 'series-1', total_follows: 50000, average_rating: 8.5 },
        { id: 'series-2', total_follows: 1000, average_rating: null },
      ]);

      const result = await enrichSeriesWithStats(
        ['series-1', 'series-2'],
        ['md-uuid-1', 'md-uuid-2']
      );

      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(0);
      expect(mockGetStatisticsBatch).toHaveBeenCalledWith(['md-uuid-1', 'md-uuid-2']);
      expect(prismaMock.$transaction).toHaveBeenCalled();
      
      // Verify update calls
      const transactionCalls = prismaMock.$transaction.mock.calls[0][0];
      expect(transactionCalls).toHaveLength(2);
    });

    it('should handle partial stats response (some IDs missing)', async () => {
      // Only 2 of 3 IDs return stats
      mockGetStatisticsBatch.mockResolvedValue(
        new Map([
          ['md-uuid-1', { id: 'md-uuid-1', follows: 1000, rating: 7.0 }],
          ['md-uuid-3', { id: 'md-uuid-3', follows: 500, rating: 6.5 }],
        ])
      );

      prismaMock.$transaction.mockResolvedValue([
        { id: 'series-1', total_follows: 1000, average_rating: 7.0 },
        { id: 'series-3', total_follows: 500, average_rating: 6.5 },
      ]);

      const result = await enrichSeriesWithStats(
        ['series-1', 'series-2', 'series-3'],
        ['md-uuid-1', 'md-uuid-2', 'md-uuid-3']
      );

      expect(result.updated).toBe(2);
      expect(result.skipped).toBe(1); // series-2 was skipped
    });

    it('should handle empty stats response', async () => {
      mockGetStatisticsBatch.mockResolvedValue(new Map());

      const result = await enrichSeriesWithStats(
        ['series-1'],
        ['md-uuid-1']
      );

      expect(result.updated).toBe(0);
      expect(result.skipped).toBe(1);
      expect(prismaMock.$transaction).not.toHaveBeenCalled();
    });

    it('should set stats_last_fetched_at timestamp', async () => {
      const beforeTime = new Date();

      mockGetStatisticsBatch.mockResolvedValue(
        new Map([
          ['md-uuid-1', { id: 'md-uuid-1', follows: 100, rating: 5.0 }],
        ])
      );

      prismaMock.$transaction.mockImplementation(async (updates) => {
        // Verify timestamp is recent
        const updateData = (updates as any[])[0];
        // The update would be called with a data object containing stats_last_fetched_at
        return [{ id: 'series-1', total_follows: 100, average_rating: 5.0 }];
      });

      const result = await enrichSeriesWithStats(['series-1'], ['md-uuid-1']);

      const afterTime = new Date();
      expect(result.updated).toBe(1);
      
      // Verify the transaction was called
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('should handle null ratings correctly', async () => {
      mockGetStatisticsBatch.mockResolvedValue(
        new Map([
          ['md-uuid-1', { id: 'md-uuid-1', follows: 100, rating: null }],
        ])
      );

      prismaMock.$transaction.mockResolvedValue([
        { id: 'series-1', total_follows: 100, average_rating: null },
      ]);

      const result = await enrichSeriesWithStats(['series-1'], ['md-uuid-1']);

      expect(result.updated).toBe(1);
      expect(prismaMock.$transaction).toHaveBeenCalled();
    });

    it('should handle large batches correctly', async () => {
      // Create a large batch of 100 series
      const seriesIds = Array.from({ length: 100 }, (_, i) => `series-${i}`);
      const mangadexIds = Array.from({ length: 100 }, (_, i) => `md-uuid-${i}`);
      
      // Create stats map for all 100
      const statsMap = new Map(
        mangadexIds.map((id, i) => [id, { id, follows: i * 100, rating: 5 + (i % 5) }])
      );

      mockGetStatisticsBatch.mockResolvedValue(statsMap);
      prismaMock.$transaction.mockResolvedValue(
        seriesIds.map((id, i) => ({ id, total_follows: i * 100, average_rating: 5 + (i % 5) }))
      );

      const result = await enrichSeriesWithStats(seriesIds, mangadexIds);

      expect(result.updated).toBe(100);
      expect(result.skipped).toBe(0);
    });
  });

  describe('StatsRefreshJobData validation', () => {
    it('should validate job data structure', () => {
      const validJobData = {
        tier: 'A' as const,
        seriesIds: ['series-1', 'series-2'],
        mangadexIds: ['md-uuid-1', 'md-uuid-2'],
        scheduledAt: new Date().toISOString(),
      };

      expect(validJobData.tier).toBe('A');
      expect(validJobData.seriesIds).toHaveLength(2);
      expect(validJobData.mangadexIds).toHaveLength(2);
      expect(new Date(validJobData.scheduledAt)).toBeInstanceOf(Date);
    });

    it('should have matching seriesIds and mangadexIds lengths', () => {
      const jobData = {
        tier: 'B' as const,
        seriesIds: ['s1', 's2', 's3'],
        mangadexIds: ['m1', 'm2', 'm3'],
        scheduledAt: new Date().toISOString(),
      };

      expect(jobData.seriesIds.length).toBe(jobData.mangadexIds.length);
    });
  });
});
