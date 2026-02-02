import { PATCH } from '@/app/api/library/[id]/progress/route';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { createClient } from '@/lib/supabase/server';
import { ApiError } from '@/lib/api-utils';

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

// Mock api-utils to bypass complex validation during unit-like integration test
jest.mock('@/lib/api-utils', () => {
  const actual = jest.requireActual('@/lib/api-utils');
  return {
    ...actual,
    validateOrigin: jest.fn(),
    validateContentType: jest.fn(),
    validateJsonSize: jest.fn(),
    validateUUID: jest.fn(),
  };
});

describe('Progress API Integration Logic', () => {
  const mockUserId = 'test-user-uuid';
  const mockEntryId = 'test-entry-uuid';
  const mockSeriesId = 'test-series-uuid';

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock Supabase User
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({ data: { user: { id: mockUserId } } }),
      },
    });

    // Mock Prisma findUnique for library entry
    (prisma.libraryEntry.findUnique as jest.Mock) = jest.fn().mockResolvedValue({
      id: mockEntryId,
      user_id: mockUserId,
      series_id: mockSeriesId,
      last_read_chapter: '5',
      series: {
        include: { sources: true }
      }
    });

    // Mock Prisma transaction
    (prisma.$transaction as jest.Mock) = jest.fn(async (callback) => {
      const tx = {
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: mockUserId,
            xp: 100,
            level: 1,
            streak_days: 2,
            last_read_at: new Date(),
            season_xp: 50,
            current_season: 'WINTER_2025'
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        libraryEntry: {
          update: jest.fn().mockResolvedValue({ id: mockEntryId }),
        },
        chapter: {
          findFirst: jest.fn().mockResolvedValue({ id: 'ch-1', chapter_number: '6', page_count: 20 }),
        },
        userChapterReadV2: {
          findUnique: jest.fn().mockResolvedValue(null),
        },
        $queryRaw: jest.fn().mockResolvedValue([{ id: 'ch-1', chapter_number: '6' }]),
        $executeRaw: jest.fn().mockResolvedValue(1),
        userChapterRead: {
          upsert: jest.fn().mockResolvedValue({}),
        },
        achievement: {
          findMany: jest.fn().mockResolvedValue([]),
        },
        seasonalUserAchievement: {
          createManyAndReturn: jest.fn().mockResolvedValue([]),
        }
      };
      return callback(tx);
    });
  });

  it('should award 1 XP for a new chapter read', async () => {
    const req = new NextRequest('https://test.com/api/library/test-id/progress', {
      method: 'PATCH',
      body: JSON.stringify({
        chapterNumber: 6,
        isRead: true
      }),
      headers: {
        'content-type': 'application/json',
        'origin': 'https://orchids.cloud'
      }
    });

    const response = await PATCH(req, { params: Promise.resolve({ id: mockEntryId }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.xpGained).toBe(1); // Standard rule: 1 XP per progress action
  });

  it('should award 0 XP if chapter was already read', async () => {
    // Modify mock to simulate already read
    (prisma.$transaction as jest.Mock) = jest.fn(async (callback) => {
      const tx = {
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUserId, xp: 100, level: 1 }),
          update: jest.fn().mockResolvedValue({}),
        },
        libraryEntry: {
          update: jest.fn().mockResolvedValue({ id: mockEntryId }),
        },
        chapter: {
          findFirst: jest.fn().mockResolvedValue({ id: 'ch-1', chapter_number: '5' }),
        },
        userChapterReadV2: {
          findUnique: jest.fn().mockResolvedValue({ is_read: true }), // Already read
        },
        $queryRaw: jest.fn().mockResolvedValue([]),
        $executeRaw: jest.fn().mockResolvedValue(0),
        userChapterRead: {
          upsert: jest.fn().mockResolvedValue({}),
        }
      };
      return callback(tx);
    });

    const req = new NextRequest('https://test.com/api/library/test-id/progress', {
      method: 'PATCH',
      body: JSON.stringify({
        chapterNumber: 5,
        isRead: true
      })
    });

    const response = await PATCH(req, { params: Promise.resolve({ id: mockEntryId }) });
    const data = await response.json();

    expect(data.xpGained).toBe(0);
  });
});
