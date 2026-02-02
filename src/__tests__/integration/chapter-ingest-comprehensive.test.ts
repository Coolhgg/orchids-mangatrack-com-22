import { processChapterIngest, ChapterIngestData } from '@/workers/processors/chapter-ingest.processor';
import { prisma, withRetry, isTransientError } from '@/lib/prisma';
import { withLock } from '@/lib/redis';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    seriesSource: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chapter: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    chapterSource: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    legacyChapter: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    feedEntry: {
      findFirst: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
    libraryEntry: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
    $executeRaw: jest.fn(),
  },
  withRetry: jest.fn((fn) => fn()),
  isTransientError: jest.fn(() => false),
}));

jest.mock('@/lib/redis', () => ({
  withLock: jest.fn((key: string, timeout: number, fn: () => Promise<any>) => fn()),
  redisApi: {
    pipeline: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
  },
  REDIS_KEY_PREFIX: 'test:',
}));

jest.mock('@/lib/queues', () => ({
  notificationQueue: { add: jest.fn() },
  gapRecoveryQueue: { add: jest.fn() },
  feedFanoutQueue: { add: jest.fn() },
}));

jest.mock('@/lib/notifications-timing', () => ({
  scheduleNotification: jest.fn(),
}));

jest.mock('@/lib/catalog-tiers', () => ({
  promoteSeriesTier: jest.fn(),
}));

jest.mock('@/lib/audit-pass3-fixes', () => ({
  validateJobPayload: jest.fn(),
  createLogContext: jest.fn(() => ({})),
  formatStructuredLog: jest.fn((level, msg) => `[${level}] ${msg}`),
  logStateTransition: jest.fn(),
  classifySyncError: jest.fn((e) => ({ errorType: 'unknown', retryable: false, message: e.message })),
  addToDeadLetterQueue: jest.fn(),
  getWorkerRunId: jest.fn(() => 'test-run-id'),
}));

describe('Chapter Ingest Processor - Comprehensive Tests', () => {
  const validJobData: ChapterIngestData = {
    seriesSourceId: '550e8400-e29b-41d4-a716-446655440001',
    seriesId: '550e8400-e29b-41d4-a716-446655440000',
    chapterNumber: 42,
    chapterTitle: 'The Beginning',
    chapterUrl: 'https://example.com/chapter/42',
    publishedAt: '2024-01-15T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
      const tx = {
        seriesSource: prisma.seriesSource,
        chapter: prisma.chapter,
        chapterSource: prisma.chapterSource,
        legacyChapter: prisma.legacyChapter,
        feedEntry: prisma.feedEntry,
        $executeRaw: prisma.$executeRaw,
      };
      return fn(tx);
    });
  });

  describe('Payload Validation', () => {
    it('should reject job with invalid UUID', async () => {
      const mockJob = {
        id: 'job-1',
        data: {
          ...validJobData,
          seriesId: 'not-a-uuid',
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await expect(processChapterIngest(mockJob)).rejects.toThrow('Invalid job payload');
    });

    it('should reject job with invalid chapter URL', async () => {
      const mockJob = {
        id: 'job-2',
        data: {
          ...validJobData,
          chapterUrl: 'not-a-url',
        },
        attemptsMade: 0,
        opts: { attempts: 3 },
      } as any;

      await expect(processChapterIngest(mockJob)).rejects.toThrow('Invalid job payload');
    });

    it('should handle null chapterNumber gracefully', async () => {
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
        source_name: 'MangaDex',
        series: { id: validJobData.seriesId },
      });
      
      (prisma.chapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapter.upsert as jest.Mock).mockResolvedValue({
        id: 'chapter-uuid',
        chapter_number: '-1',
      });
      (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapterSource.create as jest.Mock).mockResolvedValue({ id: 'source-uuid' });
      (prisma.legacyChapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.legacyChapter.create as jest.Mock).mockResolvedValue({});
      (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.feedEntry.upsert as jest.Mock).mockResolvedValue({});
      (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([]);

      const mockJob = {
        id: 'job-3',
        data: {
          ...validJobData,
          chapterNumber: null,
        },
        attemptsMade: 0,
      } as any;

      await expect(processChapterIngest(mockJob)).resolves.not.toThrow();
      
      expect(prisma.chapter.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            series_id_chapter_number: expect.objectContaining({
              chapter_number: '-1',
            }),
          }),
        })
      );
    });
  });

  describe('Idempotency', () => {
    it('should update existing chapter source instead of creating duplicate', async () => {
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
        source_name: 'MangaDex',
        series: { id: validJobData.seriesId },
      });
      
      (prisma.chapter.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-chapter',
        chapter_number: '42',
      });
      (prisma.chapter.upsert as jest.Mock).mockResolvedValue({
        id: 'existing-chapter',
        chapter_number: '42',
      });
      
      (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue({
        id: 'existing-source',
        detected_at: new Date('2024-01-01'),
      });
      (prisma.chapterSource.update as jest.Mock).mockResolvedValue({ id: 'existing-source' });
      
      (prisma.legacyChapter.findUnique as jest.Mock).mockResolvedValue({ id: 'legacy-1' });
      (prisma.legacyChapter.update as jest.Mock).mockResolvedValue({});
      (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue({
        id: 'feed-1',
        sources: [{ name: 'OtherSource', url: 'url', discovered_at: new Date().toISOString() }],
      });
      (prisma.feedEntry.update as jest.Mock).mockResolvedValue({});
      (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([]);

      const mockJob = {
        id: 'job-4',
        data: validJobData,
        attemptsMade: 0,
      } as any;

      await processChapterIngest(mockJob);

      expect(prisma.chapterSource.update).toHaveBeenCalled();
      expect(prisma.chapterSource.create).not.toHaveBeenCalled();
    });
  });

  describe('Distributed Locking', () => {
    it('should acquire lock with correct key format', async () => {
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
        source_name: 'MangaDex',
        series: { id: validJobData.seriesId },
      });
      
      (prisma.chapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapter.upsert as jest.Mock).mockResolvedValue({ id: 'new-chapter', chapter_number: '42' });
      (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapterSource.create as jest.Mock).mockResolvedValue({ id: 'new-source' });
      (prisma.legacyChapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.legacyChapter.create as jest.Mock).mockResolvedValue({});
      (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.feedEntry.upsert as jest.Mock).mockResolvedValue({});
      (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([]);

      const mockJob = {
        id: 'job-5',
        data: validJobData,
        attemptsMade: 0,
      } as any;

      await processChapterIngest(mockJob);

      expect(withLock).toHaveBeenCalledWith(
        `ingest:${validJobData.seriesId}:42`,
        30000,
        expect.any(Function)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle missing series source gracefully', async () => {
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue(null);

      const mockJob = {
        id: 'job-6',
        data: validJobData,
        attemptsMade: 0,
      } as any;

      await expect(processChapterIngest(mockJob)).resolves.toBeUndefined();
    });

    it('should handle series source with no associated series', async () => {
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
        source_name: 'MangaDex',
        series: null,
      });

      const mockJob = {
        id: 'job-7',
        data: validJobData,
        attemptsMade: 0,
      } as any;

      await expect(processChapterIngest(mockJob)).resolves.toBeUndefined();
    });
  });

  describe('Feed Cache Invalidation', () => {
    it('should invalidate cache for all followers', async () => {
      const { redisApi } = require('@/lib/redis');
      const mockPipeline = {
        incr: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };
      redisApi.pipeline.mockReturnValue(mockPipeline);

      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
        source_name: 'MangaDex',
        series: { id: validJobData.seriesId },
      });
      (prisma.chapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapter.upsert as jest.Mock).mockResolvedValue({ id: 'chapter-1', chapter_number: '42' });
      (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.chapterSource.create as jest.Mock).mockResolvedValue({ id: 'source-1' });
      (prisma.legacyChapter.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.legacyChapter.create as jest.Mock).mockResolvedValue({});
      (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue(null);
      (prisma.feedEntry.upsert as jest.Mock).mockResolvedValue({});
      
      (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([
        { user_id: 'user-1' },
        { user_id: 'user-2' },
        { user_id: 'user-3' },
      ]);

      const mockJob = {
        id: 'job-8',
        data: validJobData,
        attemptsMade: 0,
      } as any;

      await processChapterIngest(mockJob);

      expect(mockPipeline.incr).toHaveBeenCalledTimes(3);
      expect(mockPipeline.exec).toHaveBeenCalled();
    });
  });
});

describe('Prisma Utilities', () => {
  describe('isTransientError', () => {
    it('should identify connection errors as transient', () => {
      const { isTransientError: realIsTransient } = jest.requireActual('@/lib/prisma');
      
      const connectionError = new Error("Can't reach database server");
      expect(realIsTransient(connectionError)).toBe(true);
    });

    it('should not identify auth errors as transient', () => {
      const { isTransientError: realIsTransient } = jest.requireActual('@/lib/prisma');
      
      const authError = new Error('password authentication failed');
      expect(realIsTransient(authError)).toBe(false);
    });
  });
});
