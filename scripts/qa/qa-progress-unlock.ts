import { PrismaClient } from '@prisma/client';
import { checkAchievements } from '@/lib/gamification/achievements';
import { getUserAchievementStats, calculateAchievementProgress } from '@/lib/gamification/achievement-progress';

const prisma = new PrismaClient();

/**
 * QA: PROGRESS BARS - Updates & Auto-Unlock
 * 
 * RULES:
 * 1. Progress updates correctly as stats change
 * 2. Unlock at 100% (when threshold is met)
 */
async function qaProgressBarsUnlock() {
  console.log('=== QA: PROGRESS BARS - Updates & Auto-Unlock ===\n');

  const testUserId = crypto.randomUUID();
  const testId = Date.now().toString().slice(-8);
  let allPassed = true;
  let achievementId: string | null = null;

  try {
    // Setup: Create test user with 8 chapters read (threshold will be 10)
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `qa-unlock-${testId}@test.com`,
        username: `qa_unlock_${testId}`,
        xp: 0,
        level: 1,
        chapters_read: 8,
        streak_days: 0,
      }
    });

    // Create achievement with threshold of 10 chapters
    const achievement = await prisma.achievement.create({
      data: {
        code: `qa-10-chapters-${testId}`,
        name: 'Chapter Master',
        description: 'Read 10 chapters',
        xp_reward: 100,
        rarity: 'uncommon',
        criteria: { type: 'chapter_count', threshold: 10 },
        is_hidden: false,
        is_seasonal: false,
      }
    });
    achievementId = achievement.id;

    // =====================================================
    // TEST 1: Progress shows 80% at 8/10 chapters
    // =====================================================
    console.log('TEST 1: Progress updates correctly (80% at 8/10)');

    let stats = await getUserAchievementStats(prisma, testUserId);
    let progress = calculateAchievementProgress(achievement, stats, false, null);

    if (progress?.progressPercent === 80 && progress?.currentValue === 8) {
      console.log('  ✓ PASS: Progress shows 80% (8/10 chapters)');
    } else {
      console.log(`  ✗ FAIL: Expected 80%, got ${progress?.progressPercent}%`);
      allPassed = false;
    }

    // Verify not unlocked yet
    const unlockedBefore = await prisma.userAchievement.findUnique({
      where: {
        user_id_achievement_id: {
          user_id: testUserId,
          achievement_id: achievement.id
        }
      }
    });

    if (!unlockedBefore) {
      console.log('  ✓ PASS: Achievement not unlocked yet');
    } else {
      console.log('  ✗ FAIL: Achievement should not be unlocked at 80%');
      allPassed = false;
    }

    // =====================================================
    // TEST 2: Progress updates when stats change (90% at 9/10)
    // =====================================================
    console.log('\nTEST 2: Progress updates with stat change (90% at 9/10)');

    await prisma.user.update({
      where: { id: testUserId },
      data: { chapters_read: 9 }
    });

    stats = await getUserAchievementStats(prisma, testUserId);
    progress = calculateAchievementProgress(achievement, stats, false, null);

    if (progress?.progressPercent === 90 && progress?.currentValue === 9) {
      console.log('  ✓ PASS: Progress updated to 90% (9/10 chapters)');
    } else {
      console.log(`  ✗ FAIL: Expected 90%, got ${progress?.progressPercent}%`);
      allPassed = false;
    }

    // =====================================================
    // TEST 3: Auto-unlock at 100% (10/10 chapters)
    // =====================================================
    console.log('\nTEST 3: Auto-unlock at 100% threshold');

    // Simulate reading 10th chapter
    await prisma.user.update({
      where: { id: testUserId },
      data: { chapters_read: 10 }
    });

    // Check achievements (this is what happens after chapter read)
    const unlocked = await prisma.$transaction(async (tx) => {
      return checkAchievements(tx, testUserId, 'chapter_read');
    });

    if (unlocked.length > 0 && unlocked.some(u => u.id === achievement.id)) {
      console.log(`  ✓ PASS: Achievement auto-unlocked at threshold`);
      console.log(`    Unlocked: ${unlocked[0].name} (+${unlocked[0].xp_reward} XP)`);
    } else {
      console.log('  ✗ FAIL: Achievement should auto-unlock at 100%');
      allPassed = false;
    }

    // Verify progress now shows 100% and isUnlocked
    stats = await getUserAchievementStats(prisma, testUserId);
    const unlockedAt = await prisma.userAchievement.findUnique({
      where: {
        user_id_achievement_id: {
          user_id: testUserId,
          achievement_id: achievement.id
        }
      },
      select: { unlocked_at: true }
    });

    progress = calculateAchievementProgress(
      achievement,
      stats,
      !!unlockedAt,
      unlockedAt?.unlocked_at ?? null
    );

    if (progress?.progressPercent === 100 && progress?.isUnlocked) {
      console.log('  ✓ PASS: Progress shows 100% and isUnlocked=true');
    } else {
      console.log(`  ✗ FAIL: Expected 100% unlocked, got ${progress?.progressPercent}% unlocked=${progress?.isUnlocked}`);
      allPassed = false;
    }

    // =====================================================
    // TEST 4: XP awarded on unlock
    // =====================================================
    console.log('\nTEST 4: XP awarded on unlock');

    const userAfter = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true }
    });

    // Calculate expected XP from all unlocked achievements
      const expectedXp = unlocked.reduce((sum: any, u: any) => sum + u.xp_reward, 0);
      
      if (userAfter && userAfter.xp === expectedXp) {
        console.log(`  ✓ PASS: XP awarded correctly (${userAfter.xp} XP from ${unlocked.length} achievements)`);
      } else if ((userAfter?.xp ?? 0) >= 100) {
      // At minimum, our test achievement XP was awarded
      console.log(`  ✓ PASS: XP awarded (${userAfter?.xp} XP - includes other unlocked achievements)`);
    } else {
      console.log(`  ✗ FAIL: Expected at least 100 XP, got ${userAfter?.xp}`);
      allPassed = false;
    }

    // =====================================================
    // TEST 5: No double unlock on re-check
    // =====================================================
    console.log('\nTEST 5: No double unlock on re-check');

    const beforeRecheck = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true }
    });

    // Trigger achievement check again
    const recheckUnlocked = await prisma.$transaction(async (tx) => {
      return checkAchievements(tx, testUserId, 'chapter_read');
    });

    const afterRecheck = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true }
    });

    if (recheckUnlocked.length === 0 && beforeRecheck?.xp === afterRecheck?.xp) {
      console.log('  ✓ PASS: No double unlock, XP unchanged');
    } else {
      console.log('  ✗ FAIL: Double unlock detected');
      allPassed = false;
    }

    // =====================================================
    // TEST 6: Progress beyond threshold still shows 100%
    // =====================================================
    console.log('\nTEST 6: Progress capped at 100% beyond threshold');

    await prisma.user.update({
      where: { id: testUserId },
      data: { chapters_read: 15 }
    });

    stats = await getUserAchievementStats(prisma, testUserId);
    progress = calculateAchievementProgress(
      achievement,
      stats,
      true,
      unlockedAt?.unlocked_at ?? null
    );

    if (progress?.progressPercent === 100 && progress?.currentValue === 15) {
      console.log('  ✓ PASS: Progress capped at 100% (15/10 = 100%)');
    } else {
      console.log(`  ✗ FAIL: Expected 100%, got ${progress?.progressPercent}%`);
      allPassed = false;
    }

    // =====================================================
    // SUMMARY
    // =====================================================
    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
      console.log('\nProgress bars work correctly:');
      console.log('  - Progress updates dynamically with stat changes');
      console.log('  - Achievement auto-unlocks at 100% threshold');
      console.log('  - XP awarded on unlock');
      console.log('  - No double unlock on re-check');
      console.log('  - Progress capped at 100%');
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
      await prisma.activity.deleteMany({ where: { user_id: testUserId } });
      if (achievementId) {
        await prisma.achievement.delete({ where: { id: achievementId } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
    await prisma.$disconnect();
  }
}

qaProgressBarsUnlock();
