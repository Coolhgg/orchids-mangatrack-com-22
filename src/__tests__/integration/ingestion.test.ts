import { processPollSource } from '@/workers/processors/poll-source.processor';
import { processChapterIngest } from '@/workers/processors/chapter-ingest.processor';
import { prisma } from '@/lib/prisma';
import { chapterIngestQueue, notificationQueue } from '@/lib/queues';
import { scrapers } from '@/lib/scrapers';
import { Prisma } from '@prisma/client';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    seriesSource: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chapter: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    chapterSource: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    feedEntry: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
  },
}));

jest.mock('@/lib/queues', () => ({
  chapterIngestQueue: {
    addBulk: jest.fn(),
    getJobCounts: jest.fn().mockResolvedValue({ waiting: 0 }),
  },
  notificationQueue: {
    add: jest.fn(),
  },
  gapRecoveryQueue: {
    add: jest.fn(),
  },
  getNotificationSystemHealth: jest.fn().mockResolvedValue({ isCritical: false }),
}));

jest.mock('@/lib/scrapers', () => ({
  scrapers: {
    mangadex: {
      scrapeSeries: jest.fn(),
    },
  },
  validateSourceUrl: jest.fn().mockReturnValue(true),
}));

jest.mock('@/lib/rate-limiter', () => ({
  sourceRateLimiter: {
    acquireToken: jest.fn().mockResolvedValue(true),
  },
}));

jest.mock('@/lib/redis', () => ({
  withLock: jest.fn((key, ttl, cb) => cb()),
}));

describe('Ingestion Pipeline Integration - Long Source IDs', () => {
  const SERIES_ID = '00000000-0000-0000-0000-000000000001';
  const SOURCE_ID = '00000000-0000-0000-0000-000000000002';
  
  // A very long source chapter ID (4000 chars) to test the schema expansion
  const LONG_SOURCE_CHAPTER_ID = 'ch_' + 'x'.repeat(3997);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should flow long sourceChapterId from scraper through poll processor to ingest processor', async () => {
    // 1. Setup Mock Source
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
      id: SOURCE_ID,
      series_id: SERIES_ID,
      source_name: 'mangadex',
      source_id: 'manga-uuid',
      source_url: 'https://mangadex.org/title/manga-uuid',
      failure_count: 0,
      series: { id: SERIES_ID, title: 'Test Manga' },
    });

    // 2. Setup Mock Scraper Result
    (scrapers.mangadex.scrapeSeries as jest.Mock).mockResolvedValue({
      sourceId: 'manga-uuid',
      title: 'Test Manga',
      chapters: [
        {
          chapterNumber: "1.5",
          chapterTitle: 'Special Chapter',
          chapterUrl: 'https://mangadex.org/chapter/long-id-123',
          sourceChapterId: LONG_SOURCE_CHAPTER_ID,
          publishedAt: new Date('2024-01-01T00:00:00Z'),
        },
      ],
    });

    // 3. Step 1: Poll Source
    const pollJob = { id: 'poll-job-1', data: { seriesSourceId: SOURCE_ID } } as any;
    await processPollSource(pollJob);

    // Verify jobs enqueued with long ID
    expect(chapterIngestQueue.addBulk).toHaveBeenCalledWith([
      expect.objectContaining({
        data: expect.objectContaining({
          sourceChapterId: LONG_SOURCE_CHAPTER_ID,
          chapterNumber: "1.5",
        }),
      }),
    ]);

    // 4. Step 2: Ingest Chapter
    const ingestData = (chapterIngestQueue.addBulk as jest.Mock).mock.calls[0][0][0].data;
    const ingestJob = { id: 'ingest-job-1', data: ingestData } as any;

    // Setup mocks for ingestion transaction
    (prisma.chapter.upsert as jest.Mock).mockResolvedValue({ id: 'logical-ch-1' });
    (prisma.chapterSource.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.chapter.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.feedEntry.findFirst as jest.Mock).mockResolvedValue(null);

    await processChapterIngest(ingestJob);

    // 5. Verify persistence of long ID
    expect(prisma.chapterSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_chapter_id: LONG_SOURCE_CHAPTER_ID,
          chapter_id: 'logical-ch-1',
        }),
      })
    );

    expect(prisma.chapter.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_chapter_id: LONG_SOURCE_CHAPTER_ID,
          series_id: SERIES_ID,
        }),
      })
    );

    expect(notificationQueue.add).toHaveBeenCalled();
  });

  it('should correctly handle null sourceChapterId for backward compatibility', async () => {
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({
      id: SOURCE_ID,
      series_id: SERIES_ID,
      source_name: 'mangadex',
      source_id: 'manga-uuid',
      source_url: 'https://mangadex.org/title/manga-uuid',
      failure_count: 0,
      series: { id: SERIES_ID, title: 'Test Manga' },
    });

    (scrapers.mangadex.scrapeSeries as jest.Mock).mockResolvedValue({
      sourceId: 'manga-uuid',
      title: 'Test Manga',
      chapters: [
        {
          chapterNumber: "2",
          chapterUrl: 'https://mangadex.org/chapter/short-id',
          // sourceChapterId missing
        },
      ],
    });

    const pollJob = { id: 'poll-job-2', data: { seriesSourceId: SOURCE_ID } } as any;
    await processPollSource(pollJob);

    const ingestData = (chapterIngestQueue.addBulk as jest.Mock).mock.calls[0][0][0].data;
    expect(ingestData.sourceChapterId).toBeNull();

    (prisma.chapter.upsert as jest.Mock).mockResolvedValue({ id: 'logical-ch-2' });
    await processChapterIngest({ id: 'ingest-job-2', data: ingestData } as any);

    expect(prisma.chapterSource.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          source_chapter_id: null,
        }),
      })
    );
  });
});
