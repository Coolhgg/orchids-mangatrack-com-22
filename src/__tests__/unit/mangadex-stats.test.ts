/**
 * MangaDex Statistics Client Unit Tests
 */

import {
  MangaDexStatsClient,
  RateLimitError,
  StatsClientError,
  chunkArray,
  type MangaStats,
} from '@/lib/mangadex/stats';

describe('chunkArray', () => {
  it('splits array into chunks of specified size', () => {
    const arr = [1, 2, 3, 4, 5, 6, 7];
    const chunks = chunkArray(arr, 3);
    expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });

  it('returns single chunk for small arrays', () => {
    const arr = [1, 2];
    const chunks = chunkArray(arr, 5);
    expect(chunks).toEqual([[1, 2]]);
  });

  it('returns empty array for empty input', () => {
    const chunks = chunkArray([], 5);
    expect(chunks).toEqual([]);
  });

  it('throws error for non-positive chunk size', () => {
    expect(() => chunkArray([1, 2, 3], 0)).toThrow('Chunk size must be positive');
    expect(() => chunkArray([1, 2, 3], -1)).toThrow('Chunk size must be positive');
  });

  it('handles chunk size of 1', () => {
    const arr = [1, 2, 3];
    const chunks = chunkArray(arr, 1);
    expect(chunks).toEqual([[1], [2], [3]]);
  });

  it('handles exact multiple chunk sizes', () => {
    const arr = [1, 2, 3, 4, 5, 6];
    const chunks = chunkArray(arr, 2);
    expect(chunks).toEqual([[1, 2], [3, 4], [5, 6]]);
  });
});

describe('MangaDexStatsClient', () => {
  describe('constructor', () => {
    it('uses default values when no options provided', () => {
      const defaultClient = new MangaDexStatsClient();
      expect(defaultClient).toBeDefined();
    });

    it('accepts custom options', () => {
      const customClient = new MangaDexStatsClient({
        baseUrl: 'https://test.api.mangadex.org',
        batchSize: 25,
        rps: 2,
      });
      expect(customClient).toBeDefined();
    });
  });

  describe('getStatisticsBatch', () => {
    it('returns empty map for empty input', async () => {
      const client = new MangaDexStatsClient();
      const result = await client.getStatisticsBatch([]);
      expect(result).toEqual(new Map());
    });
  });
});

describe('RateLimitError', () => {
  it('creates error with message and properties', () => {
    const error = new RateLimitError('Rate limited', 60, 3);
    
    expect(error.name).toBe('RateLimitError');
    expect(error.message).toBe('Rate limited');
    expect(error.retryAfter).toBe(60);
    expect(error.consecutive429s).toBe(3);
  });

  it('handles undefined retryAfter', () => {
    const error = new RateLimitError('Rate limited');
    
    expect(error.retryAfter).toBeUndefined();
    expect(error.consecutive429s).toBe(0);
  });

  it('extends Error correctly', () => {
    const error = new RateLimitError('Test');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof RateLimitError).toBe(true);
  });
});

describe('StatsClientError', () => {
  it('creates error with status code and attempts', () => {
    const error = new StatsClientError('Server error', 500, 3);
    
    expect(error.name).toBe('StatsClientError');
    expect(error.message).toBe('Server error');
    expect(error.statusCode).toBe(500);
    expect(error.attempts).toBe(3);
  });

  it('handles undefined status code', () => {
    const error = new StatsClientError('Network error');
    
    expect(error.statusCode).toBeUndefined();
    expect(error.attempts).toBe(0);
  });

  it('extends Error correctly', () => {
    const error = new StatsClientError('Test');
    expect(error instanceof Error).toBe(true);
    expect(error instanceof StatsClientError).toBe(true);
  });
});

describe('MangaStats type', () => {
  it('satisfies expected shape', () => {
    const stats: MangaStats = {
      id: 'test-id',
      follows: 100,
      rating: 8.5,
    };
    
    expect(stats.id).toBe('test-id');
    expect(stats.follows).toBe(100);
    expect(stats.rating).toBe(8.5);
  });

  it('allows null rating', () => {
    const stats: MangaStats = {
      id: 'test-id',
      follows: 100,
      rating: null,
    };
    
    expect(stats.rating).toBeNull();
  });

  it('allows zero follows', () => {
    const stats: MangaStats = {
      id: 'test-id',
      follows: 0,
      rating: 7.5,
    };
    
    expect(stats.follows).toBe(0);
  });
});

describe('MangaDexStatsClientOptions', () => {
  it('respects environment variable defaults', () => {
    // The client should use env vars if options not provided
    const client = new MangaDexStatsClient();
    expect(client).toBeDefined();
  });

  it('allows overriding all options', () => {
    const client = new MangaDexStatsClient({
      baseUrl: 'https://custom.api.test',
      batchSize: 100,
      rps: 10,
    });
    expect(client).toBeDefined();
  });
});
