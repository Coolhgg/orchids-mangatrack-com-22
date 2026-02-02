import { prisma } from '@/lib/prisma';
import { processChapterIngest } from '@/workers/processors/chapter-ingest.processor';

describe('Sync Logic Integration Tests', () => {
  let testSeries: any;
  let sourceA: any;
  let sourceB: any;

  beforeAll(async () => {
    // Setup test data
    testSeries = await prisma.series.create({
      data: {
        title: 'Test Series ' + Date.now(),
        type: 'manga',
      },
    });

    sourceA = await prisma.seriesSource.create({
      data: {
        series_id: testSeries.id,
        source_name: 'SourceA',
        source_id: 'src-a-' + Date.now(),
        source_url: 'https://source-a.com',
        trust_score: 1.0,
      },
    });

    sourceB = await prisma.seriesSource.create({
      data: {
        series_id: testSeries.id,
        source_name: 'SourceB',
        source_id: 'src-b-' + Date.now(),
        source_url: 'https://source-b.com',
        trust_score: 0.8,
      },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.chapterSource.deleteMany({ where: { chapter: { series_id: testSeries.id } } });
    await prisma.chapter.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.seriesSource.deleteMany({ where: { series_id: testSeries.id } });
    await prisma.series.delete({ where: { id: testSeries.id } });
  });

  test('A.1: Same chapter number from 2 sources -> One logical chapter, Two source events', async () => {
    const chapterNum = 100;

    // Ingest from Source A
    await processChapterIngest({
      id: 'job-1',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceA.id,
        chapterNumber: chapterNum,
        chapterUrl: 'https://source-a.com/ch100',
        chapterTitle: 'Chapter 100',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    // Ingest from Source B
    await processChapterIngest({
      id: 'job-2',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceB.id,
        chapterNumber: chapterNum,
        chapterUrl: 'https://source-b.com/ch100',
        chapterTitle: 'Chapter 100',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    const chapters = await prisma.chapter.findMany({
      where: { series_id: testSeries.id, chapter_number: String(chapterNum) },
      include: { sources: true },
    });

    expect(chapters).toHaveLength(1);
    expect(chapters[0].sources).toHaveLength(2);
  });

  test('A.2: Decimal chapter (1105.5) -> Separate logical chapter', async () => {
    const ch1105 = 1105;
    const ch1105_5 = 1105.5;

    await processChapterIngest({
      id: 'job-3',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceA.id,
        chapterNumber: ch1105,
        chapterUrl: 'https://source-a.com/ch1105',
        chapterTitle: 'Chapter 1105',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    await processChapterIngest({
      id: 'job-4',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceA.id,
        chapterNumber: ch1105_5,
        chapterUrl: 'https://source-a.com/ch1105.5',
        chapterTitle: 'Chapter 1105.5',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    const chapters = await prisma.chapter.findMany({
      where: { 
        series_id: testSeries.id, 
        chapter_number: { in: [String(ch1105), String(ch1105_5)] } 
      },
    });

    expect(chapters).toHaveLength(2);
  });

  test('A.3: Special / Extra chapter -> Not merged with numeric', async () => {
    const ch100 = 100;
    const chExtra = 'extra-1';

    await processChapterIngest({
      id: 'job-5',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceA.id,
        chapterNumber: ch100,
        chapterUrl: 'https://source-a.com/ch100',
        chapterTitle: 'Chapter 100',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    await processChapterIngest({
      id: 'job-6',
      data: {
        seriesId: testSeries.id,
        seriesSourceId: sourceA.id,
        chapterNumber: null,
        chapterSlug: chExtra,
        chapterUrl: 'https://source-a.com/extra1',
        chapterTitle: 'Extra 1',
        publishedAt: new Date().toISOString(),
      },
    } as any);

    const chapters = await prisma.chapter.findMany({
      where: { series_id: testSeries.id },
    });

    const ch100Rec = chapters.find(c => c.chapter_number === '100');
    const extraRec = chapters.find(c => c.chapter_slug === chExtra);

    expect(ch100Rec).toBeDefined();
    expect(extraRec).toBeDefined();
    expect(ch100Rec?.id).not.toBe(extraRec?.id);
  });
});
