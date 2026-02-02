/**
 * Search Utils Integration Tests
 * 
 * Tests the search utility functions including:
 * - Query normalization
 * - External search enqueue rules
 * - Intent recording
 * - Edge cases
 */

import { 
  normalizeSearchQuery, 
  shouldEnqueueExternalSearch, 
  recordSearchIntent,
  markQueryEnqueued,
  markQueryResolved,
  markQueryDeferred,
  SEARCH_QUEUE_HEALTH_THRESHOLD
} from '@/lib/search-utils';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    queryStats: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  },
}));

jest.mock('@/lib/queues', () => ({
  isQueueHealthy: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    sadd: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
  },
  REDIS_KEY_PREFIX: 'test:',
}));

import { prisma } from '@/lib/prisma';
import { isQueueHealthy } from '@/lib/queues';
import { redis } from '@/lib/redis';

describe('normalizeSearchQuery', () => {
  it('should lowercase the query', () => {
    expect(normalizeSearchQuery('ONE PIECE')).toBe('one piece');
    expect(normalizeSearchQuery('Naruto')).toBe('naruto');
  });

  it('should trim whitespace', () => {
    expect(normalizeSearchQuery('  naruto  ')).toBe('naruto');
    expect(normalizeSearchQuery('\tbleach\n')).toBe('bleach');
  });

  it('should collapse multiple spaces', () => {
    expect(normalizeSearchQuery('one   piece')).toBe('one piece');
    expect(normalizeSearchQuery('my  hero  academia')).toBe('my hero academia');
  });

  it('should remove diacritics', () => {
    expect(normalizeSearchQuery('café')).toBe('cafe');
    expect(normalizeSearchQuery('naïve')).toBe('naive');
    expect(normalizeSearchQuery('résumé')).toBe('resume');
  });

  it('should remove non-alphanumeric characters', () => {
    expect(normalizeSearchQuery('one-piece!')).toBe('onepiece');
    expect(normalizeSearchQuery("jojo's bizarre adventure")).toBe('jojos bizarre adventure');
    expect(normalizeSearchQuery('attack on titan (2013)')).toBe('attack on titan 2013');
  });

  it('should handle empty string', () => {
    expect(normalizeSearchQuery('')).toBe('');
  });

  it('should handle special characters only', () => {
    expect(normalizeSearchQuery('!@#$%')).toBe('');
  });

  it('should handle unicode characters', () => {
    expect(normalizeSearchQuery('進撃の巨人')).toBe(''); // Non-latin removed
    expect(normalizeSearchQuery('manga 漫画')).toBe('manga');
  });

  it('should handle numbers', () => {
    expect(normalizeSearchQuery('chapter 100')).toBe('chapter 100');
    expect(normalizeSearchQuery('2001 a space odyssey')).toBe('2001 a space odyssey');
  });
});

describe('shouldEnqueueExternalSearch', () => {
  const mockQueue = {
    getJob: jest.fn(),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (isQueueHealthy as jest.Mock).mockResolvedValue(true);
  });

  it('should not enqueue when queue is unhealthy', async () => {
    (isQueueHealthy as jest.Mock).mockResolvedValue(false);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('queue_unhealthy');
  });

  it('should not enqueue when query is already resolved', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: true,
      total_searches: 10,
      unique_users: 5,
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('resolved');
  });

  it('should not enqueue when below threshold (new query)', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue(null);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('below_threshold');
  });

  it('should not enqueue when below threshold (low searches)', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 1,
      unique_users: 1,
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('below_threshold');
  });

  it('should enqueue when threshold met (total_searches >= 2)', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 2,
      unique_users: 1,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue(null);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(true);
  });

  it('should enqueue when threshold met (unique_users >= 2)', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 1,
      unique_users: 2,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue(null);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(true);
  });

  it('should not enqueue during cooldown period (30s)', async () => {
    const now = new Date();
    const twentySecondsAgo = new Date(now.getTime() - 20 * 1000);
    
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 5,
      unique_users: 3,
      last_enqueued_at: twentySecondsAgo,
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('cooldown');
  });

  it('should enqueue after cooldown period expires', async () => {
    const now = new Date();
    const thirtyFiveSecondsAgo = new Date(now.getTime() - 35 * 1000);
    
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 5,
      unique_users: 3,
      last_enqueued_at: thirtyFiveSecondsAgo,
    });
    mockQueue.getJob.mockResolvedValue(null);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(true);
  });

  it('should not enqueue when active job exists', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 5,
      unique_users: 3,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('active'),
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('active_job');
  });

  it('should not enqueue when waiting job exists', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 5,
      unique_users: 3,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('waiting'),
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(false);
    expect(result.reason).toBe('active_job');
  });

  it('should enqueue when job is completed', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 5,
      unique_users: 3,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue({
      getState: jest.fn().mockResolvedValue('completed'),
    });
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue);
    
    expect(result.shouldEnqueue).toBe(true);
  });

  it('should bypass threshold for admin/system requests', async () => {
    (prisma.queryStats.findUnique as jest.Mock).mockResolvedValue({
      resolved: false,
      total_searches: 0,
      unique_users: 0,
      last_enqueued_at: null,
    });
    mockQueue.getJob.mockResolvedValue(null);
    
    const result = await shouldEnqueueExternalSearch('test query', mockQueue, { isAdminOrSystem: true });
    
    expect(result.shouldEnqueue).toBe(true);
  });
});

describe('recordSearchIntent', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.queryStats.upsert as jest.Mock).mockResolvedValue({});
  });

  it('should record search for anonymous user', async () => {
    await recordSearchIntent('test query');
    
    expect(prisma.queryStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { normalized_key: 'test query' },
        create: expect.objectContaining({
          normalized_key: 'test query',
          total_searches: 1,
          unique_users: 0,
          deferred: false,
        }),
      })
    );
  });

  it('should track unique user via Redis', async () => {
    (redis.sadd as jest.Mock).mockResolvedValue(1); // New user
    
    await recordSearchIntent('test query', 'user-123');
    
    expect(redis.sadd).toHaveBeenCalledWith('test:query:users:test query', 'user-123');
    expect(redis.expire).toHaveBeenCalled();
    expect(prisma.queryStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          total_searches: { increment: 1 },
          unique_users: { increment: 1 },
        }),
      })
    );
  });

  it('should not increment unique_users for returning user', async () => {
    (redis.sadd as jest.Mock).mockResolvedValue(0); // Returning user
    
    await recordSearchIntent('test query', 'user-123');
    
    expect(prisma.queryStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          total_searches: { increment: 1 },
          unique_users: undefined,
        }),
      })
    );
  });
});

describe('markQueryEnqueued', () => {
  it('should update last_enqueued_at timestamp', async () => {
    (prisma.queryStats.update as jest.Mock).mockResolvedValue({});
    
    await markQueryEnqueued('test query');
    
    expect(prisma.queryStats.update).toHaveBeenCalledWith({
      where: { normalized_key: 'test query' },
      data: { last_enqueued_at: expect.any(Date) },
    });
  });
});

describe('markQueryResolved', () => {
  it('should upsert with resolved=true', async () => {
    (prisma.queryStats.upsert as jest.Mock).mockResolvedValue({});
    
    await markQueryResolved('test query');
    
    expect(prisma.queryStats.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { normalized_key: 'test query' },
        update: { resolved: true },
      })
    );
  });
});

describe('markQueryDeferred', () => {
  it('should update deferred=true', async () => {
    (prisma.queryStats.update as jest.Mock).mockResolvedValue({});
    
    await markQueryDeferred('test query');
    
    expect(prisma.queryStats.update).toHaveBeenCalledWith({
      where: { normalized_key: 'test query' },
      data: { deferred: true },
    });
  });
});

describe('Constants', () => {
  it('should have correct search queue health threshold', () => {
    expect(SEARCH_QUEUE_HEALTH_THRESHOLD).toBe(5000);
  });
});
