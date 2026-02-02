import { prisma } from '@/lib/prisma';
import { processChapterIngest } from '@/workers/processors/chapter-ingest.processor';
import { processNotificationDelivery } from '@/workers/processors/notification-delivery.processor';
import { Job } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

jest.mock('@/lib/redis', () => ({
  redis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
    keys: jest.fn().mockResolvedValue([]),
    mget: jest.fn().mockResolvedValue([]),
  },
  workerRedis: { 
    get: jest.fn().mockResolvedValue(null), 
    set: jest.fn(), 
    del: jest.fn(),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn(),
  },
  withLock: jest.fn().mockImplementation(async (_key: string, _ttl: number, fn: () => Promise<any>) => fn()),
}));

jest.mock('@/lib/queues', () => ({
  chapterIngestQueue: { add: jest.fn() },
  feedFanoutQueue: { add: jest.fn() },
  notificationDeliveryQueue: { add: jest.fn(), getWaitingCount: jest.fn().mockResolvedValue(0), getActiveCount: jest.fn().mockResolvedValue(0) },
  gapRecoveryQueue: { add: jest.fn() },
  isQueueHealthy: jest.fn().mockResolvedValue(true),
  getQueueHealth: jest.fn().mockResolvedValue({ isOverloaded: false, isRejected: false, totalWaiting: 0 }),
  getNotificationSystemHealth: jest.fn().mockResolvedValue({ isOverloaded: false, isRejected: false, isCritical: false, totalWaiting: 0 }),
}));

jest.mock('@/lib/notifications-throttling', () => ({
  shouldThrottleUser: jest.fn().mockResolvedValue(false),
}));

describe('Worker Safety & Idempotency Integration Tests', () => {
  const testUserId = uuidv4();
  const testSeriesId = uuidv4();
  const testSourceId = uuidv4();
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    (prisma.user.create as jest.Mock).mockResolvedValue({ 
      id: testUserId, 
      email: 'test@example.com',
      username: 'testuser' 
    });
    (prisma.series.create as jest.Mock).mockResolvedValue({ 
      id: testSeriesId, 
      title: 'Test Series',
      type: 'manga' 
    });
    (prisma.seriesSource.create as jest.Mock).mockResolvedValue({ 
      id: testSourceId,
      series_id: testSeriesId,
      source_id: 'test-source',
      source_url: 'https://example.com/test',
      source_name: 'test',
      source_chapter_count: 0,
    });
  });

  test('Chapter Ingestion should be idempotent and not double-count sources', async () => {
    (prisma.seriesSource.findUnique as jest.Mock).mockImplementation(() => 
      Promise.resolve({ 
        id: testSourceId, 
        series_id: testSeriesId,
        source_chapter_count: 0,
        source_name: 'test',
        series: { id: testSeriesId, title: 'Test Series' },
      })
    );
    
    (prisma.chapter.findMany as jest.Mock).mockResolvedValue([]);
    
    const jobData = {
      seriesSourceId: testSourceId,
      seriesId: testSeriesId,
      chapterNumber: 1,
      chapterTitle: 'Chapter 1',
      chapterUrl: 'https://example.com/test/1',
      publishedAt: new Date().toISOString(),
    };

    const mockJob = { id: 'test-job-1', data: jobData } as Job;

    // First call should succeed
    await expect(processChapterIngest(mockJob)).resolves.not.toThrow();
    
    // Second call should also succeed (idempotent)
    await expect(processChapterIngest(mockJob)).resolves.not.toThrow();
  });

  test('Notification Delivery should be idempotent per user/chapter', async () => {
    const notifications: any[] = [];
    
    (prisma.series.findUnique as jest.Mock).mockResolvedValue({ 
      id: testSeriesId, 
      title: 'Test Series',
      last_chapter_at: new Date(),
    });
    
    (prisma.notification.findMany as jest.Mock).mockImplementation(() => 
      Promise.resolve(notifications.map(n => ({ user_id: n.user_id, priority: n.priority, id: n.id })))
    );
    
    (prisma.notification.createMany as jest.Mock).mockImplementation(({ data }) => {
      const newOnes = data.filter((d: any) => 
        !notifications.some(n => n.user_id === d.user_id && n.metadata?.chapter_number === d.metadata?.chapter_number)
      );
      notifications.push(...newOnes.map((d: any) => ({ ...d, id: uuidv4() })));
      return Promise.resolve({ count: newOnes.length });
    });
    
    (prisma.notification.count as jest.Mock).mockImplementation(() => 
      Promise.resolve(notifications.length)
    );

    const jobData = {
      seriesId: testSeriesId,
      sourceId: testSourceId,
      sourceName: 'test',
      chapterNumber: 1,
      newChapterCount: 1,
      userIds: [testUserId],
      isPremium: false,
      priority: 2,
    };

    const mockJob = { id: 'test-notify-1', data: jobData } as Job;

    await processNotificationDelivery(mockJob);
    
    expect(notifications.length).toBe(1);

    await processNotificationDelivery(mockJob);
    
    expect(notifications.length).toBe(1);
  });
});
