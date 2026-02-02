/**
 * @jest-environment node
 */
import { processImportJob } from '@/lib/sync/import-pipeline';
import { prisma } from '@/lib/prisma';
import { searchMangaDex } from '@/lib/mangadex';

// Mock search functions
jest.mock('@/lib/mangadex', () => ({
  searchMangaDex: jest.fn(),
}));

jest.mock('@/lib/queues', () => ({
  syncSourceQueue: { add: jest.fn() },
  seriesResolutionQueue: { add: jest.fn() },
  chapterIngestQueue: { add: jest.fn() },
  checkSourceQueue: { add: jest.fn() },
  notificationQueue: { add: jest.fn() },
  notificationDeliveryQueue: { add: jest.fn() },
  notificationDeliveryPremiumQueue: { add: jest.fn() },
  notificationDigestQueue: { add: jest.fn() },
  canonicalizeQueue: { add: jest.fn() },
  refreshCoverQueue: { add: jest.fn() },
  gapRecoveryQueue: { add: jest.fn() },
}));

describe('Import Pipeline Integration', () => {
  const USER_ID = '00000000-0000-0000-0000-000000000001';
  const IMPORT_JOB_ID = '00000000-0000-0000-0000-000000000002';

  beforeEach(async () => {
    // Clean tables
    await prisma.libraryEntry.deleteMany({});
    await prisma.importItem.deleteMany({});
    await prisma.importJob.deleteMany({});
    await prisma.seriesSource.deleteMany({});
    await prisma.series.deleteMany({});
    await prisma.user.deleteMany({});

    // Setup user
    await prisma.user.create({
      data: {
        id: USER_ID,
        email: 'tester@example.com',
        username: 'tester',
      },
    });

    jest.clearAllMocks();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should process an import job and create resolved and unresolved entries', async () => {
    // 1. Setup Mock Search Results
    (searchMangaDex as jest.Mock).mockResolvedValue([
      {
        mangadex_id: 'md-1',
        title: 'Matched Manga',
        status: 'ongoing',
        type: 'manga',
        cover_url: 'https://example.com/cover.jpg',
      }
    ]);

    // 2. Create Import Job with items
    await prisma.importJob.create({
      data: {
        id: IMPORT_JOB_ID,
        user_id: USER_ID,
        source: 'myanimelist',
        status: 'pending',
        items: {
          create: [
            {
              title: 'Matched Manga',
              status: 'PENDING',
              metadata: { title: 'Matched Manga', status: 'reading', progress: 10 }
            },
            {
              title: 'Unresolved Manga',
              status: 'PENDING',
              metadata: { title: 'Unresolved Manga', status: 'plan_to_read', progress: 0 }
            }
          ]
        }
      }
    });

    // 3. Execute Pipeline
    await processImportJob(IMPORT_JOB_ID);

    // 4. Verify Results
    const job = await prisma.importJob.findUnique({
      where: { id: IMPORT_JOB_ID },
      include: { items: true }
    });

    expect(job?.status).toBe('completed');
    expect(job?.matched_items).toBe(2);

    // Verify Library Entries
    const entries = await prisma.libraryEntry.findMany({
      where: { user_id: USER_ID },
    });

    expect(entries.length).toBe(2);

    const resolvedEntry = entries.find(e => e.imported_title === 'Matched Manga');
    expect(resolvedEntry).toBeDefined();
    expect(resolvedEntry?.status).toBe('reading');
    expect(resolvedEntry?.last_read_chapter?.toString()).toBe('10');

    const unresolvedEntry = entries.find(e => e.imported_title === 'Unresolved Manga');
    expect(unresolvedEntry).toBeDefined();
    expect(unresolvedEntry?.status).toBe('planning');
  });

  it('should handle partial failures in an import job gracefully', async () => {
    // 1. Setup Mock: One succeeds, one fails
    // Mock findOrCreateSeriesSource to fail for 'Fail Manga'
    // Actually the current implementation throws if source is not found
    
    // 2. Create Import Job
    const JOB_ID = '00000000-0000-0000-0000-000000000003';
    await prisma.importJob.create({
      data: {
        id: JOB_ID,
        user_id: USER_ID,
        source: 'anilist',
        status: 'pending',
        items: {
          create: [
            {
              title: 'Success Manga',
              status: 'PENDING',
              metadata: { title: 'Success Manga', status: 'reading', progress: 5 }
            },
            {
              title: '', // Missing title to trigger failure
              status: 'PENDING',
              metadata: { status: 'completed', progress: 100 }
            }
          ]
        }
      }
    });

    // 3. Execute Pipeline
    await processImportJob(JOB_ID);

    // 4. Verify Job Totals
    const job = await prisma.importJob.findUnique({
      where: { id: JOB_ID },
      include: { items: true }
    });

    expect(job?.status).toBe('completed');
    expect(job?.matched_items).toBe(1);
    expect(job?.failed_items).toBe(1);
    
    // 5. Verify Item Statuses
    const successItem = job?.items.find(i => i.title === 'Success Manga');
    expect(successItem?.status).toBe('SUCCESS');
    
    const failedItem = job?.items.find(i => i.title === '');
    expect(failedItem?.status).toBe('FAILED');
    expect(failedItem?.reason_code).toBe('IMPORT_ERROR');
  });
});
