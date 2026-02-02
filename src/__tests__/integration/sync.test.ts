import { syncChapters } from '@/lib/series-sync';
import { prisma } from '@/lib/prisma';
import { updateSeriesBestCover } from '@/lib/cover-resolver';

// Mock the dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    seriesSource: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    series: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chapter: {
      upsert: jest.fn().mockImplementation((args) => Promise.resolve({ 
        id: 'lc-id',
        series_id: args.create.series_id,
        chapter_number: args.create.chapter_number,
        chapter_title: args.create.chapter_title
      })),
    },
    chapterSource: {
      upsert: jest.fn().mockResolvedValue({ id: 'cs-id' }),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('@/lib/cover-resolver', () => ({
  updateSeriesBestCover: jest.fn(),
}));

describe('syncChapters', () => {
  const mockSeriesId = 'series-123';
  const mockSourceId = 'source-456';
  const mockSourceName = 'mangadex';
  const mockChapters = [
    {
      chapterNumber: 1,
      chapterTitle: 'Chapter 1',
      chapterUrl: 'https://mangadex.org/chapter/1',
      publishedAt: new Date(),
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue({ id: 'src-id' });
    (prisma.series.findUnique as jest.Mock).mockResolvedValue({ id: mockSeriesId, latest_chapter: 0 });
  });

  it('should sync chapters correctly', async () => {
    const result = await syncChapters(mockSeriesId, mockSourceId, mockSourceName, mockChapters);

    expect(result).toBe(1);
    expect(prisma.chapter.upsert).toHaveBeenCalled();
    expect(prisma.chapterSource.upsert).toHaveBeenCalled();
    expect(prisma.chapter.upsert).toHaveBeenCalled();
    expect(prisma.series.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: mockSeriesId },
      data: expect.objectContaining({
        latest_chapter: expect.anything(),
      }),
    }));
    expect(updateSeriesBestCover).toHaveBeenCalledWith(mockSeriesId);
  });

  it('should skip legacy table if option is set', async () => {
    await syncChapters(mockSeriesId, mockSourceId, mockSourceName, mockChapters, { skipLegacy: true });
    expect(prisma.chapter.upsert).not.toHaveBeenCalled();
  });

  it('should throw if source is not found', async () => {
    (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue(null);
    await expect(syncChapters(mockSeriesId, mockSourceId, mockSourceName, mockChapters))
      .rejects.toThrow(/not found/);
  });
});
