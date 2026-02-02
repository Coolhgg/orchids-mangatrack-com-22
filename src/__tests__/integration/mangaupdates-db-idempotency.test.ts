/**
 * MangaUpdates DB Idempotency Tests
 * Tests: Upsert operations produce single rows on duplicate runs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

describe('MangaUpdates DB Idempotency', () => {
  const TEST_RELEASE_ID = 'mu-test-idempotency-12345';
  const TEST_SERIES_ID = BigInt(999999999);

  beforeAll(async () => {
    await prisma.mangaUpdatesRelease.deleteMany({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
    });
  });

  afterAll(async () => {
    await prisma.mangaUpdatesRelease.deleteMany({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
    });
    await prisma.$disconnect();
  });

  it('upsert twice produces single row', async () => {
    const releaseData = {
      mangaupdates_release_id: TEST_RELEASE_ID,
      mangaupdates_series_id: TEST_SERIES_ID,
      title: 'Test Manga Chapter 1',
      chapter: '1',
      volume: null,
      published_at: new Date(),
      metadata: { groups: [], seriesTitle: 'Test Manga', seriesUrl: '' },
    };

    await prisma.mangaUpdatesRelease.upsert({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
      create: releaseData,
      update: { title: releaseData.title, chapter: releaseData.chapter },
    });

    await prisma.mangaUpdatesRelease.upsert({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
      create: releaseData,
      update: { title: releaseData.title + ' Updated', chapter: '2' },
    });

    const count = await prisma.mangaUpdatesRelease.count({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
    });

    expect(count).toBe(1);
  });

  it('update reflects latest values after multiple upserts', async () => {
    const releaseData = {
      mangaupdates_release_id: TEST_RELEASE_ID,
      mangaupdates_series_id: TEST_SERIES_ID,
      title: 'First Title',
      chapter: '1',
      volume: null,
      published_at: new Date(),
      metadata: {},
    };

    await prisma.mangaUpdatesRelease.upsert({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
      create: releaseData,
      update: { title: 'First Title', chapter: '1' },
    });

    await prisma.mangaUpdatesRelease.upsert({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
      create: releaseData,
      update: { title: 'Final Title', chapter: '99' },
    });

    const release = await prisma.mangaUpdatesRelease.findUnique({
      where: { mangaupdates_release_id: TEST_RELEASE_ID },
    });

    expect(release?.title).toBe('Final Title');
    expect(release?.chapter).toBe('99');
  });

  it('concurrent upserts do not create duplicates', async () => {
    const uniqueId = `mu-concurrent-${Date.now()}`;

    const upsertOp = () =>
      prisma.mangaUpdatesRelease.upsert({
        where: { mangaupdates_release_id: uniqueId },
        create: {
          mangaupdates_release_id: uniqueId,
          mangaupdates_series_id: TEST_SERIES_ID,
          title: 'Concurrent Test',
          chapter: '1',
          volume: null,
          published_at: new Date(),
          metadata: {},
        },
        update: { title: 'Concurrent Test Updated' },
      });

    await Promise.all([upsertOp(), upsertOp(), upsertOp()]);

    const count = await prisma.mangaUpdatesRelease.count({
      where: { mangaupdates_release_id: uniqueId },
    });

    expect(count).toBe(1);

    await prisma.mangaUpdatesRelease.delete({
      where: { mangaupdates_release_id: uniqueId },
    });
  });
});
