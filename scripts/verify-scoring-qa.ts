import { prisma } from '../src/lib/prisma';
import { syncChapters, ScrapedChapter } from '../src/lib/series-sync';
import { recordActivityEvent, refreshActivityScore } from '../src/lib/catalog-tiers';
import { CatalogTier, Series } from '@prisma/client';

async function verifyQA() {
  console.log('--- STARTING SCORING QA ---');

  // Cleanup/Setup
  const seriesTitle = `QA Scoring Manga ${Date.now()}`;
  const series = await prisma.series.create({
    data: {
      title: seriesTitle,
      type: 'manga',
      catalog_tier: 'C',
    }
  });
  console.log(`Created series: ${series.id}`);

  // Create two sources
  const sourceA = await prisma.seriesSource.create({
    data: {
      series_id: series.id,
      source_name: `SourceA_${Date.now()}`,
      source_id: `qa-a-${Date.now()}`,
      source_url: 'http://a.com',
    }
  });
  const sourceB = await prisma.seriesSource.create({
    data: {
      series_id: series.id,
      source_name: `SourceB_${Date.now()}`,
      source_id: `qa-b-${Date.now()}`,
      source_url: 'http://b.com',
    }
  });

  // 1. Manga gets 2 source uploads -> score increases twice
  console.log('\nScenario 1: 2 source uploads for same chapter');
  
  const chapters: ScrapedChapter[] = [{
    chapterNumber: "1",
    chapterLabel: 'Chapter 1',
    chapterUrl: 'http://a.com/1',
    publishedAt: new Date().toISOString(),
  }];

  console.log('Syncing from SourceA...');
  await syncChapters(series.id, sourceA.source_id, sourceA.source_name, chapters);
  
  let updated = await prisma.series.findUnique({ where: { id: series.id } });
  console.log(`Score after SourceA: ${updated?.activity_score}`); // Expect 15 (10 first + 5 detected)

  console.log('Syncing from SourceB...');
  await syncChapters(series.id, sourceB.source_id, sourceB.source_name, chapters);
  
  updated = await prisma.series.findUnique({ where: { id: series.id } });
  console.log(`Score after SourceB: ${updated?.activity_score}`); // Expect 20 (+5 detected)

  if (updated?.activity_score === 20) {
    console.log('✅ Scenario 1 Passed');
  } else {
    console.error(`❌ Scenario 1 Failed: Expected 20, got ${updated?.activity_score}`);
  }

  // 2. No updates for 4 weeks -> score decays
  console.log('\nScenario 2: Inactivity decay (4 weeks)');
  
  // Backdate last_activity_at
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 29); // ~4.1 weeks
  
  await prisma.series.update({
    where: { id: series.id },
    data: { last_activity_at: fourWeeksAgo }
  });
  
  await refreshActivityScore(series.id);
  
  updated = await prisma.series.findUnique({ where: { id: series.id } });
  console.log(`Score after 4 weeks inactivity: ${updated?.activity_score}`);
  // Original 20 - (4 * 5) = 0.
  
  if (updated?.activity_score === 0) {
    console.log('✅ Scenario 2 Passed');
  } else {
    console.error(`❌ Scenario 2 Failed: Expected 0, got ${updated?.activity_score}`);
  }

  // 3. User interaction increases score
  console.log('\nScenario 3: User interactions');
  
  await recordActivityEvent(series.id, 'series_followed'); // +100
  await recordActivityEvent(series.id, 'chapter_read');    // +50
  await recordActivityEvent(series.id, 'search_impression'); // +5
  
  updated = await prisma.series.findUnique({ where: { id: series.id } });
  console.log(`Score after interactions: ${updated?.activity_score}`); // Expect 155 (100+50+5)
  
  if (updated?.activity_score === 155) {
    console.log('✅ Scenario 3 Passed');
  } else {
    console.error(`❌ Scenario 3 Failed: Expected 155, got ${updated?.activity_score}`);
  }

  console.log('\n--- QA COMPLETE ---');
}

verifyQA()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
