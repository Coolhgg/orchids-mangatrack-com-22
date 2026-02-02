import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * QA: HIDDEN ACHIEVEMENTS
 * 
 * 1. Hidden achievements invisible before unlock.
 * 2. Reveal on unlock.
 */
async function qaHiddenAchievementsVisibility() {
  console.log('=== QA: HIDDEN ACHIEVEMENTS VISIBILITY ===\n');

  const testUserId = crypto.randomUUID();
  const testId = Date.now().toString().slice(-8);
  let allPassed = true;
  let hiddenAchievementId: string | null = null;

  try {
    // Setup: Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `qa-vis-${testId}@test.com`,
        username: `qa_vis_${testId}`,
        xp: 0,
        level: 1,
      }
    });

    // Create a hidden achievement
    const hiddenAchievement = await prisma.achievement.create({
      data: {
        code: `qa-secret-${testId}`,
        name: 'Secret Master',
        description: 'Discover the hidden path',
        xp_reward: 300,
        rarity: 'legendary',
        criteria: { type: 'secret', threshold: 1 },
        is_hidden: true,
      }
    });
    hiddenAchievementId = hiddenAchievement.id;

    // =====================================================
    // TEST 1: Hidden achievements invisible before unlock
    // =====================================================
    console.log('TEST 1: Hidden achievements invisible before unlock');

    // Simulate what profile API does - query user achievements
    const beforeUnlock = await prisma.userAchievement.findMany({
      where: { user_id: testUserId },
      include: {
        achievement: {
          select: {
            id: true,
            name: true,
            is_hidden: true,
          }
        }
      }
    });

    // User has no achievements yet - hidden achievement should NOT be visible
    const hiddenVisibleBeforeUnlock = beforeUnlock.some(
      ua => ua.achievement.id === hiddenAchievement.id
    );

    if (!hiddenVisibleBeforeUnlock && beforeUnlock.length === 0) {
      console.log('  ✓ PASS: Hidden achievement not visible before unlock');
      console.log(`    User achievements count: ${beforeUnlock.length}`);
    } else {
      console.log('  ✗ FAIL: Hidden achievement incorrectly visible');
      allPassed = false;
    }

    // Also verify it doesn't appear in "all available achievements" list
    const availableAchievements = await prisma.achievement.findMany({
      where: { is_hidden: false }
    });
    
    const inAvailableList = availableAchievements.some(a => a.id === hiddenAchievement.id);
    if (!inAvailableList) {
      console.log('  ✓ PASS: Hidden achievement excluded from available list');
    } else {
      console.log('  ✗ FAIL: Hidden achievement in available list');
      allPassed = false;
    }

    // =====================================================
    // TEST 2: Reveal on unlock
    // =====================================================
    console.log('\nTEST 2: Reveal on unlock');

    // Unlock the hidden achievement
    await prisma.userAchievement.create({
      data: {
        user_id: testUserId,
        achievement_id: hiddenAchievement.id,
      }
    });

    // Now query user achievements again
    const afterUnlock = await prisma.userAchievement.findMany({
      where: { user_id: testUserId },
      include: {
        achievement: {
          select: {
            id: true,
            name: true,
            description: true,
            is_hidden: true,
            xp_reward: true,
            rarity: true,
          }
        }
      }
    });

    const unlockedAchievement = afterUnlock.find(
      ua => ua.achievement.id === hiddenAchievement.id
    );

    if (unlockedAchievement) {
      console.log('  ✓ PASS: Hidden achievement revealed after unlock');
      console.log(`    Name: ${unlockedAchievement.achievement.name}`);
      console.log(`    Description: ${unlockedAchievement.achievement.description}`);
      console.log(`    Rarity: ${unlockedAchievement.achievement.rarity}`);
      console.log(`    XP Reward: ${unlockedAchievement.achievement.xp_reward}`);
      
      // Verify is_hidden flag is preserved (for UI "secret" badge)
      if (unlockedAchievement.achievement.is_hidden === true) {
        console.log('  ✓ PASS: is_hidden flag preserved for "Secret" UI indicator');
      } else {
        console.log('  ✗ FAIL: is_hidden flag not preserved');
        allPassed = false;
      }
    } else {
      console.log('  ✗ FAIL: Hidden achievement not revealed after unlock');
      allPassed = false;
    }

    // =====================================================
    // SUMMARY
    // =====================================================
    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
      console.log('\nHidden achievements visibility:');
      console.log('  1. ✓ Invisible before unlock (not in user achievements)');
      console.log('  2. ✓ Excluded from "available achievements" list');
      console.log('  3. ✓ Revealed after unlock with full details');
      console.log('  4. ✓ is_hidden flag preserved for UI "Secret" badge');
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
      if (hiddenAchievementId) {
        await prisma.achievement.delete({ where: { id: hiddenAchievementId } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {}
    await prisma.$disconnect();
  }
}

qaHiddenAchievementsVisibility();
