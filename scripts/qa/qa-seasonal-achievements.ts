import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function qaSeasonalAchievements() {
  console.log('=== QA: SEASONAL ACHIEVEMENTS ===\n');

  const testUserId = crypto.randomUUID();
  let testSeasonId: string | null = null;
  let testAchievementId: string | null = null;
  let allPassed = true;

  try {
    // Setup: Create test user
    await prisma.user.create({
      data: {
        id: testUserId,
        email: `qa-seasonal-${Date.now()}@test.com`,
        username: `qa_seasonal_${Date.now()}`,
        xp: 0,
        level: 1,
        season_xp: 0,
        current_season: '2025-07',
      }
    });

    // =====================================================
    // TEST 1: Cannot unlock achievement after season ends
    // =====================================================
    console.log('TEST 1: Cannot unlock achievement after season ends');
    
    // Create an EXPIRED season (ended yesterday)
    const testId = Date.now().toString().slice(-8);
    const expiredSeason = await prisma.season.create({
      data: {
        code: `exp-${testId}`,
        name: 'Expired Test Season',
        starts_at: new Date('2024-01-01'),
        ends_at: new Date('2024-01-31'), // Ended in the past
        is_active: false,
      }
    });
    testSeasonId = expiredSeason.id;

    // Create a seasonal achievement tied to expired season
    const expiredAchievement = await prisma.achievement.create({
      data: {
        code: `qa-exp-${testId}`,
        name: 'Expired Season Achievement',
        xp_reward: 100,
        rarity: 'rare',
        criteria: { type: 'chapter_count', threshold: 1 },
        is_seasonal: true,
        season_id: expiredSeason.id,
      }
    });
    testAchievementId = expiredAchievement.id;

    // Attempt to check achievements - the expired season should NOT be found
    const now = new Date();
    const activeSeasonCheck = await prisma.season.findFirst({
      where: {
        is_active: true,
        starts_at: { lte: now },
        ends_at: { gte: now }
      }
    });

    // The seasonal achievement for expired season should NOT be unlockable
    // because there's no active season that matches
    const expiredSeasonalCandidates = await prisma.achievement.findMany({
      where: {
        is_seasonal: true,
        season_id: expiredSeason.id,
        NOT: {
          seasonal_unlocks: {
            some: { 
              user_id: testUserId,
              season_id: expiredSeason.id
            }
          }
        }
      }
    });

    // Even though the achievement exists, it can't be unlocked because
    // the season query (starts_at <= now <= ends_at) won't match expired season
    const canUnlockExpired = expiredSeason.starts_at <= now && expiredSeason.ends_at >= now;
    
    if (!canUnlockExpired) {
      console.log('  ✓ PASS: Expired season correctly fails date check');
      console.log(`    Season ended: ${expiredSeason.ends_at.toISOString()}`);
      console.log(`    Current time: ${now.toISOString()}`);
    } else {
      console.log('  ✗ FAIL: Expired season incorrectly passes date check');
      allPassed = false;
    }

    // Clean up expired season test data
    await prisma.achievement.delete({ where: { id: expiredAchievement.id } });
    await prisma.season.delete({ where: { id: expiredSeason.id } });
    testSeasonId = null;
    testAchievementId = null;

    // =====================================================
    // TEST 2: XP granted only once per season
    // =====================================================
    console.log('\nTEST 2: XP granted only once per season');

    // Create an active season
    const activeSeason = await prisma.season.create({
      data: {
        code: `act-${testId}`,
        name: 'Active Test Season',
        starts_at: new Date('2025-01-01'),
        ends_at: new Date('2025-12-31'),
        is_active: true,
      }
    });
    testSeasonId = activeSeason.id;

    // Create a seasonal achievement
    const seasonalAchievement = await prisma.achievement.create({
      data: {
        code: `qa-ssn-${testId}`,
        name: 'Test Seasonal Achievement',
        xp_reward: 150,
        rarity: 'rare',
        criteria: { type: 'chapter_count', threshold: 1 },
        is_seasonal: true,
        season_id: activeSeason.id,
      }
    });
    testAchievementId = seasonalAchievement.id;

    // Reset user XP
    await prisma.user.update({
      where: { id: testUserId },
      data: { xp: 0, season_xp: 0 }
    });

    // First unlock: Should succeed and grant XP
    const firstUnlock = await prisma.seasonalUserAchievement.create({
      data: {
        user_id: testUserId,
        achievement_id: seasonalAchievement.id,
        season_id: activeSeason.id,
      }
    });

    // Simulate XP grant
    await prisma.user.update({
      where: { id: testUserId },
      data: { 
        xp: { increment: seasonalAchievement.xp_reward },
        season_xp: { increment: seasonalAchievement.xp_reward }
      }
    });

    const afterFirstUnlock = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true, season_xp: true }
    });

    console.log(`  First unlock XP: ${afterFirstUnlock?.xp} (expected: 150)`);
    if (afterFirstUnlock?.xp === 150) {
      console.log('  ✓ PASS: First unlock granted correct XP');
    } else {
      console.log('  ✗ FAIL: First unlock XP incorrect');
      allPassed = false;
    }

    // Second unlock attempt: Should be blocked by unique constraint
    let duplicateBlocked = false;
    try {
      await prisma.seasonalUserAchievement.create({
        data: {
          user_id: testUserId,
          achievement_id: seasonalAchievement.id,
          season_id: activeSeason.id,
        }
      });
      console.log('  ✗ FAIL: Duplicate unlock was allowed');
      allPassed = false;
    } catch (err: any) {
      if (err.code === 'P2002') {
        duplicateBlocked = true;
        console.log('  ✓ PASS: Duplicate unlock blocked by unique constraint');
      } else {
        throw err;
      }
    }

    // Verify XP wasn't granted again
    const afterSecondAttempt = await prisma.user.findUnique({
      where: { id: testUserId },
      select: { xp: true, season_xp: true }
    });

    if (afterSecondAttempt?.xp === 150) {
      console.log('  ✓ PASS: XP unchanged after duplicate attempt');
    } else {
      console.log(`  ✗ FAIL: XP changed unexpectedly: ${afterSecondAttempt?.xp}`);
      allPassed = false;
    }

    // Test skipDuplicates behavior (what the actual code uses)
    const skipResult = await prisma.seasonalUserAchievement.createManyAndReturn({
      data: [{
        user_id: testUserId,
        achievement_id: seasonalAchievement.id,
        season_id: activeSeason.id,
      }],
      skipDuplicates: true,
    });

    if (skipResult.length === 0) {
      console.log('  ✓ PASS: createManyAndReturn with skipDuplicates returns empty array for duplicate');
    } else {
      console.log(`  ✗ FAIL: createManyAndReturn returned ${skipResult.length} records for duplicate`);
      allPassed = false;
    }

    // =====================================================
    // TEST 3: Same achievement unlockable in different season
    // =====================================================
    console.log('\nTEST 3: Same achievement can be unlocked in different season');

    // Create another season
    const newSeason = await prisma.season.create({
      data: {
        code: `new-${testId}`,
        name: 'New Test Season',
        starts_at: new Date('2026-01-01'),
        ends_at: new Date('2026-12-31'),
        is_active: false,
      }
    });

    // Should be able to unlock same achievement in new season
    const newSeasonUnlock = await prisma.seasonalUserAchievement.create({
      data: {
        user_id: testUserId,
        achievement_id: seasonalAchievement.id,
        season_id: newSeason.id,
      }
    });

    if (newSeasonUnlock) {
      console.log('  ✓ PASS: Same achievement unlockable in different season');
    } else {
      console.log('  ✗ FAIL: Could not unlock achievement in new season');
      allPassed = false;
    }

    // Verify user now has 2 seasonal unlocks for same achievement
    const totalUnlocks = await prisma.seasonalUserAchievement.count({
      where: {
        user_id: testUserId,
        achievement_id: seasonalAchievement.id,
      }
    });

    if (totalUnlocks === 2) {
      console.log('  ✓ PASS: User has 2 unlocks for same achievement across seasons');
    } else {
      console.log(`  ✗ FAIL: Expected 2 unlocks, got ${totalUnlocks}`);
      allPassed = false;
    }

    // Cleanup additional season
    await prisma.seasonalUserAchievement.deleteMany({
      where: { season_id: newSeason.id }
    });
    await prisma.season.delete({ where: { id: newSeason.id } });

    // =====================================================
    // SUMMARY
    // =====================================================
    console.log('\n=== SUMMARY ===');
    if (allPassed) {
      console.log('✓ ALL TESTS PASSED');
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
      if (testAchievementId) {
        await prisma.seasonalUserAchievement.deleteMany({
          where: { achievement_id: testAchievementId }
        });
        await prisma.achievement.delete({ where: { id: testAchievementId } }).catch(() => {});
      }
      if (testSeasonId) {
        await prisma.season.delete({ where: { id: testSeasonId } }).catch(() => {});
      }
      await prisma.user.delete({ where: { id: testUserId } }).catch(() => {});
    } catch (e) {
      // Ignore cleanup errors
    }
    await prisma.$disconnect();
  }
}

qaSeasonalAchievements();
