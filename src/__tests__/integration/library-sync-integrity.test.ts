
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, Prisma } from '@/lib/prisma';
import { POST as addToLibrary } from '@/app/api/library/route';
import { syncChapters } from '@/lib/series-sync';
import { checkAchievements } from '@/lib/gamification/achievements';
import { recordActivityEvent } from '@/lib/catalog-tiers';

// Mock dependencies
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@prisma/client', () => ({
  Prisma: {
    Decimal: jest.fn().mockImplementation((val) => ({
      val: Number(val),
      greaterThan: function(other: any) {
        return this.val > (other.val ?? Number(other));
      },
      toString: function() { return String(this.val); }
    })),
  },
}));

jest.mock('@/lib/prisma', () => {
  const mockDecimalImpl = (val: any) => ({
    val: Number(val),
    greaterThan: function(other: any) {
      return this.val > (other.val ?? Number(other));
    },
    toString: function() { return String(this.val); }
  });
  
  return {
    prisma: {
      $transaction: jest.fn(),
      libraryEntry: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
      },
      series: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      seriesSource: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      logicalChapter: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      chapterSource: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      legacyChapter: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      auditLog: {
        create: jest.fn(),
      },
    },
    Prisma: {
      Decimal: jest.fn().mockImplementation(mockDecimalImpl),
    },
    withRetry: jest.fn((fn) => fn()),
    isTransientError: jest.fn().mockReturnValue(false),
    DEFAULT_TX_OPTIONS: {},
  };
});

jest.mock('@/lib/gamification/achievements', () => ({
  checkAchievements: jest.fn(),
}));

jest.mock('@/lib/catalog-tiers', () => ({
  recordActivityEvent: jest.fn(),
  promoteSeriesTier: jest.fn(),
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 60000]]),
    })),
  },
  waitForRedis: jest.fn().mockResolvedValue(true),
  REDIS_KEY_PREFIX: 'test:',
}));

describe('Library Sync and Integrity Integration', () => {
  const mockUser = { id: '550e8400-e29b-41d4-a716-446655440000', email: 'test@example.com' };
  const mockSeries = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    title: 'Test Manga',
    sources: [{
      id: 'source-123',
      source_name: 'mangadex',
      source_id: 'md-123',
      source_url: 'https://mangadex.org/title/md-123',
      trust_score: 100,
    }],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
      },
    });
  });

  describe('Library Add Integrity', () => {
    it('should award achievements on first add', async () => {
      (prisma.series.findUnique as jest.Mock).mockResolvedValue(mockSeries);
      (prisma.libraryEntry.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.libraryEntry.findFirst as jest.Mock).mockResolvedValue(null);
      
      const mockAchievement = { code: 'FIRST_ADD', name: 'First Addition', xp_reward: 50, rarity: 'common' };
      (checkAchievements as jest.Mock).mockResolvedValue([mockAchievement]);

      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        const tx = {
          libraryEntry: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({ id: 'entry-123', status: 'reading' }),
          },
          series: {
            update: jest.fn().mockResolvedValue(mockSeries),
          },
        };
        return fn(tx);
      });

      const request = new NextRequest('http://localhost/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'http://localhost',
          'Host': 'localhost',
        },
        body: JSON.stringify({ seriesId: '123e4567-e89b-12d3-a456-426614174000', status: 'reading' }),
      });

      const response = await addToLibrary(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(checkAchievements).toHaveBeenCalledWith(expect.anything(), mockUser.id, 'series_added');
      expect(data.achievements).toContainEqual(expect.objectContaining({ code: 'FIRST_ADD' }));
    });
  });

  describe('Sync Chapter Integrity', () => {
    it('should record activity event for new chapters', async () => {
      const seriesSource = { id: 'ss-123', source_name: 'mangadex', source_id: 'md-123' };
      (prisma.seriesSource.findUnique as jest.Mock).mockResolvedValue(seriesSource);
      (prisma.series.findUnique as jest.Mock).mockResolvedValue({ 
        id: '123e4567-e89b-12d3-a456-426614174000', 
        latest_chapter: new mockDecimal(0) 
      });

      // Transaction mock for syncChapters
      (prisma.$transaction as jest.Mock).mockImplementation(async (fn) => {
        const tx = {
          logicalChapter: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'lc-1', chapter_number: '1' }),
            update: jest.fn(),
          },
          chapterSource: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
          },
          legacyChapter: {
            findUnique: jest.fn().mockResolvedValue(null),
            create: jest.fn(),
            update: jest.fn(),
          },
        };
        return fn(tx);
      });

      const scrapedChapters = [
        { chapterNumber: 1, chapterTitle: 'Ch 1', chapterUrl: 'https://md.com/1', publishedAt: new Date() }
      ];

      const syncedCount = await syncChapters('123e4567-e89b-12d3-a456-426614174000', 'md-123', 'mangadex', scrapedChapters);

      expect(syncedCount).toBe(1);
      expect(recordActivityEvent).toHaveBeenCalledWith('123e4567-e89b-12d3-a456-426614174000', 'chapter_detected', undefined);
    });
  });
});
