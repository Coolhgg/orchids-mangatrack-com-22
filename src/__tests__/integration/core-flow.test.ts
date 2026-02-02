/**
 * @jest-environment node
 */
import { prisma } from '@/lib/prisma';
import { processChapterIngest } from '@/workers/processors/chapter-ingest.processor';
import { Prisma } from '@prisma/client';

// Mock Queues
jest.mock('@/lib/queues', () => ({
  notificationQueue: { add: jest.fn() },
  gapRecoveryQueue: { add: jest.fn() },
}));

// Mock Redis Locks
jest.mock('@/lib/redis', () => ({
  withLock: jest.fn().mockImplementation((key, ttl, fn) => fn()),
  redisApi: {
    pipeline: jest.fn().mockReturnValue({
      incr: jest.fn(),
      exec: jest.fn().mockResolvedValue([]),
    }),
  },
  REDIS_KEY_PREFIX: 'test:',
}));

describe('Core Flow Integration Test', () => {
  let testUser: any;
  let testSeries: any;
  let testSource: any;

  beforeAll(async () => {
    // 1. Setup Test Data with unique email to avoid constraint issues during parallel runs
    const uniqueEmail = `core-tester-${Date.now()}@example.com`;
    
    testUser = await prisma.user.create({
      data: {
        email: uniqueEmail,
        username: `tester_${Math.random().toString(36).slice(2, 7)}`,
        password_hash: 'test',
      }
    });

    testSeries = await prisma.series.create({
      data: {
        title: 'Core Flow Test Manga',
        type: 'manga',
        status: 'ongoing',
      }
    });

    testSource = await prisma.seriesSource.create({
      data: {
        series_id: testSeries.id,
        source_name: 'test-source',
        source_id: 'test-123',
        source_url: 'https://example.com/manga/test-123',
      }
    });

    await prisma.libraryEntry.create({
      data: {
        user_id: testUser.id,
        series_id: testSeries.id,
        source_url: 'https://example.com/manga/test-123',
        source_name: 'test-source',
        status: 'reading',
      }
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.feedEntry.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.chapterSource.deleteMany({ where: { series_source_id: testSource.id } });
    await prisma.chapter.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.chapter.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.libraryEntry.deleteMany({ where: { user_id: testUser.id } });
    await prisma.seriesSource.deleteMany({ where: { id: testSource.id } });
    await prisma.series.delete({ where: { id: testSeries.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  test('Should process chapter ingestion and update feed correctly', async () => {
    const chapterData = {
      seriesSourceId: testSource.id,
      seriesId: testSeries.id,
      chapterNumber: "1",
      chapterTitle: 'Chapter One',
      chapterUrl: 'https://example.com/manga/test-123/1',
      sourceChapterId: 'ch-1',
      publishedAt: new Date().toISOString(),
      traceId: 'test-trace-id',
    };

    // 2. Execute Ingestion
    // @ts-expect-error - Job type is mocked
    await processChapterIngest({ id: 'test-job-id', data: chapterData });

    // 3. Verify Logical Chapter Creation
    const chapter = await prisma.chapter.findFirst({
      where: { series_id: testSeries.id, chapter_number: "1" },
      include: { sources: true }
    });
    expect(chapter).toBeDefined();
    expect(chapter?.chapter_title?.toLowerCase()).toBe('chapter one');

    // 4. Verify Feed Entry
    const feedEntry = await prisma.feedEntry.findFirst({
      where: { series_id: testSeries.id, chapter_number: new Prisma.Decimal(1) }
    });
    expect(feedEntry).toBeDefined();
    const sources = feedEntry?.sources as any[];
    expect(sources).toHaveLength(1);
    expect(sources[0].name).toBe('test-source');

    // 5. Verify Chapter Source (replaces legacy chapter)
    const chapterSource = chapter?.sources[0];
    expect(chapterSource).toBeDefined();
    expect(chapterSource?.source_chapter_url).toBe(chapterData.chapterUrl);
  });

  test('Should batch multiple sources for the same chapter in feed', async () => {
    // Add second source
    const testSource2 = await prisma.seriesSource.create({
      data: {
        series_id: testSeries.id,
        source_name: 'test-source-2',
        source_id: 'test-456',
        source_url: 'https://example.com/manga/test-456',
      }
    });

    const chapterData2 = {
      seriesSourceId: testSource2.id,
      seriesId: testSeries.id,
      chapterNumber: "1",
      chapterTitle: 'Chapter One (Source 2)',
      chapterUrl: 'https://example.com/manga/test-456/1',
      sourceChapterId: 'ch-1-s2',
      publishedAt: new Date().toISOString(),
      traceId: 'test-trace-id-2',
    };

    // @ts-expect-error - Job type is mocked
    await processChapterIngest({ id: 'test-job-id-2', data: chapterData2 });

    const feedEntry = await prisma.feedEntry.findFirst({
      where: { series_id: testSeries.id, chapter_number: new Prisma.Decimal(1) }
    });
    
    const sources = feedEntry?.sources as any[];
    expect(sources).toHaveLength(2);
    expect(sources.map(s => s.name)).toContain('test-source');
    expect(sources.map(s => s.name)).toContain('test-source-2');

    // Cleanup second source
    await prisma.chapterSource.deleteMany({ where: { series_source_id: testSource2.id } });
    await prisma.seriesSource.delete({ where: { id: testSource2.id } });
  });
});
