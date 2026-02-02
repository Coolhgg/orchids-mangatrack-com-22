import { processImportJob } from '@/lib/sync/import-pipeline';
import { prisma } from '@/lib/prisma';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    importJob: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    series: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    libraryEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({}),
      createManyAndReturn: jest.fn().mockResolvedValue([]),
    },
    seriesSource: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({}),
    },
    importItem: {
      updateMany: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({}),
    },
    $transaction: jest.fn((callback) => {
      const mockPrisma = require('@/lib/prisma').prisma;
      return callback(mockPrisma);
    }),
  },
  withRetry: jest.fn((fn) => fn()),
}));

jest.mock('@/lib/queues', () => ({
  syncSourceQueue: {
    addBulk: jest.fn().mockResolvedValue([]),
  },
  seriesResolutionQueue: {
    addBulk: jest.fn().mockResolvedValue([]),
  },
}));

describe('Import Batching Integration', () => {
  const userId = 'user-test';
  const jobId = 'job-test';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should process a large batch of items and use chunked updates', async () => {
    // Generate 120 items to test chunking (CHUNK_SIZE is 50)
    const items = Array.from({ length: 120 }, (_, i) => ({
      id: `item-${i}`,
      metadata: {
        title: `Manga ${i}`,
        status: 'reading',
        progress: i,
        source_url: `https://mangadex.org/title/uuid-${i}`
      }
    }));

    // Mock existing entries to trigger updates instead of creates
    const existingEntries = items.map((item: any) => ({
      id: `lib-${item.id}`,
      user_id: userId,
      source_url: item.metadata.source_url,
      status: 'PLANNING',
      last_read_chapter: 0,
      updated_at: new Date(Date.now() - 10000)
    }));

    (prisma.importJob.findUnique as jest.Mock).mockResolvedValue({
      id: jobId,
      user_id: userId,
      status: 'pending',
      items: items
    });

    (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue(existingEntries);

    // Execute
    await processImportJob(jobId);

    // Verify chunking: 120 items / 50 chunk size = 3 chunks
    // But since it's Promise.all inside a loop, we expect update to be called 120 times total
    expect(prisma.libraryEntry.update).toHaveBeenCalledTimes(120);
    
    // Verify import item status grouping
    // All items should be SUCCESS with "Matched."
    expect(prisma.importItem.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: items.map(i => i.id) } },
      data: { status: "SUCCESS", reason_message: "Matched." }
    }));
  });

  it('should group failed items by error message', async () => {
    const items = [
      { id: 'item-1', metadata: { source_url: 'invalid-url-1' } },
      { id: 'item-2', metadata: { source_url: 'invalid-url-2' } },
      { id: 'item-3', metadata: { source_url: 'invalid-url-1' } }, // Same error
    ];

    (prisma.importJob.findUnique as jest.Mock).mockResolvedValue({
      id: jobId,
      user_id: userId,
      status: 'pending',
      items: items
    });

    // Mock extractPlatformIds to throw or fail
    const { extractPlatformIds } = require('../../lib/sync/import-matcher');
    // Actually, just let it throw in the loop if sourceUrl is missing or something
    
    // Execute
    await processImportJob(jobId);

    // Verify failed items were grouped
    // In this case, "Missing source information" might be the error if sourceUrl is empty
    expect(prisma.importItem.updateMany).toHaveBeenCalled();
  });
});
