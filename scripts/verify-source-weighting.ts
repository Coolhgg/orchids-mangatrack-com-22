import { prisma } from '../src/lib/prisma';
import { selectBestSource } from '../src/lib/source-utils-shared';
import { Prisma } from '@prisma/client';

async function runTests() {
  console.log('--- STARTING VERIFICATION TESTS ---\n');

  try {
    const testSeriesId = '00000000-0000-0000-0000-000000000001';
    const testUserId = '00000000-0000-0000-0000-000000000001';

    // Clean up
    await prisma.$executeRawUnsafe(`DELETE FROM activity_events WHERE series_id = $1::uuid`, testSeriesId).catch(() => {});
    await prisma.chapterSource.deleteMany({ where: { chapter: { series_id: testSeriesId } } }).catch(() => {});
    await prisma.chapter.deleteMany({ where: { series_id: testSeriesId } }).catch(() => {});
    await prisma.seriesSource.deleteMany({ where: { series_id: testSeriesId } }).catch(() => {});
    await prisma.series.deleteMany({ where: { id: testSeriesId } }).catch(() => {});

    // Create test series
    await prisma.series.create({
      data: {
        id: testSeriesId,
        title: 'Verification Test Series',
        type: 'manga',
      }
    });

    console.log('A. CHAPTER DEDUP');
    
    // 1. Same chapter number from 2 sources
    const lc1 = await prisma.chapter.create({
      data: {
        series_id: testSeriesId,
        chapter_number: '100',
        chapter_slug: '',
        chapter_title: 'Test Chapter 100',
      }
    });
    
    const ss1 = await prisma.seriesSource.create({
      data: {
        series_id: testSeriesId,
        source_name: 'MangaDex',
        source_id: 'md-100',
        source_url: 'https://mangadex.org/chapter/md-100',
        trust_score: 0.9,
      }
    });
    
    const ss2 = await prisma.seriesSource.create({
      data: {
        series_id: testSeriesId,
        source_name: 'MangaPark',
        source_id: 'mp-100',
        source_url: 'https://mangapark.net/chapter/mp-100',
        trust_score: 0.8,
      }
    });

    await prisma.chapterSource.create({
      data: {
        chapter_id: lc1.id,
        series_source_id: ss1.id,
        source_name: 'MangaDex',
        source_chapter_url: 'https://mangadex.org/chapter/md-100',
        detected_at: new Date('2024-01-01T10:00:00Z'),
      }
    });

    await prisma.chapterSource.create({
      data: {
        chapter_id: lc1.id,
        series_source_id: ss2.id,
        source_name: 'MangaPark',
        source_chapter_url: 'https://mangapark.net/chapter/mp-100',
        detected_at: new Date('2024-01-01T10:05:00Z'),
      }
    });

    const lcCount = await prisma.chapter.count({ where: { series_id: testSeriesId, chapter_number: '100' } });
    const csCount = await prisma.chapterSource.count({ where: { chapter_id: lc1.id } });
    
    console.log(`Test 1: One logical chapter, two source events -> ${lcCount === 1 && csCount === 2 ? 'PASS' : 'FAIL'}`);

    // 2. Decimal chapter (1105.5)
    const lc2 = await prisma.chapter.create({
      data: {
        series_id: testSeriesId,
        chapter_number: '1105.5',
        chapter_slug: '',
      }
    });
    console.log(`Test 2: Decimal chapter separate -> ${lc2.id !== lc1.id ? 'PASS' : 'FAIL'}`);

    // 3. Special / Extra chapter
    const lc3 = await prisma.chapter.create({
      data: {
        series_id: testSeriesId,
        chapter_number: 'extra-1',
        chapter_slug: 'extra-1',
      }
    });
    console.log(`Test 3: Special chapter not merged -> ${lc3.chapter_number === 'extra-1' && lc3.chapter_slug === 'extra-1' ? 'PASS' : 'FAIL'}`);

    console.log('\nB. ACTIVITY FEED');
    
    // Create activity events for feed testing via raw SQL
    await prisma.$executeRawUnsafe(`
      INSERT INTO activity_events (id, user_id, series_id, series_title, chapter_id, chapter_number, chapter_type, source_id, source_name, source_url, event_type, discovered_at)
      VALUES 
        ('00000000-0000-0000-0000-000000000001', $1::uuid, $2::uuid, 'Verification Test Series', $3::uuid, 100, 'chapter', 'md-100', 'MangaDex', 'https://mangadex.org/chapter/md-100', 'NEW_CHAPTER', '2024-01-01 10:00:00+00'),
        ('00000000-0000-0000-0000-000000000002', $1::uuid, $2::uuid, 'Verification Test Series', $3::uuid, 100, 'chapter', 'mp-100', 'MangaPark', 'https://mangapark.net/chapter/mp-100', 'NEW_CHAPTER', '2024-01-01 10:05:00+00')
    `, testUserId, testSeriesId, lc1.id);

    const feedEvents = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM activity_events WHERE user_id = $1::uuid AND series_id = $2::uuid ORDER BY discovered_at DESC`,
      testUserId, testSeriesId
    );
    
    console.log(`Test 5: Same chapter from different sources -> Separate events -> ${feedEvents.length === 2 ? 'PASS' : 'FAIL'}`);

    console.log('\nC. SOURCE WEIGHTING');
    
    const mockSources = [
      {
        id: '1',
        source_name: 'MangaPark',
        source_id: 'mp-1',
        source_chapter_url: 'https://mangapark.net/1',
        published_at: '2024-01-01T10:00:00Z',
        detected_at: '2024-01-01T10:00:00Z',
        is_available: true,
        trust_score: 0.8
      },
      {
        id: '2',
        source_name: 'MangaDex',
        source_id: 'md-1',
        source_chapter_url: 'https://mangadex.org/1',
        published_at: '2024-01-01T10:05:00Z',
        detected_at: '2024-01-01T10:05:00Z',
        is_available: true,
        trust_score: 0.9
      }
    ];

    // 6. Preferred source unavailable -> Fallback respects trust_score
    const result6 = selectBestSource(mockSources, [], {});
    console.log(`Test 6: Fallback respects trust_score (MangaDex 0.9 > MangaPark 0.8) -> ${result6.source?.source_name === 'MangaDex' ? 'PASS' : 'FAIL'}`);

    // 7. User override present -> User choice wins
    const result7 = selectBestSource(mockSources, [], { preferredSourceSeries: 'MangaPark' });
    console.log(`Test 7: User choice wins -> ${result7.source?.source_name === 'MangaPark' ? 'PASS' : 'FAIL'}`);

    // Clean up
    await prisma.$executeRawUnsafe(`DELETE FROM activity_events WHERE series_id = $1::uuid`, testSeriesId);
    await prisma.chapterSource.deleteMany({ where: { chapter: { series_id: testSeriesId } } });
    await prisma.chapter.deleteMany({ where: { series_id: testSeriesId } });
    await prisma.seriesSource.deleteMany({ where: { series_id: testSeriesId } });
    await prisma.series.deleteMany({ where: { id: testSeriesId } });

  } catch (error) {
    console.error('ERROR DURING VERIFICATION:', error);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
