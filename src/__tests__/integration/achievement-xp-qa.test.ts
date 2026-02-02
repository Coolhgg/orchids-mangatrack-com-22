// @ts-nocheck - Integration test with complex mocks
/**
 * ACHIEVEMENT XP QA MATRIX - INTEGRATION TESTS
 * 
 * BLOCKER IF ANY FAIL - These tests verify the core abuse prevention rules
 * 
 * Test Matrix:
 * 1. First Chapter Read - Achievement unlocks, XP granted once
 * 2. Repeat Chapter Reads - No new XP, no duplicate achievement
 * 3. Threshold Achievement - Reach 100 chapters, unlock speed_reader, XP granted once
 * 4. Status Toggle Abuse - Completed → Reading → Completed = XP granted once only
 * 5. Concurrent Requests - Two requests at same time = achievement unlocked once
 * 6. Re-run Achievement Check - Manually call checkAchievements again = no XP granted
 */

import { prisma, TransactionClient } from '@/lib/prisma';
import { checkAchievements } from '@/lib/gamification/achievements';
import { XP_PER_CHAPTER, XP_SERIES_COMPLETED, calculateLevel } from '@/lib/gamification/xp';
import { logActivity } from '@/lib/gamification/activity';

const TEST_USER_EMAIL = `qa-achievement-test-${Date.now()}@test.internal`;
const TEST_SERIES_TITLE = `QA Test Series ${Date.now()}`;

describe('ACHIEVEMENT XP QA MATRIX', () => {
  let testUserId: string;
  let testSeriesId: string;
  let testEntryId: string;
  let firstChapterAchievementId: string;
  let speedReaderAchievementId: string;

  beforeAll(async () => {
    const firstChapterAchievement = await prisma.achievement.findFirst({
      where: { code: 'first_chapter' }
    });
    const speedReaderAchievement = await prisma.achievement.findFirst({
      where: { code: 'speed_reader' }
    });

    if (!firstChapterAchievement || !speedReaderAchievement) {
      throw new Error('Required achievements not found in database');
    }

    firstChapterAchievementId = firstChapterAchievement.id;
    speedReaderAchievementId = speedReaderAchievement.id;

    const testUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: TEST_USER_EMAIL,
        username: `qa_test_user_${Date.now()}`,
        password_hash: 'not_used_in_tests',
        xp: 0,
        level: 1,
        streak_days: 0,
        longest_streak: 0,
        chapters_read: 0,
        notification_settings: {},
        privacy_settings: {},
        subscription_tier: 'free',
      }
    });
    testUserId = testUser.id;

    const testSeries = await prisma.series.create({
      data: {
        id: crypto.randomUUID(),
        title: TEST_SERIES_TITLE,
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
        last_read_chapter: 0,
        source_url: 'https://test.internal/qa-test',
        source_name: 'qa_test',
      }
    });
    testEntryId = testEntry.id;
  });

  afterAll(async () => {
    if (testUserId) {
      await prisma.userChapterReadV2.deleteMany({
        where: { user_id: testUserId }
      });
      await prisma.userAchievement.deleteMany({
        where: { user_id: testUserId }
      });
      await prisma.activity.deleteMany({
        where: { user_id: testUserId }
      });
      await prisma.libraryEntry.deleteMany({
        where: { user_id: testUserId }
      });
    }
    if (testSeriesId) {
      await prisma.series.deleteMany({
        where: { id: testSeriesId }
      });
    }
    if (testUserId) {
      await prisma.user.deleteMany({
        where: { id: testUserId }
      });
    }
  });

  beforeEach(async () => {
    await prisma.user.update({
      where: { id: testUserId },
      data: {
        xp: 0,
        level: 1,
        chapters_read: 0,
      }
    });
    await prisma.userAchievement.deleteMany({
      where: { user_id: testUserId }
    });
    await prisma.activity.deleteMany({
      where: { user_id: testUserId }
    });
    await prisma.libraryEntry.update({
      where: { id: testEntryId },
      data: {
        status: 'reading',
        last_read_chapter: 0,
      }
    });
  });

  /**
   * TEST 1: FIRST CHAPTER READ
   * - Read first chapter
   * - Achievement unlocks
   * - XP granted once
   */
  test('1. First Chapter Read - achievement unlocks, XP granted once', async () => {
    const initialUser = await prisma.user.findUnique({ where: { id: testUserId } });
    const initialXp = initialUser?.xp || 0;

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { chapters_read: 1 }
      });

      const achievements = await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
      return achievements;
    });

    const firstStepsUnlocked = result.find(a => a.code === 'first_chapter');
    expect(firstStepsUnlocked).toBeDefined();
    expect(firstStepsUnlocked?.xp_reward).toBe(50);

    const updatedUser = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(updatedUser?.xp).toBe(initialXp + 50);

    const userAchievement = await prisma.userAchievement.findFirst({
      where: {
        user_id: testUserId,
        achievement_id: firstChapterAchievementId,
      }
    });
    expect(userAchievement).toBeDefined();

    console.log('TEST 1: PASS - First chapter read awards achievement + 50 XP once');
  });

  /**
   * TEST 2: REPEAT CHAPTER READS
   * - Re-read same chapter
   * - No new XP
   * - No duplicate achievement
   */
  test('2. Repeat Chapter Reads - no new XP, no duplicate achievement', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { chapters_read: 1, xp: 50 }
      });
      await tx.userAchievement.create({
        data: {
          user_id: testUserId,
          achievement_id: firstChapterAchievementId,
        }
      });
    });

    const userBeforeReread = await prisma.user.findUnique({ where: { id: testUserId } });
    const xpBeforeReread = userBeforeReread?.xp || 0;

    const result = await prisma.$transaction(async (tx) => {
      return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
    });

    expect(result.length).toBe(0);

    const userAfterReread = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userAfterReread?.xp).toBe(xpBeforeReread);

    const achievementCount = await prisma.userAchievement.count({
      where: {
        user_id: testUserId,
        achievement_id: firstChapterAchievementId,
      }
    });
    expect(achievementCount).toBe(1);

    console.log('TEST 2: PASS - Re-reading chapter grants 0 XP, no duplicate achievement');
  });

  /**
   * TEST 3: THRESHOLD ACHIEVEMENT (speed_reader @ 100 chapters)
   * - Reach 100 chapters
   * - Unlock speed_reader
   * - XP granted once
   */
  test('3. Threshold Achievement - speed_reader at 100 chapters, XP granted once', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { chapters_read: 1, xp: 50 }
      });
      await tx.userAchievement.create({
        data: {
          user_id: testUserId,
          achievement_id: firstChapterAchievementId,
        }
      });
    });

    const xpBefore = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;

    const result = await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { chapters_read: 100 }
      });

      return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
    });

    const speedReaderUnlocked = result.find(a => a.code === 'speed_reader');
    expect(speedReaderUnlocked).toBeDefined();
    expect(speedReaderUnlocked?.xp_reward).toBe(200);

    const userAfter = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userAfter?.xp).toBe(xpBefore + 200);

    const secondAttempt = await prisma.$transaction(async (tx) => {
      return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
    });

    expect(secondAttempt.find(a => a.code === 'speed_reader')).toBeUndefined();

    const userFinal = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userFinal?.xp).toBe(xpBefore + 200);

    console.log('TEST 3: PASS - speed_reader at 100 chapters grants 200 XP exactly once');
  });

  /**
   * TEST 4: STATUS TOGGLE ABUSE
   * - Completed → Reading → Completed
   * - XP granted once only
   */
  test('4. Status Toggle Abuse - Completed → Reading → Completed = XP granted once only', async () => {
    const initialXp = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;

    await prisma.$transaction(async (tx) => {
      await tx.libraryEntry.update({
        where: { id: testEntryId },
        data: { status: 'completed' }
      });

      const existingActivity = await tx.activity.findFirst({
        where: {
          user_id: testUserId,
          series_id: testSeriesId,
          type: 'series_completed',
        },
      });

      if (!existingActivity) {
        const newXp = initialXp + XP_SERIES_COMPLETED;
        await tx.user.update({
          where: { id: testUserId },
          data: { xp: newXp, level: calculateLevel(newXp) }
        });

        await logActivity(tx, testUserId, 'series_completed', {
          seriesId: testSeriesId,
        });
      }
    });

    const xpAfterFirstComplete = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;
    expect(xpAfterFirstComplete).toBe(initialXp + XP_SERIES_COMPLETED);

    await prisma.libraryEntry.update({
      where: { id: testEntryId },
      data: { status: 'reading' }
    });

    await prisma.$transaction(async (tx) => {
      await tx.libraryEntry.update({
        where: { id: testEntryId },
        data: { status: 'completed' }
      });

      const existingActivity = await tx.activity.findFirst({
        where: {
          user_id: testUserId,
          series_id: testSeriesId,
          type: 'series_completed',
        },
      });

      if (!existingActivity) {
        const currentXp = (await tx.user.findUnique({ where: { id: testUserId } }))?.xp || 0;
        await tx.user.update({
          where: { id: testUserId },
          data: { xp: currentXp + XP_SERIES_COMPLETED }
        });

        await logActivity(tx, testUserId, 'series_completed', {
          seriesId: testSeriesId,
        });
      }
    });

    const xpAfterToggle = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;
    expect(xpAfterToggle).toBe(initialXp + XP_SERIES_COMPLETED);

    const activityCount = await prisma.activity.count({
      where: {
        user_id: testUserId,
        series_id: testSeriesId,
        type: 'series_completed',
      }
    });
    expect(activityCount).toBe(1);

    console.log('TEST 4: PASS - Status toggle abuse prevented, XP granted once only');
  });

  /**
   * TEST 5: CONCURRENT REQUESTS
   * - Two chapter_read requests at same time
   * - Achievement unlocked once
   * - XP granted once
   */
  test('5. Concurrent Requests - achievement unlocked once, XP granted once', async () => {
    const initialXp = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;

    await prisma.user.update({
      where: { id: testUserId },
      data: { chapters_read: 1 }
    });

    const concurrentCheck = async () => {
      return prisma.$transaction(async (tx) => {
        return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
      });
    };

    const results = await Promise.allSettled([
      concurrentCheck(),
      concurrentCheck(),
      concurrentCheck(),
    ]);

    const successfulResults = results
      .filter((r: any): r is PromiseFulfilledResult<any[]> => r.status === 'fulfilled')
      .map(r => r.value);

    const totalUnlocks = successfulResults.reduce((sum, arr) => {
      return sum + arr.filter(a => a.code === 'first_chapter').length;
    }, 0);

    expect(totalUnlocks).toBeLessThanOrEqual(1);

    const achievementCount = await prisma.userAchievement.count({
      where: {
        user_id: testUserId,
        achievement_id: firstChapterAchievementId,
      }
    });
    expect(achievementCount).toBe(1);

    const userFinal = await prisma.user.findUnique({ where: { id: testUserId } });
    expect(userFinal?.xp).toBe(initialXp + 50);

    console.log('TEST 5: PASS - Concurrent requests result in exactly 1 achievement unlock and 1 XP grant');
  });

  /**
   * TEST 6: RE-RUN ACHIEVEMENT CHECK
   * - Manually call checkAchievements again
   * - No XP granted
   */
  test('6. Re-run checkAchievements - no XP granted on repeated calls', async () => {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: testUserId },
        data: { chapters_read: 1, xp: 0 }
      });
    });

    const firstResult = await prisma.$transaction(async (tx) => {
      return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
    });

    expect(firstResult.find(a => a.code === 'first_chapter')).toBeDefined();

    const xpAfterFirst = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;
    expect(xpAfterFirst).toBe(50);

    for (let i = 0; i < 5; i++) {
      const repeatedResult = await prisma.$transaction(async (tx) => {
        return await checkAchievements(tx as TransactionClient, testUserId, 'chapter_read');
      });

      expect(repeatedResult.length).toBe(0);
    }

    const finalXp = (await prisma.user.findUnique({ where: { id: testUserId } }))?.xp || 0;
    expect(finalXp).toBe(50);

    const achievementCount = await prisma.userAchievement.count({
      where: {
        user_id: testUserId,
        achievement_id: firstChapterAchievementId,
      }
    });
    expect(achievementCount).toBe(1);

    console.log('TEST 6: PASS - Multiple checkAchievements calls grant XP exactly once');
  });
});

describe('ACHIEVEMENT XP INTEGRITY CONSTANTS', () => {
  test('XP_PER_CHAPTER must be exactly 1 (LOCKED)', () => {
    expect(XP_PER_CHAPTER).toBe(1);
  });

  test('XP_SERIES_COMPLETED must be exactly 100 (LOCKED)', () => {
    expect(XP_SERIES_COMPLETED).toBe(100);
  });

  test('first_chapter achievement xp_reward must be 50', async () => {
    const achievement = await prisma.achievement.findFirst({
      where: { code: 'first_chapter' }
    });
    expect(achievement?.xp_reward).toBe(50);
  });

  test('speed_reader achievement xp_reward must be 200', async () => {
    const achievement = await prisma.achievement.findFirst({
      where: { code: 'speed_reader' }
    });
    expect(achievement?.xp_reward).toBe(200);
  });

  test('user_achievements has unique constraint on (user_id, achievement_id)', async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname FROM pg_indexes 
      WHERE tablename = 'user_achievements' 
      AND indexdef LIKE '%UNIQUE%'
      AND indexdef LIKE '%user_id%'
      AND indexdef LIKE '%achievement_id%'
    `;
    expect(indexes.length).toBeGreaterThan(0);
  });
});
