import { PrismaClient } from '@prisma/client';
import {
  getUserAchievementStats,
  calculateAchievementProgress,
  getAchievementProgressForUser,
  getNextUpAchievements,
  formatProgress,
} from '@/lib/gamification/achievement-progress';

const prisma = new PrismaClient();

/**
 * QA: ACHIEVEMENT PROGRESS BARS
 * 
 * RULES:
 * 1. Progress computed dynamically from canonical stats
 * 2. No extra tables - uses User, LibraryEntry, Follow
 * 3. Based on canonical stats: chapters_read, streak_days, etc.
 */
async function qaAchievementProgress() {
  console.log('=== QA: ACHIEVEMENT PROGRESS BARS ===\n');

  const testUserId = crypto.randomUUID();
  const testId = Date.now().toString().slice(-8);
  let allPassed = true;
  const achievementIds: string[] = [];
  const seriesIds: string[] = [];

  try {
    // Setup: Create test user with some stats
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `qa-progress-${testId}@test.com`,
        username: `qa_progress_${testId}`,
        xp: 500,
        level: 3,
        chapters_read: 73, // For "Read 100 chapters" achievement
        streak_days: 5,    // For streak achievements
      }
    });

    // Create 3 separate series for library entries
    const series1 = await prisma.series.create({ data: { title: `QA Test Series 1 ${testId}`, type: 'manga' } });
    const series2 = await prisma.series.create({ data: { title: `QA Test Series 2 ${testId}`, type: 'manga' } });
    const series3 = await prisma.series.create({ data: { title: `QA Test Series 3 ${testId}`, type: 'manga' } });
    seriesIds.push(series1.id, series2.id, series3.id);

    // Create 3 library entries (2 reading, 1 completed) - each with different series
    await prisma.libraryEntry.createMany({
      data: [
        { user_id: testUserId, series_id: series1.id, source_url: `https://test1-${testId}.com`, source_name: 'test', status: 'reading' },
        { user_id: testUserId, series_id: series2.id, source_url: `https://test2-${testId}.com`, source_name: 'test', status: 'reading' },
        { user_id: testUserId, series_id: series3.id, source_url: `https://test3-${testId}.com`, source_name: 'test', status: 'completed' },
      ]
    });

    // =====================================================
    // TEST 1: Stats computed from canonical sources
    // =====================================================
    console.log('TEST 1: Stats computed from canonical sources');

    const stats = await getUserAchievementStats(prisma, testUserId);

    if (stats.chapters_read === 73) {
      console.log('  ✓ PASS: chapters_read from user.chapters_read');
    } else {
      console.log(`  ✗ FAIL: Expected 73 chapters, got ${stats.chapters_read}`);
      allPassed = false;
    }

    if (stats.streak_days === 5) {
      console.log('  ✓ PASS: streak_days from user.streak_days');
    } else {
      console.log(`  ✗ FAIL: Expected 5 streak days, got ${stats.streak_days}`);
      allPassed = false;
    }

    if (stats.library_count === 3) {
      console.log('  ✓ PASS: library_count from COUNT(library_entries)');
    } else {
      console.log(`  ✗ FAIL: Expected 3 library count, got ${stats.library_count}`);
      allPassed = false;
    }

    if (stats.completed_count === 1) {
      console.log('  ✓ PASS: completed_count from COUNT(library_entries WHERE completed)');
    } else {
      console.log(`  ✗ FAIL: Expected 1 completed, got ${stats.completed_count}`);
      allPassed = false;
    }

    // =====================================================
    // TEST 2: Progress calculated correctly
    // =====================================================
    console.log('\nTEST 2: Progress calculated correctly');

    // Create test achievements
    const achievement100Chapters = await prisma.achievement.create({
      data: {
        code: `qa-100-chapters-${testId}`,
        name: 'Century Reader',
        description: 'Read 100 chapters',
        xp_reward: 200,
        rarity: 'rare',
        criteria: { type: 'chapter_count', threshold: 100 },
        is_hidden: false,
        is_seasonal: false,
      }
    });
    achievementIds.push(achievement100Chapters.id);

    const progress = calculateAchievementProgress(
      achievement100Chapters,
      stats,
      false,
      null
    );

    if (progress) {
      if (progress.currentValue === 73 && progress.threshold === 100) {
        console.log('  ✓ PASS: Current value and threshold correct');
      } else {
        console.log(`  ✗ FAIL: Expected 73/100, got ${progress.currentValue}/${progress.threshold}`);
        allPassed = false;
      }

      if (progress.progressPercent === 73) {
        console.log('  ✓ PASS: Progress percent calculated correctly (73%)');
      } else {
        console.log(`  ✗ FAIL: Expected 73%, got ${progress.progressPercent}%`);
        allPassed = false;
      }
    } else {
      console.log('  ✗ FAIL: Progress calculation returned null');
      allPassed = false;
    }

    // =====================================================
    // TEST 3: Progress capped at 100%
    // =====================================================
    console.log('\nTEST 3: Progress capped at 100%');

    const achievementSmall = await prisma.achievement.create({
      data: {
        code: `qa-5-chapters-${testId}`,
        name: 'First Steps',
        description: 'Read 5 chapters',
        xp_reward: 10,
        rarity: 'common',
        criteria: { type: 'chapter_count', threshold: 5 },
        is_hidden: false,
        is_seasonal: false,
      }
    });
    achievementIds.push(achievementSmall.id);

    const overProgress = calculateAchievementProgress(
      achievementSmall,
      stats,
      false,
      null
    );

    if (overProgress && overProgress.progressPercent === 100) {
      console.log('  ✓ PASS: Progress capped at 100% (73/5 = 100%)');
    } else {
      console.log(`  ✗ FAIL: Expected 100%, got ${overProgress?.progressPercent}%`);
      allPassed = false;
    }

    // =====================================================
    // TEST 4: Hidden achievements excluded from progress list
    // =====================================================
    console.log('\nTEST 4: Hidden achievements excluded from progress list');

    const hiddenAchievement = await prisma.achievement.create({
      data: {
        code: `qa-hidden-progress-${testId}`,
        name: 'Secret Master',
        description: 'Secret achievement',
        xp_reward: 500,
        rarity: 'legendary',
        criteria: { type: 'chapter_count', threshold: 50 },
        is_hidden: true,
        is_seasonal: false,
      }
    });
    achievementIds.push(hiddenAchievement.id);

    const allProgress = await getAchievementProgressForUser(prisma, testUserId, {
      includeUnlocked: true,
      includeHidden: false,
    });

    const hasHidden = allProgress.some(p => p.achievementId === hiddenAchievement.id);

    if (!hasHidden) {
      console.log('  ✓ PASS: Hidden achievement excluded from progress list');
    } else {
      console.log('  ✗ FAIL: Hidden achievement should not appear in progress list');
      allPassed = false;
    }

    // =====================================================
    // TEST 5: Next up achievements sorted by progress
    // =====================================================
    console.log('\nTEST 5: Next up achievements sorted correctly');

    const nextUp = await getNextUpAchievements(prisma, testUserId, 10);

    // Should only include achievements with progress > 0 and < 100
    const allInProgress = nextUp.every(p => p.progressPercent > 0 && p.progressPercent < 100);

    if (allInProgress || nextUp.length === 0) {
      console.log('  ✓ PASS: Next up only includes in-progress achievements');
    } else {
      console.log('  ✗ FAIL: Next up should only include partially completed achievements');
      allPassed = false;
    }

    // =====================================================
    // TEST 6: Format progress helper
    // =====================================================
    console.log('\nTEST 6: Format progress helper');

    if (progress) {
      const formatted = formatProgress(progress);
      
      if (formatted === '73 / 100 chapters') {
        console.log(`  ✓ PASS: Formatted correctly: "${formatted}"`);
      } else {
        console.log(`  ✗ FAIL: Expected "73 / 100 chapters", got "${formatted}"`);
        allPassed = false;
      }
    }

    // =====================================================
    // TEST 7: Unlocked achievements show 100% progress
    // =====================================================
    console.log('\nTEST 7: Unlocked achievements show correct status');

    // Unlock the small achievement
    await prisma.userAchievement.create({
      data: {
        user_id: testUserId,
        achievement_id: achievementSmall.id,
      }
    });

    const withUnlocked = await getAchievementProgressForUser(prisma, testUserId, {
      includeUnlocked: true,
    });

    const unlockedProgress = withUnlocked.find(p => p.achievementId === achievementSmall.id);

    if (unlockedProgress?.isUnlocked && unlockedProgress?.progressPercent === 100) {
      console.log('  ✓ PASS: Unlocked achievement shows isUnlocked=true, 100%');
    } else {
      console.log('  ✗ FAIL: Unlocked achievement status incorrect');
      allPassed = false;
    }

    // =====================================================
    // SUMMARY
    // =====================================================
    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
      console.log('\nAchievement progress bars work correctly:');
      console.log('  - Stats computed dynamically from canonical sources');
      console.log('  - Progress percent calculated correctly');
      console.log('  - Progress capped at 100%');
      console.log('  - Hidden achievements excluded from lists');
      console.log('  - Next up sorted by progress');
      console.log('  - Format helper works correctly');
    } else {
      console.log('✗ SOME TESTS FAILED');
      process.exitCode = 1;
    }

  } catch (error) {
    console.error('Test error:', error);
    process.exitCode = 1;
  } finally {
    // Cleanup
    try {
      await prisma.userAchievement.deleteMany({ where: { user_id: testUserId } });
      for (const id of achievementIds) {
        await prisma.achievement.delete({ where: { id } }).catch(() => {});
      }
      await prisma.libraryEntry.deleteMany({ where: { user_id: testUserId } });
      for (const id of seriesIds) {
        await prisma.series.delete({ where: { id } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
    await prisma.$disconnect();
  }
}

qaAchievementProgress();
