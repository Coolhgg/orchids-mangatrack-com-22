/**
 * TRANSACTION ROLLBACK TESTS
 * 
 * Verifies that database operations are atomic:
 * - If XP write fails → progress must rollback
 * - If progress write fails → XP must rollback
 */

import { prisma, isTransientError } from '@/lib/prisma';
import { XP_PER_CHAPTER } from '@/lib/gamification/xp';

const TEST_USER_EMAIL = `tx-rollback-test-${Date.now()}@test.internal`;

describe('TRANSACTION ROLLBACK TESTS', () => {
  let testUserId: string;
  let testSeriesId: string;
  let testEntryId: string;

  beforeAll(async () => {
    const testUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: TEST_USER_EMAIL,
        username: `tx_test_user_${Date.now()}`,
        password_hash: 'not_used_in_tests',
        xp: 100,
        level: 2,
        streak_days: 5,
        longest_streak: 5,
        chapters_read: 10,
        notification_settings: {},
        privacy_settings: {},
        subscription_tier: 'free',
      }
    });
    testUserId = testUser.id;

    const testSeries = await prisma.series.create({
      data: {
        id: crypto.randomUUID(),
        title: `TX Rollback Test Series ${Date.now()}`,
        type: 'manga',
      }
    });
    testSeriesId = testSeries.id;

    const testEntry = await prisma.libraryEntry.create({
      data: {
        id: crypto.randomUUID(),
        user_id: testUserId,
        series_id: testSeriesId,
        status: 'reading',
        last_read_chapter: 5,
        source_url: 'https://test.internal/tx-test',
        source_name: 'tx_test',
      }
    });
    testEntryId = testEntry.id;

    const chapterData = [];
    for (let i = 1; i <= 20; i++) {
      chapterData.push({
        id: crypto.randomUUID(),
        series_id: testSeriesId,
        chapter_number: String(i),
      });
    }
    await prisma.chapter.createMany({ data: chapterData });
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.userChapterReadV2.deleteMany({ where: { user_id: testUserId } });
      await prisma.userAchievement.deleteMany({ where: { user_id: testUserId } });
      await prisma.activity.deleteMany({ where: { user_id: testUserId } });
      await prisma.libraryEntry.deleteMany({ where: { user_id: testUserId } });
    }
    if (testSeriesId) {
      await prisma.chapter.deleteMany({ where: { series_id: testSeriesId } });
      await prisma.series.deleteMany({ where: { id: testSeriesId } });
    }
    if (testUserId) {
      await prisma.user.deleteMany({ where: { id: testUserId } });
    }
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: testUserId },
      data: {
        xp: 100,
        level: 2,
        chapters_read: 10,
      }
    });
    await prisma.libraryEntry.update({
      where: { id: testEntryId },
      data: { last_read_chapter: 5 }
    });
    await prisma.userChapterReadV2.deleteMany({ where: { user_id: testUserId } });
  });

  describe('Transaction Atomicity', () => {
    test('Successful transaction updates both XP and progress', async () => {
      const initialUser = await prisma.user.findUnique({ where: { id: testUserId } });
      const initialEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      
      expect(initialUser?.xp).toBe(100);
      expect(Number(initialEntry?.last_read_chapter)).toBe(5);

      const result = await prisma.$transaction(async (tx) => {
        const updatedEntry = await tx.libraryEntry.update({
          where: { id: testEntryId },
          data: { last_read_chapter: 10 }
        });

        const updatedUser = await tx.user.update({
          where: { id: testUserId },
          data: { 
            xp: { increment: XP_PER_CHAPTER },
            chapters_read: { increment: 1 }
          }
        });

        return { entry: updatedEntry, user: updatedUser };
      });

      expect(result.user.xp).toBe(101);
      expect(Number(result.entry.last_read_chapter)).toBe(10);

      const finalUser = await prisma.user.findUnique({ where: { id: testUserId } });
      const finalEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      
      expect(finalUser?.xp).toBe(101);
      expect(Number(finalEntry?.last_read_chapter)).toBe(10);
    });

    test('Failed transaction rolls back all changes', async () => {
      const initialUser = await prisma.user.findUnique({ where: { id: testUserId } });
      const initialEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      
      expect(initialUser?.xp).toBe(100);
      expect(Number(initialEntry?.last_read_chapter)).toBe(5);

      try {
        await prisma.$transaction(async (tx) => {
          await tx.libraryEntry.update({
            where: { id: testEntryId },
            data: { last_read_chapter: 15 }
          });

          await tx.user.update({
            where: { id: testUserId },
            data: { 
              xp: { increment: XP_PER_CHAPTER },
            }
          });

          throw new Error('Simulated failure after updates');
        });
      } catch (error: any) {
        expect(error.message).toBe('Simulated failure after updates');
      }

      const finalUser = await prisma.user.findUnique({ where: { id: testUserId } });
      const finalEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      
      expect(finalUser?.xp).toBe(100);
      expect(Number(finalEntry?.last_read_chapter)).toBe(5);
    });

    test('Chapter read marks are rolled back on transaction failure', async () => {
      const initialReadCount = await prisma.userChapterReadV2.count({
        where: { user_id: testUserId }
      });
      expect(initialReadCount).toBe(0);

      try {
        await prisma.$transaction(async (tx) => {
          const chapters = await tx.$queryRaw<Array<{id: string}>>`
            SELECT id FROM chapters 
            WHERE series_id = ${testSeriesId}::uuid 
              AND chapter_number::numeric <= 10
          `;

          for (const ch of chapters) {
            await tx.userChapterReadV2.upsert({
              where: {
                user_id_chapter_id: {
                  user_id: testUserId,
                  chapter_id: ch.id
                }
              },
              create: { user_id: testUserId, chapter_id: ch.id, is_read: true },
              update: { is_read: true }
            });
          }

          throw new Error('Simulated failure after chapter marking');
        });
      } catch (error: any) {
        expect(error.message).toBe('Simulated failure after chapter marking');
      }

      const finalReadCount = await prisma.userChapterReadV2.count({
        where: { user_id: testUserId }
      });
      expect(finalReadCount).toBe(0);
    });

    test('Partial updates within transaction are atomic', async () => {
      const initialUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(initialUser?.xp).toBe(100);
      expect(initialUser?.chapters_read).toBe(10);

      try {
        await prisma.$transaction(async (tx) => {
          await tx.user.update({
            where: { id: testUserId },
            data: { xp: { increment: 50 } }
          });

          await tx.user.update({
            where: { id: testUserId },
            data: { chapters_read: { increment: 5 } }
          });

          throw new Error('Simulated failure after partial updates');
        });
      } catch (error: any) {
        expect(error.message).toBe('Simulated failure after partial updates');
      }

      const finalUser = await prisma.user.findUnique({ where: { id: testUserId } });
      expect(finalUser?.xp).toBe(100);
      expect(finalUser?.chapters_read).toBe(10);
    });
  });

  describe('Transient Error Detection', () => {
    test('isTransientError identifies connection errors', () => {
      const connectionError = new Error('Connection refused');
      (connectionError as any).code = 'ECONNREFUSED';
      expect(isTransientError(connectionError)).toBe(true);
    });

    test('isTransientError identifies timeout errors', () => {
      const timeoutError = new Error('Query timeout');
      (timeoutError as any).code = 'P2024';
      expect(isTransientError(timeoutError)).toBe(true);
    });

    test('isTransientError returns false for validation errors', () => {
      const validationError = new Error('Invalid input');
      (validationError as any).code = 'P2025';
      expect(isTransientError(validationError)).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('Empty transaction succeeds', async () => {
      const result = await prisma.$transaction(async (tx) => {
        return { success: true };
      });
      expect(result.success).toBe(true);
    });

    test('Nested reads within transaction are consistent', async () => {
      await prisma.$transaction(async (tx) => {
        const user1 = await tx.user.findUnique({ where: { id: testUserId } });
        
        await tx.user.update({
          where: { id: testUserId },
          data: { xp: { increment: 10 } }
        });

        const user2 = await tx.user.findUnique({ where: { id: testUserId } });
        
        expect(user2!.xp).toBe(user1!.xp + 10);
      });

      await prisma.user.update({
        where: { id: testUserId },
        data: { xp: 100 }
      });
    });
  });
});
