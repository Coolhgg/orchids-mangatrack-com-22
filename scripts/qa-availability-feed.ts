
import { PrismaClient } from '@prisma/client';
import { PRODUCTION_QUERIES } from '../src/lib/sql/production-queries';

const prisma = new PrismaClient();

async function runQA() {
  console.log('--- QA: Activity Feed Weighting ---');

  // 1. Cleanup & Setup
  const seriesId = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
  
  // Cleanup previous runs
  await prisma.$executeRaw`DELETE FROM activities WHERE series_id = ${seriesId}::uuid`;
  await prisma.$executeRaw`DELETE FROM chapter_sources WHERE chapter_id IN (SELECT id FROM chapters WHERE series_id = ${seriesId}::uuid)`;
  await prisma.$executeRaw`DELETE FROM chapters WHERE series_id = ${seriesId}::uuid`;
  await prisma.$executeRaw`DELETE FROM series_sources WHERE series_id = ${seriesId}::uuid`;
  await prisma.$executeRaw`DELETE FROM series WHERE id = ${seriesId}::uuid`;

  const testUser = await prisma.user.upsert({
    where: { email: 'qa@test.com' },
    update: { username: 'qa_user' },
    create: { email: 'qa@test.com', username: 'qa_user' }
  });
  const actualUserId = testUser.id;

  await prisma.series.create({
    data: { id: seriesId, title: 'QA Test Series', type: 'manga' }
  });

  const ss1 = await prisma.seriesSource.create({
    data: { series_id: seriesId, source_name: 'source_a', source_id: 'sa1', source_url: 'http://a.com' }
  });
  const ss2 = await prisma.seriesSource.create({
    data: { series_id: seriesId, source_name: 'source_b', source_id: 'sb1', source_url: 'http://b.com' }
  });

  const now = new Date('2030-01-01T12:00:00Z');
  const t0 = new Date(now.getTime() - 300000); // 5 mins ago
  const t1 = new Date(now.getTime() - 200000); // 3 mins ago
  const t2 = new Date(now.getTime() - 100000); // 1 min ago

  console.log('\nCreating Test Events...');
  console.log(`T0: ${t0.toISOString()} (Chapter Source A - New)`);
  console.log(`T1: ${t1.toISOString()} (Chapter Source B - Additional)`);
  console.log(`T2: ${t2.toISOString()} (Metadata Update)`);

  const chapter1 = await prisma.chapter.create({
    data: { series_id: seriesId, chapter_number: "999", first_detected_at: t0 }
  });

await prisma.chapterSource.create({
      data: { chapter_id: chapter1.id, series_source_id: ss1.id, source_name: 'source_a', source_chapter_url: 'http://a.com/999', detected_at: t0 }
    });

    await prisma.chapterSource.create({
      data: { chapter_id: chapter1.id, series_source_id: ss2.id, source_name: 'source_b', source_chapter_url: 'http://b.com/999', detected_at: t1 }
    });

  await prisma.activity.create({
    data: {
      user_id: actualUserId,
      type: 'metadata_updated',
      series_id: seriesId,
      logical_chapter_id: chapter1.id,
      created_at: t2
    }
  });

  console.log('Running AVAILABILITY_FEED Query...');
  const events = await prisma.$queryRawUnsafe<any[]>(
    PRODUCTION_QUERIES.AVAILABILITY_FEED,
    1000
  );

  const qaEvents = events.filter(e => String(e.series_id).toLowerCase() === seriesId.toLowerCase());

  console.log(`\n--- Feed Results (Found ${qaEvents.length} events for test series) ---`);
  qaEvents.forEach((e, i) => {
    console.log(`${i + 1}. [${e.discovered_at}] Weight: ${e.event_weight} | Source: ${e.source_name} | Type: ${e.source_name === 'system' ? 'Metadata' : 'Chapter'}`);
  });

  if (qaEvents.length < 3) {
    console.log('FAIL: Could not find all 3 events in feed.');
    return;
  }

  // Verification 1: Same chapter released on two sources
  console.log('\n--- TEST CASE 1: Same chapter released on two sources ---');
  const sourceBIndex = qaEvents.findIndex(e => e.source_name === 'source_b');
  const sourceAIndex = qaEvents.findIndex(e => e.source_name === 'source_a');
  
  if (sourceBIndex < sourceAIndex) {
    console.log('RESULT: Later discovery (Source B) is ABOVE earlier discovery (Source A).');
    console.log('STATUS: PASS (matches Requirement 2: discovered_at DESC)');
    console.log('NOTE: Does NOT match Case 1 expectation "Earlier discovery shown first" if "first" means top.');
  } else {
    console.log('RESULT: Earlier discovery is above later discovery.');
    console.log('STATUS: FAIL (violates Requirement 2: discovered_at DESC)');
  }

  // Verification 2: Metadata update after chapter release
  console.log('\n--- TEST CASE 2: Metadata update after chapter release ---');
  const metadataIndex = qaEvents.findIndex(e => e.source_name === 'system');
  const chapterAIndex = qaEvents.findIndex(e => e.source_name === 'source_a');

  if (chapterAIndex < metadataIndex) {
    console.log('RESULT: Chapter is above metadata event.');
    console.log('STATUS: PASS');
  } else {
    console.log('RESULT: Metadata event (T2) is above Chapter event (T0) due to DESC time sort.');
    console.log('STATUS: FAIL (user expects Chapter above Metadata)');
  }
}

runQA().catch(console.error).finally(() => prisma.$disconnect());

