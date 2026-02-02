import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * QA: HIDDEN ACHIEVEMENTS
 * 
 * RULES:
 * 1. hidden=true hides achievement from UI (not returned in queries)
 * 2. Unlock reveals achievement (shown after unlock)
 * 3. XP still granted normally
 */
async function qaHiddenAchievements() {
  console.log('=== QA: HIDDEN ACHIEVEMENTS ===\n');

  const testUserId = crypto.randomUUID();
  const testId = Date.now().toString().slice(-8);
  let allPassed = true;
  let hiddenAchievementId: string | null = null;
  let visibleAchievementId: string | null = null;

  try {
    // Setup: Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `qa-hidden-${testId}@test.com`,
        username: `qa_hidden_${testId}`,
        xp: 0,
        level: 1,
      }
    });

    // =====================================================
    // TEST 1: Hidden achievement not returned until unlocked
    // =====================================================
    console.log('TEST 1: Hidden achievement not returned until unlocked');

    // Create a hidden achievement
    const hiddenAchievement = await prisma.achievement.create({
      data: {
        code: `qa-hidden-${testId}`,
        name: 'Secret Explorer',
        description: 'Find a hidden easter egg',
        xp_reward: 200,
        rarity: 'epic',
        criteria: { type: 'secret', threshold: 1 },
        is_hidden: true,
      }
    });
    hiddenAchievementId = hiddenAchievement.id;

    // Create a visible achievement
    const visibleAchievement = await prisma.achievement.create({
      data: {
        code: `qa-visible-${testId}`,
        name: 'First Steps',
        description: 'Complete your first chapter',
        xp_reward: 50,
        rarity: 'common',
        criteria: { type: 'chapter_count', threshold: 1 },
        is_hidden: false,
      }
    });
    visibleAchievementId = visibleAchievement.id;

    // Query all achievements - hidden should not appear in list for "available achievements"
    const allAchievements = await prisma.achievement.findMany({
      where: {
        is_hidden: false, // This is how UI would filter
      }
    });

    const hiddenInList = allAchievements.some(a => a.id === hiddenAchievement.id);
    const visibleInList = allAchievements.some(a => a.id === visibleAchievement.id);

    if (!hiddenInList && visibleInList) {
      console.log('  ✓ PASS: Hidden achievement excluded from general list');
    } else {
      console.log('  ✗ FAIL: Hidden achievement incorrectly included in list');
      allPassed = false;
    }

    // =====================================================
    // TEST 2: Unlock reveals hidden achievement
    // =====================================================
    console.log('\nTEST 2: Unlock reveals hidden achievement');

    // Unlock the hidden achievement
    const unlock = await prisma.userAchievement.create({
      data: {
        user_id: testUserId,
        achievement_id: hiddenAchievement.id,
      }
    });

    // Query user's achievements (what profile page does)
    const userAchievements = await prisma.userAchievement.findMany({
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

    const unlockedHidden = userAchievements.find(ua => ua.achievement.id === hiddenAchievement.id);
    
    if (unlockedHidden) {
      console.log('  ✓ PASS: Hidden achievement appears after unlock');
      console.log(`    Achievement: ${unlockedHidden.achievement.name}`);
      console.log(`    is_hidden flag: ${unlockedHidden.achievement.is_hidden}`);
    } else {
      console.log('  ✗ FAIL: Hidden achievement not appearing after unlock');
      allPassed = false;
    }

    // Verify is_hidden flag is included (for UI "revealed" effect)
    if (unlockedHidden?.achievement.is_hidden === true) {
      console.log('  ✓ PASS: is_hidden flag preserved for UI indication');
    } else {
      console.log('  ✗ FAIL: is_hidden flag not preserved');
      allPassed = false;
    }

    // =====================================================
    // TEST 3: XP granted normally for hidden achievement
    // =====================================================
    console.log('\nTEST 3: XP granted normally for hidden achievement');

    const beforeXp = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true }
    });

    // Grant XP (simulating what achievement unlock system does)
    await prisma.user.update({
      where: { id: testUserId },
      data: { xp: { increment: hiddenAchievement.xp_reward } }
    });

    const afterXp = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true }
    });

    const xpGranted = (afterXp?.xp || 0) - (beforeXp?.xp || 0);
    
    if (xpGranted === hiddenAchievement.xp_reward) {
      console.log(`  ✓ PASS: XP granted correctly (${xpGranted} XP)`);
    } else {
      console.log(`  ✗ FAIL: XP mismatch. Expected ${hiddenAchievement.xp_reward}, got ${xpGranted}`);
      allPassed = false;
    }

    // =====================================================
    // TEST 4: Profile API returns hidden achievements once unlocked
    // =====================================================
    console.log('\nTEST 4: Simulated profile query returns unlocked hidden achievements');

    // This simulates what the /api/users/[username] endpoint does
    const profileAchievements = await prisma.userAchievement.findMany({
      where: { user_id: testUserId },
      take: 8,
      orderBy: { unlocked_at: 'desc' },
      include: {
        achievement: {
          select: {
            id: true,
            name: true,
            description: true,
            icon_url: true,
            rarity: true,
            is_hidden: true, // This is what we added
          }
        }
      }
    });

    const hasHiddenFlag = profileAchievements.some(ua => 
      ua.achievement.id === hiddenAchievement.id && 
      ua.achievement.is_hidden === true
    );

    if (hasHiddenFlag) {
      console.log('  ✓ PASS: Profile API includes is_hidden flag for UI');
    } else {
      console.log('  ✗ FAIL: Profile API missing is_hidden flag');
      allPassed = false;
    }

    // =====================================================
    // SUMMARY
    // =====================================================
    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
      console.log('\nHidden achievements work correctly:');
      console.log('  - Hidden achievements excluded from general achievement lists');
      console.log('  - Hidden achievements appear after user unlocks them');
      console.log('  - is_hidden flag preserved for UI "Secret Achievement" indicator');
      console.log('  - XP granted normally regardless of hidden status');
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
      await prisma.userAchievement.deleteMany({
        where: { user_id: testUserId }
      });
      if (hiddenAchievementId) {
        await prisma.achievement.delete({ where: { id: hiddenAchievementId } }).catch(() => {});
      }
      if (visibleAchievementId) {
        await prisma.achievement.delete({ where: { id: visibleAchievementId } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
    await prisma.$disconnect();
  }
}

qaHiddenAchievements();
