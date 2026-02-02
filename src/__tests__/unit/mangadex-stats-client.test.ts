/**
 * Unit Tests: MangaDexStatsClient.getStatisticsBatch
 * 
 * Tests the stats client with mocked axios responses for:
 * - Successful 200 responses
 * - Rate limiting (429 with Retry-After)
 * - Server errors (500) with exponential backoff
 */

import axios from 'axios';
import { 
  MangaDexStatsClient, 
  RateLimitError, 
  StatsClientError,
  chunkArray 
} from '@/lib/mangadex/stats';

// Mock axios
jest.mock('axios', () => {
  const mockAxiosInstance = {
    get: jest.fn(),
  };
  return {
    create: jest.fn(() => mockAxiosInstance),
    isAxiosError: jest.fn((error) => error?.isAxiosError === true),
  };
});

describe('MangaDexStatsClient', () => {
  let client: MangaDexStatsClient;
  let mockAxiosGet: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ advanceTimers: true });
    
    // Get the mocked axios instance
    client = new MangaDexStatsClient({ batchSize: 50, rps: 10 });
    const mockAxiosCreate = axios.create as jest.Mock;
    mockAxiosGet = mockAxiosCreate.mock.results[0]?.value?.get;
    
    // Suppress console output during tests
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('chunkArray helper', () => {
    it('should split array into chunks of specified size', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7];
      const chunks = chunkArray(arr, 3);
      
      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it('should return single chunk for small arrays', () => {
      const arr = [1, 2];
      const chunks = chunkArray(arr, 5);
      
      expect(chunks).toEqual([[1, 2]]);
    });

    it('should throw for invalid chunk size', () => {
      expect(() => chunkArray([1, 2], 0)).toThrow('Chunk size must be positive');
      expect(() => chunkArray([1, 2], -1)).toThrow('Chunk size must be positive');
    });
  });

  describe('getStatisticsBatch', () => {
    it('should return empty map for empty input', async () => {
      const result = await client.getStatisticsBatch([]);
      
      expect(result).toEqual(new Map());
      expect(mockAxiosGet).not.toHaveBeenCalled();
    });

    it('should handle successful 200 response', async () => {
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

    it('should deduplicate input IDs', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'manga-uuid-1': { follows: 100, rating: null },
          },
        },
      });

      await client.getStatisticsBatch(['manga-uuid-1', 'manga-uuid-1', 'manga-uuid-1']);

      // Should only make one request with deduplicated IDs
      expect(mockAxiosGet).toHaveBeenCalledTimes(1);
      expect(mockAxiosGet.mock.calls[0][0]).toContain('manga-uuid-1');
    });

    it('should handle 429 rate limit with Retry-After header', async () => {
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

      const promise = client.getStatisticsBatch(['test-id']);
      
      // Advance through all retry delays
      await jest.advanceTimersByTimeAsync(120000);
      
      await expect(promise).rejects.toThrow(RateLimitError);
    });

    it('should retry on 429 and succeed on subsequent attempt', async () => {
      const rateLimitError = {
        isAxiosError: true,
        response: {
          status: 429,
          headers: { 'retry-after': '1' },
        },
      };

      mockAxiosGet
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          data: {
            result: 'ok',
            statistics: {
              'test-id': { follows: 100, rating: null },
            },
          },
        });

      const promise = client.getStatisticsBatch(['test-id']);
      
      // Advance past retry delay
      await jest.advanceTimersByTimeAsync(5000);
      
      const result = await promise;
      
      expect(result.size).toBe(1);
      expect(result.get('test-id')?.follows).toBe(100);
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    it('should retry on 500 server error with exponential backoff', async () => {
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

      const promise = client.getStatisticsBatch(['test-id']);
      
      // Advance through backoff delay
      await jest.advanceTimersByTimeAsync(5000);
      
      const result = await promise;

      expect(result.size).toBe(1);
      expect(mockAxiosGet).toHaveBeenCalledTimes(2);
    });

    it('should throw StatsClientError after max retries on 500', async () => {
      const serverError = {
        isAxiosError: true,
        response: { status: 500 },
      };

      // All 4 attempts fail
      mockAxiosGet.mockRejectedValue(serverError);

      const promise = client.getStatisticsBatch(['test-id']);
      
      // Advance through all retry delays (exponential backoff)
      await jest.advanceTimersByTimeAsync(100000);
      
      await expect(promise).rejects.toThrow(StatsClientError);
      await expect(promise).rejects.toThrow(/Server error 500/);
    });

    it('should handle network errors with retry', async () => {
      const networkError = {
        isAxiosError: true,
        response: undefined,
        message: 'Network Error',
      };

      mockAxiosGet
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({
          data: {
            result: 'ok',
            statistics: {
              'test-id': { follows: 50, rating: 7.5 },
            },
          },
        });

      const promise = client.getStatisticsBatch(['test-id']);
      
      await jest.advanceTimersByTimeAsync(5000);
      
      const result = await promise;
      
      expect(result.size).toBe(1);
      expect(result.get('test-id')?.rating).toBe(7.5);
    });

    it('should handle missing rating gracefully', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { follows: 100, rating: null },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);

      expect(result.get('test-id')).toEqual({
        id: 'test-id',
        follows: 100,
        rating: null,
      });
    });

    it('should handle missing follows gracefully (defaults to 0)', async () => {
      mockAxiosGet.mockResolvedValueOnce({
        data: {
          result: 'ok',
          statistics: {
            'test-id': { rating: { bayesian: 8.0 } },
          },
        },
      });

      const result = await client.getStatisticsBatch(['test-id']);

      expect(result.get('test-id')).toEqual({
        id: 'test-id',
        follows: 0,
        rating: 8.0,
      });
    });
  });
});
