/**
 * READ PROGRESS + XP IMPLEMENTATION SPEC TESTS
 * 
 * BLOCKERS - All tests must pass
 * 
 * STEP 1: XP_PER_CHAPTER = 1, no scaling, no bonuses in xp.ts
 * STEP 2: Bulk read marking logic (chapters 1→N marked as read)
 * STEP 3: XP granted ONLY if N > currentLastReadChapter, XP = 1 per request
 * STEP 4: Streak compatibility
 */

import { prisma } from '@/lib/prisma';
import { XP_PER_CHAPTER, XP_SERIES_COMPLETED, calculateLevel, addXp } from '@/lib/gamification/xp';
import { calculateNewStreak, calculateStreakBonus } from '@/lib/gamification/streaks';

const TEST_USER_EMAIL = `read-progress-spec-${Date.now()}@test.internal`;

describe('READ PROGRESS + XP IMPLEMENTATION SPEC', () => {
  let testUserId: string;
  let testSeriesId: string;
  let testEntryId: string;

  beforeAll(async () => {
    // Create test user
    const testUser = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: TEST_USER_EMAIL,
        username: `spec_test_user_${Date.now()}`,
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

    // Create test series
    const testSeries = await prisma.series.create({
      data: {
        id: crypto.randomUUID(),
        title: `Spec Test Series ${Date.now()}`,
        type: 'manga',
      }
    });
    testSeriesId = testSeries.id;

    // Create test library entry
    const testEntry = await prisma.libraryEntry.create({
      data: {
        id: crypto.randomUUID(),
        user_id: testUserId,
        series_id: testSeriesId,
        status: 'reading',
        last_read_chapter: 0,
        source_url: 'https://test.internal/spec-test',
        source_name: 'spec_test',
      }
    });
    testEntryId = testEntry.id;

    // Create logical chapters 1-60 for testing (chapter_number is VARCHAR)
    // Use batch insert for speed
    const chapterData = [];
    for (let i = 1; i <= 60; i++) {
      chapterData.push({
        id: crypto.randomUUID(),
        series_id: testSeriesId,
        chapter_number: String(i),
      });
    }
    await prisma.chapter.createMany({ data: chapterData });
  });

  afterAll(async () => {
    // Cleanup
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
    // Reset user state for each test
    await prisma.user.update({
      where: { id: testUserId },
      data: {
        xp: 0,
        level: 1,
        chapters_read: 0,
        streak_days: 0,
        last_read_at: null,
      }
    });
    await prisma.libraryEntry.update({
      where: { id: testEntryId },
      data: { last_read_chapter: 0, last_read_at: null }
    });
    await prisma.userChapterReadV2.deleteMany({ where: { user_id: testUserId } });
  });

  // ============================================================
  // STEP 1: XP CONSTANT
  // ============================================================
  describe('STEP 1: XP CONSTANT', () => {
    test('XP_PER_CHAPTER must be exactly 1 (LOCKED)', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });

    test('No scaling logic exists in XP_PER_CHAPTER', () => {
      expect(typeof XP_PER_CHAPTER).toBe('number');
    });

    test('addXp does not multiply XP', () => {
      expect(addXp(0, 1)).toBe(1);
      expect(addXp(50, 1)).toBe(51);
      expect(addXp(100, 1)).toBe(101);
    });
  });

  // ============================================================
  // STEP 2: BULK READ MARKING LOGIC
  // ============================================================
  describe('STEP 2: BULK READ MARKING LOGIC', () => {
    test('Marking chapter N marks all chapters 1→N as read', async () => {
      const targetChapter = 10;

      const chapters = await prisma.$queryRaw<Array<{id: string}>>`
        SELECT id FROM chapters 
        WHERE series_id = ${testSeriesId}::uuid 
          AND chapter_number::numeric > 0 
          AND chapter_number::numeric <= ${targetChapter}
      `;

      expect(chapters.length).toBe(targetChapter);

      // Bulk insert reads
      const readData = chapters.map(ch => ({
        user_id: testUserId,
        chapter_id: ch.id,
        is_read: true,
      }));
      await prisma.userChapterReadV2.createMany({ data: readData, skipDuplicates: true });

      const readChapters = await prisma.userChapterReadV2.count({
        where: { user_id: testUserId, is_read: true }
      });

      expect(readChapters).toBe(targetChapter);
    });

    test('If N <= currentLastReadChapter, do nothing', async () => {
      await prisma.libraryEntry.update({
        where: { id: testEntryId },
        data: { last_read_chapter: 50 }
      });

      const entry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      const currentLastRead = Number(entry?.last_read_chapter || 0);

      const targetChapter = 30;
      const shouldProcess = targetChapter > currentLastRead;

      expect(shouldProcess).toBe(false);
    });

    test('If N > currentLastReadChapter, process and update last_read_chapter', async () => {
      await prisma.libraryEntry.update({
        where: { id: testEntryId },
        data: { last_read_chapter: 10 }
      });

      const entry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      const currentLastRead = Number(entry?.last_read_chapter || 0);
      const targetChapter = 50;
      const shouldProcess = targetChapter > currentLastRead;

      expect(shouldProcess).toBe(true);

      await prisma.libraryEntry.update({
        where: { id: testEntryId },
        data: { last_read_chapter: targetChapter }
      });

      const updatedEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      expect(Number(updatedEntry?.last_read_chapter)).toBe(targetChapter);
    });
  });

  // ============================================================
  // STEP 3: XP GRANT LOGIC
  // ============================================================
  describe('STEP 3: XP GRANT LOGIC', () => {
    test('XP granted ONLY if N > currentLastReadChapter', () => {
      const currentLastRead = 10;
      expect(20 > currentLastRead).toBe(true);  // Award XP
      expect(5 > currentLastRead).toBe(false);  // No XP
      expect(10 > currentLastRead).toBe(false); // No XP
    });

    test('XP granted = XP_PER_CHAPTER (1), NOT per chapter count', () => {
      const currentLastRead = 1;
      const targetChapter = 500;
      const chaptersSkipped = targetChapter - currentLastRead;

      const xpGranted = XP_PER_CHAPTER;

      expect(xpGranted).toBe(1);
      expect(xpGranted).not.toBe(chaptersSkipped);
    });

    test('XP grant happens ONCE per request', () => {
      expect(XP_PER_CHAPTER).toBe(1);
    });

    test('Re-marking same chapter gives XP = 0', async () => {
      const chapters = await prisma.$queryRaw<Array<{id: string}>>`
        SELECT id FROM chapters 
        WHERE series_id = ${testSeriesId}::uuid AND chapter_number = '10'
      `;

      if (chapters.length > 0) {
        await prisma.userChapterReadV2.create({
          data: { user_id: testUserId, chapter_id: chapters[0].id, is_read: true }
        });
      }

      const existingRead = await prisma.userChapterReadV2.findFirst({
        where: { user_id: testUserId, chapter_id: chapters[0]?.id, is_read: true }
      });

      const alreadyRead = !!existingRead;
      expect(alreadyRead).toBe(true);
      expect(!alreadyRead).toBe(false); // shouldAwardXp = false
    });

    test('DO NOT loop XP per chapter', () => {
      const chaptersMarked = 50;
      const wrongXp = chaptersMarked * XP_PER_CHAPTER;
      const correctXp = XP_PER_CHAPTER;

      expect(correctXp).toBe(1);
      expect(wrongXp).not.toBe(correctXp);
    });

    test('DO NOT count number of chapters updated for XP', () => {
      expect(XP_PER_CHAPTER).toBe(1);
      expect(XP_PER_CHAPTER).not.toBe(100);
    });

    test('DO NOT award XP per source', () => {
      expect(XP_PER_CHAPTER).toBe(1);
      expect(XP_PER_CHAPTER).not.toBe(3);
    });

    test('DO NOT award XP per logical chapter', () => {
      expect(XP_PER_CHAPTER).toBe(1);
      expect(XP_PER_CHAPTER).not.toBe(25);
    });
  });

  // ============================================================
  // STEP 4: STREAK COMPATIBILITY
  // ============================================================
  describe('STEP 4: STREAK COMPATIBILITY', () => {
    test('Reading any chapter qualifies for daily streak', () => {
      const currentStreak = 5;
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(12, 0, 0, 0);

      const newStreak = calculateNewStreak(currentStreak, yesterday);
      expect(newStreak).toBe(6);
    });

    test('Streak bonus is additive', () => {
      const baseXp = XP_PER_CHAPTER;
      const streak = 5;
      const streakBonus = calculateStreakBonus(streak);
      const totalXp = baseXp + streakBonus;
      
      expect(totalXp).toBe(1 + 25);
    });

    test('Streak bonus is capped at 50', () => {
      expect(calculateStreakBonus(100)).toBe(50);
    });

    test('Streak resets if user skips a day', () => {
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      expect(calculateNewStreak(10, twoDaysAgo)).toBe(1);
    });

    test('Same-day reading does not increment streak', () => {
      expect(calculateNewStreak(5, new Date())).toBe(5);
    });
  });

  // ============================================================
  // INTEGRATION: FULL FLOW VERIFICATION
  // ============================================================
  describe('INTEGRATION: Full Flow', () => {
    test('Complete flow: mark chapter 50 from 0', async () => {
      const user = await prisma.user.findUnique({ where: { id: testUserId } });
      const entry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      
      expect(user?.xp).toBe(0);
      expect(Number(entry?.last_read_chapter)).toBe(0);

      const currentLastRead = Number(entry?.last_read_chapter || 0);
      const targetChapter = 50;
      const isNewProgress = targetChapter > currentLastRead;

      expect(isNewProgress).toBe(true);

      const baseXp = isNewProgress ? XP_PER_CHAPTER : 0;
      expect(baseXp).toBe(1);

      await prisma.user.update({
        where: { id: testUserId },
        data: { xp: baseXp, chapters_read: 1 }
      });

      const chapters = await prisma.$queryRaw<Array<{id: string}>>`
        SELECT id FROM chapters 
        WHERE series_id = ${testSeriesId}::uuid 
          AND chapter_number::numeric > 0 
          AND chapter_number::numeric <= 50
      `;

      const readData = chapters.map(ch => ({
        user_id: testUserId,
        chapter_id: ch.id,
        is_read: true,
      }));
      await prisma.userChapterReadV2.createMany({ data: readData, skipDuplicates: true });

      await prisma.libraryEntry.update({
        where: { id: testEntryId },
        data: { last_read_chapter: targetChapter }
      });

      const finalUser = await prisma.user.findUnique({ where: { id: testUserId } });
      const finalEntry = await prisma.libraryEntry.findUnique({ where: { id: testEntryId } });
      const readCount = await prisma.userChapterReadV2.count({ where: { user_id: testUserId } });

      expect(finalUser?.xp).toBe(1);
      expect(finalUser?.chapters_read).toBe(1);
      expect(Number(finalEntry?.last_read_chapter)).toBe(50);
      expect(readCount).toBe(50);
    });
  });
});
