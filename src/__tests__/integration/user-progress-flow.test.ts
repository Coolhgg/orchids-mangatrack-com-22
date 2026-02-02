/**
 * @jest-environment node
 * 
 * Integration test for critical user flow:
 * User adds series -> marks chapters as read -> earns XP -> achievements unlock
 */
import { prisma } from '@/lib/prisma';
import { addXp, XP_PER_CHAPTER, calculateLevel } from '@/lib/gamification/xp';

jest.mock('@/lib/queues', () => ({
  notificationQueue: { add: jest.fn() },
  feedFanoutQueue: { add: jest.fn() },
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    incr: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(-1),
    pexpire: jest.fn().mockResolvedValue(1),
    del: jest.fn().mockResolvedValue(1),
    multi: jest.fn().mockReturnValue({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, -1]]),
    }),
  },
  waitForRedis: jest.fn().mockResolvedValue(false),
  REDIS_KEY_PREFIX: 'test:',
}));

describe('User Progress Flow Integration', () => {
  let testUser: any;
  let testSeries: any;
  let testEntry: any;

  beforeAll(async () => {
    const uniqueEmail = `progress-tester-${Date.now()}@example.com`;
    
    testUser = await prisma.user.create({
      data: {
        email: uniqueEmail,
        username: `progress_${Math.random().toString(36).slice(2, 7)}`,
        password_hash: 'test',
        xp: 0,
        level: 1,
      }
    });

    testSeries = await prisma.series.create({
      data: {
        title: 'Progress Test Manga',
        type: 'manga',
        status: 'ongoing',
      }
    });

    testEntry = await prisma.libraryEntry.create({
      data: {
        user_id: testUser.id,
        series_id: testSeries.id,
        source_url: 'https://example.com/test-manga',
        source_name: 'test',
        status: 'reading',
        last_read_chapter: 0,
      }
    });
  });

  afterAll(async () => {
    await prisma.activity.deleteMany({ where: { user_id: testUser.id } });
    await prisma.libraryEntry.deleteMany({ where: { user_id: testUser.id } });
    await prisma.series.delete({ where: { id: testSeries.id } });
    await prisma.user.delete({ where: { id: testUser.id } });
  });

  test('should award XP when user reads chapters', async () => {
    const initialUser = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(initialUser?.xp).toBe(0);

    const newXp = addXp(initialUser?.xp ?? 0, XP_PER_CHAPTER * 5);
    await prisma.user.update({
      where: { id: testUser.id },
      data: { xp: newXp }
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(updatedUser?.xp).toBe(XP_PER_CHAPTER * 5);
  });

  test('should calculate level correctly based on XP', () => {
    expect(calculateLevel(0)).toBe(1);
    expect(calculateLevel(100)).toBe(2);
    expect(calculateLevel(400)).toBe(3);
    expect(calculateLevel(900)).toBe(4);
    expect(calculateLevel(10000)).toBe(11);
  });

  test('should update library entry progress correctly', async () => {
    await prisma.libraryEntry.update({
      where: { id: testEntry.id },
      data: { last_read_chapter: 10 }
    });

    const updated = await prisma.libraryEntry.findUnique({ where: { id: testEntry.id } });
    expect(updated?.last_read_chapter).toBe(10);
  });

  test('should handle concurrent progress updates without data loss', async () => {
    const updates = Array.from({ length: 5 }, (_, i) => 
      prisma.libraryEntry.update({
        where: { id: testEntry.id },
        data: { last_read_chapter: 10 + i + 1 }
      })
    );

    await Promise.all(updates);

    const final = await prisma.libraryEntry.findUnique({ where: { id: testEntry.id } });
    expect(final?.last_read_chapter).toBeGreaterThanOrEqual(11);
    expect(final?.last_read_chapter).toBeLessThanOrEqual(15);
  });

  test('should not allow negative XP', async () => {
    await prisma.user.update({
      where: { id: testUser.id },
      data: { xp: 10 }
    });

    const user = await prisma.user.findUnique({ where: { id: testUser.id } });
    const newXp = addXp(user?.xp ?? 0, -100);
    await prisma.user.update({
      where: { id: testUser.id },
      data: { xp: newXp }
    });

    const updatedUser = await prisma.user.findUnique({ where: { id: testUser.id } });
    expect(updatedUser?.xp).toBeGreaterThanOrEqual(0);
  });
});
