import { processCheckSource } from '@/workers/processors/check-source.processor';
import { prisma } from '@/lib/prisma';
import { canonicalizeQueue } from '@/lib/queues';

jest.mock('@/lib/redis', () => ({
  redis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  },
  workerRedis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  },
}));

jest.mock('@/lib/queues', () => ({
  canonicalizeQueue: {
    add: jest.fn(),
  },
}));

jest.mock('@/lib/mangadex', () => ({
  getMangaDexHeaders: jest.fn().mockReturnValue({}),
  MANGADEX_API_BASE: 'https://api.mangadex.org',
  getMangaDexCoverUrl: jest.fn().mockReturnValue('cover-url'),
}));

jest.mock('@/lib/rate-limiter', () => ({
  sourceRateLimiter: {
    acquireToken: jest.fn().mockResolvedValue(true),
  },
}));

describe('Worker Pipeline - Check Source', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    (prisma.queryStats.upsert as jest.Mock).mockResolvedValue({ id: 'stats-1' });
    (prisma.series.findUnique as jest.Mock).mockResolvedValue(null);
    
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [],
        included: [],
        statistics: {}
      })
    }) as jest.Mock;
  });

  it('should process a search query and enqueue candidates', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        data: [
          {
            id: 'manga-1',
            type: 'manga',
            attributes: {
              title: { en: 'Solo Leveling' },
              description: { en: 'A great manga' },
              status: 'ongoing',
              contentRating: 'safe',
              tags: []
            },
            relationships: []
          }
        ],
        included: [],
        statistics: {}
      })
    });

    const mockJob = {
      id: 'job-1',
      data: {
        query: 'Solo Leveling',
        trigger: 'user_search'
      }
    } as any;

    const result = await processCheckSource(mockJob);

    expect(result.found).toBe(1);
    expect(canonicalizeQueue.add).toHaveBeenCalledWith(
      'canonicalize',
      expect.objectContaining({
        source_id: 'manga-1',
        title: 'Solo Leveling'
      }),
      expect.objectContaining({
        jobId: 'canon_mangadex_manga-1'
      })
    );
  });

  it('should handle missing search term by falling back to series title', async () => {
    (prisma.series.findUnique as jest.Mock).mockResolvedValue({ title: 'Fallback Title' });
    
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({ data: [], included: [] })
    });

    const mockJob = {
      id: 'job-2',
      data: {
        series_id: 'series-uuid',
        trigger: 'system_sync'
      }
    } as any;

    await processCheckSource(mockJob);

    expect(prisma.series.findUnique).toHaveBeenCalledWith({
      where: { id: 'series-uuid' },
      select: { title: true }
    });
  });
});
