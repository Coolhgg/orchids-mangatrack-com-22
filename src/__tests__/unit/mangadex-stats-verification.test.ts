/**
 * Verification Tests: MangaDex Stats Client
 * 
 * Tests the three specific behaviors requested:
 * 1. Batching: manga[]=id1&manga[]=id2... URL format
 * 2. Null Checks: rating defaults to null (not 0) when missing
 * 3. Bayesian vs Average: Uses bayesian rating, not average
 */

import axios from 'axios';
import { MangaDexStatsClient } from '@/lib/mangadex/stats';

// Track the actual URL that was called
let lastCalledUrl: string | null = null;

// Mock axios to capture URL and return test data
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn((url: string) => {
      lastCalledUrl = url;
      // Return mock response based on test scenario
      return Promise.resolve({
        data: {
          result: 'ok',
          statistics: {},
        },
      });
    }),
  };
  return {
    create: jest.fn(() => mockAxiosInstance),
    isAxiosError: jest.fn((error) => error?.isAxiosError === true),
  };
});

describe('MangaDex Stats Client - Behavior Verification', () => {
  let client: MangaDexStatsClient;
  let mockAxiosGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    lastCalledUrl = null;
    client = new MangaDexStatsClient({ batchSize: 100, rps: 10 });
    const mockAxiosCreate = axios.create as jest.Mock;
    mockAxiosGet = mockAxiosCreate.mock.results[0]?.value?.get;
    
    // Suppress console output
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('1. Batching: URL Format Verification', () => {
    it('should use manga[]=id format for single ID', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id-1': { follows: 100, rating: null },
          },
        },
      });

      await client.getStatisticsBatch(['test-id-1']);

      expect(lastCalledUrl).toBe('/statistics/manga?manga%5B%5D=test-id-1');
      // Decoded: /statistics/manga?manga[]=test-id-1
      expect(decodeURIComponent(lastCalledUrl!)).toBe('/statistics/manga?manga[]=test-id-1');
    });

    it('should use manga[]=id1&manga[]=id2 format for multiple IDs', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'id-1': { follows: 100, rating: null },
            'id-2': { follows: 200, rating: null },
            'id-3': { follows: 300, rating: null },
          },
        },
      });

      await client.getStatisticsBatch(['id-1', 'id-2', 'id-3']);

      const decodedUrl = decodeURIComponent(lastCalledUrl!);
      
      // Verify format: manga[]=id1&manga[]=id2&manga[]=id3
      expect(decodedUrl).toContain('manga[]=id-1');
      expect(decodedUrl).toContain('manga[]=id-2');
      expect(decodedUrl).toContain('manga[]=id-3');
      
      // Verify it's using repeated params, not comma-separated
      expect(decodedUrl).not.toContain('id-1,id-2');
      
      // Count occurrences of 'manga[]='
      const matches = decodedUrl.match(/manga\[\]=/g);
      expect(matches).toHaveLength(3);
    });

    it('should handle large batch with correct URL format', async () => {
      const ids = Array.from({ length: 50 }, (_, i) => `uuid-${i}`);
      
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: Object.fromEntries(
            ids.map(id => [id, { follows: 100, rating: null }])
          ),
        },
      });

      await client.getStatisticsBatch(ids);

      const decodedUrl = decodeURIComponent(lastCalledUrl!);
      const matches = decodedUrl.match(/manga\[\]=/g);
      expect(matches).toHaveLength(50);
    });
  });

  describe('2. Null Checks: Rating Handling', () => {
    it('should return null when rating object is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { follows: 100, rating: null },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);
      
      expect(result.get('test-id')?.rating).toBeNull();
      expect(result.get('test-id')?.follows).toBe(100);
    });

    it('should return null when rating.bayesian is null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { 
              follows: 100, 
              rating: { 
                average: 7.5,  // Has average but no bayesian
                bayesian: null, 
                distribution: {} 
              } 
            },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);
      
      // Should return null, NOT the average (7.5)
      expect(result.get('test-id')?.rating).toBeNull();
    });

    it('should return null when rating object is undefined', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { follows: 100 }, // No rating property at all
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);
      
      expect(result.get('test-id')?.rating).toBeNull();
    });

    it('should default follows to 0 when missing', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { rating: { bayesian: 8.0, average: 7.5, distribution: {} } },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);
      
      expect(result.get('test-id')?.follows).toBe(0);
    });

    it('should handle manga with no statistics entry', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            // 'requested-id' is missing from response
          },
        },
      });

      const result = await client.getStatisticsBatch(['requested-id']);
      
      // Should not have the missing ID in results
      expect(result.has('requested-id')).toBe(false);
      expect(result.size).toBe(0);
    });
  });

  describe('3. Bayesian vs Average: Correct Rating Usage', () => {
    it('should use bayesian rating, not average', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { 
              follows: 100, 
              rating: { 
                average: 9.5,   // Higher average (unreliable)
                bayesian: 7.8,  // Lower bayesian (reliable)
                distribution: { '10': 5, '1': 1 }
              } 
            },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);
      
      // Should use bayesian (7.8), NOT average (9.5)
      expect(result.get('test-id')?.rating).toBe(7.8);
      expect(result.get('test-id')?.rating).not.toBe(9.5);
    });

    it('should prefer bayesian even when average is higher', async () => {
      // Scenario: New manga with few ratings
      // Average might be 10 (one person rated 10)
      // Bayesian might be 6.5 (weighted towards global mean)
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'new-manga': { 
              follows: 5, 
              rating: { 
                average: 10.0,   // Unreliable - only 1 vote
                bayesian: 6.52,  // Reliable - weighted
                distribution: { '10': 1 }
              } 
            },
          },
        },
      });

      const result = await client.getStatisticsBatch(['new-manga']);
      
      expect(result.get('new-manga')?.rating).toBe(6.52);
    });

    it('should handle case where both are null', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'unrated-manga': { 
              follows: 50, 
              rating: { 
                average: null,
                bayesian: null,
                distribution: {}
              } 
            },
          },
        },
      });

      const result = await client.getStatisticsBatch(['unrated-manga']);
      
      expect(result.get('unrated-manga')?.rating).toBeNull();
    });
  });

  describe('Combined Scenarios', () => {
    it('should handle mixed batch with various rating states', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'popular-manga': { 
              follows: 100000, 
              rating: { average: 8.9, bayesian: 8.7, distribution: {} } 
            },
            'new-manga': { 
              follows: 10, 
              rating: { average: 10.0, bayesian: 7.2, distribution: {} } 
            },
            'unrated-manga': { 
              follows: 100, 
              rating: null 
            },
            'no-follows': { 
              rating: { average: 7.0, bayesian: 6.8, distribution: {} } 
            },
          },
        },
      });

      const result = await client.getStatisticsBatch([
        'popular-manga', 'new-manga', 'unrated-manga', 'no-follows'
      ]);

      expect(result.size).toBe(4);
      
      // Popular manga: uses bayesian
      expect(result.get('popular-manga')?.follows).toBe(100000);
      expect(result.get('popular-manga')?.rating).toBe(8.7);
      
      // New manga: uses bayesian (not inflated average)
      expect(result.get('new-manga')?.follows).toBe(10);
      expect(result.get('new-manga')?.rating).toBe(7.2);
      
      // Unrated manga: null rating
      expect(result.get('unrated-manga')?.follows).toBe(100);
      expect(result.get('unrated-manga')?.rating).toBeNull();
      
      // No follows: defaults to 0
      expect(result.get('no-follows')?.follows).toBe(0);
      expect(result.get('no-follows')?.rating).toBe(6.8);
    });
  });
});
