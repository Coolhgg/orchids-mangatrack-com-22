import { processImportJob } from '@/lib/sync/import-pipeline';
import { prisma } from '@/lib/prisma';
import { syncSourceQueue } from '@/lib/queues';
import { searchMangaDex } from '@/lib/mangadex';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    importJob: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    series: {
      create: jest.fn(),
    },
    seriesSource: {
      findFirst: jest.fn(),
    },
    libraryEntry: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    auditLog: {
      create: jest.fn(),
    },
  },
}));

jest.mock('@/lib/queues', () => ({
  syncSourceQueue: {
    add: jest.fn(),
  },
}));

jest.mock('@/lib/mangadex', () => ({
  searchMangaDex: jest.fn(),
}));

jest.mock('./import-matcher', () => ({
  matchSeries: jest.fn(),
  normalizeStatus: jest.fn((s) => s),
  reconcileEntry: jest.fn(),
  calculateSimilarity: jest.fn((a, b) => (a === b ? 1 : 0.5)),
}));

describe('Import Pipeline Simulation', () => {
  const userId = 'user-123';
  const jobId = 'job-123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should perform Active Discovery when local match fails', async () => {
    const { matchSeries } = require('./import-matcher');
    
    // 1. Setup: Local match fails
    (prisma.importJob.findUnique as jest.Mock).mockResolvedValue({
      id: jobId,
      user_id: userId,
      status: 'pending',
      error_log: [{ title: 'New Manga', status: 'reading', progress: 1 }]
    });
    matchSeries.mockResolvedValue({ series_id: null });

    // 2. Setup: External discovery succeeds
    (searchMangaDex as jest.Mock).mockResolvedValue([{
      mangadex_id: 'md-new',
      title: 'New Manga',
      status: 'ongoing',
      type: 'manga'
    }]);
    (prisma.series.create as jest.Mock).mockResolvedValue({ id: 'series-new' });
    (prisma.libraryEntry.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.seriesSource.findFirst as jest.Mock).mockResolvedValue({ id: 'source-new' });

    // 3. Execute
    await processImportJob(jobId);

    // 4. Verify Active Discovery triggered
    expect(searchMangaDex).toHaveBeenCalledWith('New Manga');
    expect(prisma.series.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        mangadex_id: 'md-new',
        sources: expect.anything()
      })
    }));

    // 5. Verify Immediate Sync triggered
    expect(syncSourceQueue.add).toHaveBeenCalledWith(
      'sync-source-new',
      { seriesSourceId: 'source-new' },
      expect.anything()
    );
  });

  it('should record skipped series in the error_log for user review', async () => {
    const { matchSeries } = require('./import-matcher');

    // 1. Setup: Total failure (no local, no external)
    (prisma.importJob.findUnique as jest.Mock).mockResolvedValue({
      id: jobId,
      user_id: userId,
      status: 'pending',
      error_log: [{ title: 'Unknown Ghost', status: 'reading', progress: 1 }]
    });
    matchSeries.mockResolvedValue({ series_id: null });
    (searchMangaDex as jest.Mock).mockResolvedValue([]);

    // 2. Execute
    await processImportJob(jobId);

    // 3. Verify failure is recorded in error_log (results.skipped)
    expect(prisma.importJob.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId },
      data: expect.objectContaining({
        status: 'completed',
        error_log: expect.arrayContaining([
          expect.objectContaining({
            title: 'Unknown Ghost',
            reason: 'No confident match found even after external discovery'
          })
        ])
      })
    }));
  });
});
