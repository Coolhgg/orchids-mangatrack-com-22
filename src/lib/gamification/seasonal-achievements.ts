/**
 * SEASONAL ACHIEVEMENT SETS
 * 
 * PURPOSE:
 * - Prevents long-term stagnation ("I already unlocked everything")
 * - Creates fresh goals every season
 * - Drives short-term engagement without power creep
 * - Aligns with quarterly anime-season XP resets
 * 
 * RULES (LOCKED):
 * 1. Seasonal achievements reset availability, not history
 * 2. XP goes to BOTH lifetime XP and seasonal XP
 * 3. Only seasonal XP resets to 0 at season end (lifetime XP never resets)
 * 4. They expire when the season ends
 * 5. Old seasons remain visible as "completed / missed"
 * 6. Unique constraint: (user_id, achievement_id, season_id)
 * 
 * SEASON DEFINITION:
 * - Winter (Q1): Jan 1 – Mar 31
 * - Spring (Q2): Apr 1 – Jun 30  
 * - Summer (Q3): Jul 1 – Sep 30
 * - Fall (Q4): Oct 1 – Dec 31
 */

import { TransactionClient } from '../prisma';
import { getCurrentSeason, getSeasonDateRange, getCurrentSeasonInfo } from './seasons';
import { calculateLevel } from './xp';
import { calculateSeasonXpUpdate } from './seasons';
import { logActivity } from './activity';

export type SeasonalAchievementRarity = 'common' | 'rare' | 'legendary';

export type SeasonalAchievementCriteriaType = 
  | 'chapters_read_season'
  | 'series_added_season'
  | 'streak_season'
  | 'series_completed_season'
  | 'seasonal_xp_percentile';

export interface SeasonalAchievementCriteria {
  type: SeasonalAchievementCriteriaType;
  threshold: number;
}

export interface SeasonalAchievementDefinition {
  code: string;
  name: string;
  description: string;
  xp_reward: number;
  rarity: SeasonalAchievementRarity;
  criteria: SeasonalAchievementCriteria;
  is_end_of_season?: boolean;
}

/**
 * Seasonal achievement definitions per spec
 * 
 * COMMON: Easy to unlock, lower XP
 * RARE: Moderate effort, medium XP
 * LEGENDARY: High commitment, high XP
 */
export const SEASONAL_ACHIEVEMENTS: SeasonalAchievementDefinition[] = [
  // COMMON
  {
    code: 'seasonal_reader_25',
    name: 'Seasonal Reader',
    description: 'Read 25 chapters this season',
    xp_reward: 50,
    rarity: 'common',
    criteria: { type: 'chapters_read_season', threshold: 25 },
  },
  {
    code: 'seasonal_tracker_5',
    name: 'Seasonal Explorer',
    description: 'Track 5 new manga this season',
    xp_reward: 50,
    rarity: 'common',
    criteria: { type: 'series_added_season', threshold: 5 },
  },
  
  // RARE
  {
    code: 'seasonal_reader_150',
    name: 'Seasonal Devourer',
    description: 'Read 150 chapters this season',
    xp_reward: 200,
    rarity: 'rare',
    criteria: { type: 'chapters_read_season', threshold: 150 },
  },
  {
    code: 'seasonal_streak_14',
    name: 'Seasonal Dedication',
    description: 'Maintain a 14-day streak this season',
    xp_reward: 200,
    rarity: 'rare',
    criteria: { type: 'streak_season', threshold: 14 },
  },
  
  // LEGENDARY
  {
    code: 'seasonal_reader_500',
    name: 'Seasonal Legend',
    description: 'Read 500 chapters this season',
    xp_reward: 500,
    rarity: 'legendary',
    criteria: { type: 'chapters_read_season', threshold: 500 },
  },
  {
    code: 'seasonal_completionist_10',
    name: 'Seasonal Closer',
    description: 'Complete 10 series this season',
    xp_reward: 500,
    rarity: 'legendary',
    criteria: { type: 'series_completed_season', threshold: 10 },
  },
  
  // END-OF-SEASON (awarded by scheduled job)
  {
    code: 'seasonal_top_10',
    name: 'Top 10% Reader',
    description: 'Finish the season in the top 10% of readers',
    xp_reward: 300,
    rarity: 'rare',
    criteria: { type: 'seasonal_xp_percentile', threshold: 10 },
    is_end_of_season: true,
  },
  {
    code: 'seasonal_top_1',
    name: 'Seasonal Champion',
    description: 'Finish the season in the top 1% of readers',
    xp_reward: 1000,
    rarity: 'legendary',
    criteria: { type: 'seasonal_xp_percentile', threshold: 1 },
    is_end_of_season: true,
  },
];

export interface SeasonalUserStats {
  chapters_read: number;
  series_completed: number;
  series_added: number;
  streak_max: number;
  seasonal_xp: number;
}

/**
 * Get user's seasonal stats for a specific season
 */
export async function getSeasonalUserStats(
  tx: TransactionClient,
  userId: string,
  seasonCode?: string
): Promise<SeasonalUserStats> {
  const targetSeason = seasonCode || getCurrentSeason();
  const dateRange = getSeasonDateRange(targetSeason);
  
  if (!dateRange) {
    return {
      chapters_read: 0,
      series_completed: 0,
      series_added: 0,
      streak_max: 0,
      seasonal_xp: 0,
    };
  }

  const { start, end } = dateRange;

  const [
    chaptersRead,
    completedCount,
    libraryCount,
    user,
  ] = await Promise.all([
    tx.userChapterReadV2.count({
      where: {
        user_id: userId,
        read_at: {
          gte: start,
          lte: end,
        },
      },
    }),
    
    tx.libraryEntry.count({
      where: {
        user_id: userId,
        status: 'completed',
        deleted_at: null,
        updated_at: {
          gte: start,
          lte: end,
        },
      },
    }),
    
    tx.libraryEntry.count({
      where: {
        user_id: userId,
        deleted_at: null,
        added_at: {
          gte: start,
          lte: end,
        },
      },
    }),
    
    tx.user.findUnique({
      where: { id: userId },
      select: {
        season_xp: true,
        current_season: true,
        streak_days: true,
        longest_streak: true,
      },
    }),
  ]);

  const isCurrentSeason = user?.current_season === targetSeason;
  const streakMax = isCurrentSeason 
    ? Math.max(user?.streak_days || 0, user?.longest_streak || 0)
    : 0;

  return {
    chapters_read: chaptersRead,
    series_completed: completedCount,
    series_added: libraryCount,
    streak_max: streakMax,
    seasonal_xp: isCurrentSeason ? (user?.season_xp || 0) : 0,
  };
}

export interface SeasonalAchievementUnlock {
  id: string;
  code: string;
  name: string;
  xp_reward: number;
  rarity: string;
  season_id: string;
  season_code: string;
}

/**
 * Check and award seasonal achievements for a user
 * 
 * XP RULES:
 * - XP goes to BOTH lifetime xp AND season_xp
 * - Only season_xp resets at season end
 * - Lifetime xp NEVER resets
 * 
 * Each achievement can only be earned once per season
 * End-of-season achievements are awarded by scheduled job
 */
export async function checkSeasonalAchievements(
  tx: TransactionClient,
  userId: string,
  trigger: 'chapter_read' | 'series_completed' | 'series_added' | 'streak_updated'
): Promise<SeasonalAchievementUnlock[]> {
  const now = new Date();
  
  const activeSeason = await tx.season.findFirst({
    where: {
      is_active: true,
      starts_at: { lte: now },
      ends_at: { gte: now },
    },
  });

  if (!activeSeason) {
    return [];
  }

  const stats = await getSeasonalUserStats(tx, userId, activeSeason.code);

  const triggerToCriteria: Record<string, SeasonalAchievementCriteriaType[]> = {
    chapter_read: ['chapters_read_season'],
    series_completed: ['series_completed_season'],
    series_added: ['series_added_season'],
    streak_updated: ['streak_season'],
  };

  const relevantTypes = triggerToCriteria[trigger] || [];
  if (relevantTypes.length === 0) return [];

  const candidates = await tx.achievement.findMany({
    where: {
      is_seasonal: true,
      OR: [
        { season_id: activeSeason.id },
        { season_id: null }
      ],
      NOT: {
        seasonal_unlocks: {
          some: {
            user_id: userId,
            season_id: activeSeason.id,
          },
        },
      },
    },
  });

  const relevantAchievements = candidates.filter((achievement: { criteria: unknown }) => {
    const criteria = achievement.criteria as SeasonalAchievementCriteria | null;
    if (!criteria) return false;
    if (criteria.type === 'seasonal_xp_percentile') return false;
    return relevantTypes.includes(criteria.type);
  });

  if (relevantAchievements.length === 0) return [];

  const newlyUnlocked: SeasonalAchievementUnlock[] = [];
  let totalXp = 0;

  for (const achievement of relevantAchievements) {
    const criteria = achievement.criteria as SeasonalAchievementCriteria;
    const currentValue = getStatForCriteria(stats, criteria.type);

    if (currentValue >= criteria.threshold) {
      try {
        const result = await tx.seasonalUserAchievement.createManyAndReturn({
          data: [{
            user_id: userId,
            achievement_id: achievement.id,
            season_id: activeSeason.id,
          }],
          skipDuplicates: true,
        });

        if (result.length === 0) continue;

        totalXp += achievement.xp_reward;

        await logActivity(tx, userId, 'seasonal_achievement_unlocked', {
          achievementId: achievement.id,
          metadata: {
            code: achievement.code,
            xp_reward: achievement.xp_reward,
            season_id: activeSeason.id,
            season_code: activeSeason.code,
          },
        });

        newlyUnlocked.push({
          id: achievement.id,
          code: achievement.code,
          name: achievement.name,
          xp_reward: achievement.xp_reward,
          rarity: achievement.rarity,
          season_id: activeSeason.id,
          season_code: activeSeason.code,
        });

      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'code' in err && err.code !== 'P2002') {
          throw err;
        }
      }
    }
  }

  // Award XP to BOTH lifetime AND seasonal
  // Only seasonal XP resets at season end - lifetime XP is permanent
  if (totalXp > 0) {
    const userProfile = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true, season_xp: true, current_season: true },
    });

    // Calculate new lifetime XP and level
    const newLifetimeXp = (userProfile?.xp ?? 0) + totalXp;
    const newLevel = calculateLevel(newLifetimeXp);

    // Calculate seasonal XP update (handles season rollover)
    const seasonUpdate = calculateSeasonXpUpdate(
      userProfile?.season_xp ?? null,
      userProfile?.current_season ?? null,
      totalXp
    );

    await tx.user.update({
      where: { id: userId },
      data: {
        // Lifetime XP - never resets
        xp: newLifetimeXp,
        level: newLevel,
        // Seasonal XP - resets each season
        season_xp: seasonUpdate.season_xp,
        current_season: seasonUpdate.current_season,
      },
    });
  }

  return newlyUnlocked;
}

function getStatForCriteria(
  stats: SeasonalUserStats,
  criteriaType: SeasonalAchievementCriteriaType
): number {
  const mapping: Record<SeasonalAchievementCriteriaType, keyof SeasonalUserStats> = {
    chapters_read_season: 'chapters_read',
    series_completed_season: 'series_completed',
    series_added_season: 'series_added',
    streak_season: 'streak_max',
    seasonal_xp_percentile: 'seasonal_xp',
  };

  return stats[mapping[criteriaType]] || 0;
}

/**
 * Award end-of-season percentile achievements
 * Called by a scheduled job at season end
 * 
 * Note: End-of-season XP also goes to lifetime XP since it's still earned XP
 */
export async function awardEndOfSeasonAchievements(
  tx: TransactionClient,
  seasonId: string
): Promise<{ userId: string; achievements: SeasonalAchievementUnlock[] }[]> {
  const season = await tx.season.findUnique({
    where: { id: seasonId },
  });

  if (!season) {
    throw new Error(`Season not found: ${seasonId}`);
  }

  const usersWithXp = await tx.user.findMany({
    where: {
      current_season: season.code,
      season_xp: { gt: 0 },
    },
    select: {
      id: true,
      season_xp: true,
    },
    orderBy: {
      season_xp: 'desc',
    },
  });

  if (usersWithXp.length === 0) {
    return [];
  }

  const totalUsers = usersWithXp.length;
  const results: { userId: string; achievements: SeasonalAchievementUnlock[] }[] = [];

  const percentileAchievements = await tx.achievement.findMany({
    where: {
      is_seasonal: true,
      code: {
        in: ['seasonal_top_10', 'seasonal_top_1'],
      },
    },
  });

  const achievementByCode = new Map(percentileAchievements.map((a: { code: string }) => [a.code, a]));

  const top10Index = Math.ceil(totalUsers * 0.10);
  const top1Index = Math.ceil(totalUsers * 0.01);

  for (let i = 0; i < usersWithXp.length; i++) {
    const user = usersWithXp[i];
    const rank = i + 1;
    const userAchievements: SeasonalAchievementUnlock[] = [];
    let totalXp = 0;

    let achievementToAward: typeof percentileAchievements[0] | null = null;

    if (rank <= top1Index && achievementByCode.has('seasonal_top_1')) {
      achievementToAward = achievementByCode.get('seasonal_top_1')!;
    } else if (rank <= top10Index && achievementByCode.has('seasonal_top_10')) {
      achievementToAward = achievementByCode.get('seasonal_top_10')!;
    }

    if (achievementToAward) {
      try {
        const result = await tx.seasonalUserAchievement.createManyAndReturn({
          data: [{
            user_id: user.id,
            achievement_id: achievementToAward.id,
            season_id: seasonId,
          }],
          skipDuplicates: true,
        });

        if (result.length > 0) {
          totalXp += achievementToAward.xp_reward;

          userAchievements.push({
            id: achievementToAward.id,
            code: achievementToAward.code,
            name: achievementToAward.name,
            xp_reward: achievementToAward.xp_reward,
            rarity: achievementToAward.rarity,
            season_id: seasonId,
            season_code: season.code,
          });

          await logActivity(tx, user.id, 'seasonal_achievement_unlocked', {
            achievementId: achievementToAward.id,
            metadata: {
              code: achievementToAward.code,
              xp_reward: achievementToAward.xp_reward,
              season_id: seasonId,
              season_code: season.code,
              final_rank: rank,
              percentile: Math.round((1 - rank / totalUsers) * 100),
            },
          });
        }
      } catch {
        // Skip if already awarded
      }
    }

    // End-of-season XP goes to lifetime XP
    // (Seasonal XP will be archived and reset by the season transition job)
    if (totalXp > 0) {
      const userProfile = await tx.user.findUnique({
        where: { id: user.id },
        select: { xp: true },
      });

      const newXp = (userProfile?.xp ?? 0) + totalXp;
      const newLevel = calculateLevel(newXp);

      await tx.user.update({
        where: { id: user.id },
        data: {
          xp: newXp,
          level: newLevel,
        },
      });
    }

    if (userAchievements.length > 0) {
      results.push({ userId: user.id, achievements: userAchievements });
    }
  }

  return results;
}

export interface SeasonalAchievementProgress {
  code: string;
  name: string;
  description: string;
  xp_reward: number;
  rarity: string;
  current_value: number;
  threshold: number;
  progress_percent: number;
  is_unlocked: boolean;
  unlocked_at: Date | null;
  is_end_of_season: boolean;
}

export interface PastSeasonAchievement {
  code: string;
  name: string;
  description: string;
  xp_reward: number;
  rarity: string;
  status: 'completed' | 'missed';
  unlocked_at: Date | null;
  season_code: string;
  season_name: string;
}

/**
 * Get seasonal achievement progress for a user (current season)
 */
export async function getSeasonalAchievementProgress(
  tx: TransactionClient,
  userId: string
): Promise<{
  season: { code: string; name: string; days_remaining: number; ends_at: Date };
  achievements: SeasonalAchievementProgress[];
  stats: SeasonalUserStats;
}> {
  const now = new Date();
  const seasonInfo = getCurrentSeasonInfo();
  const dateRange = getSeasonDateRange(seasonInfo.code);

  const activeSeason = await tx.season.findFirst({
    where: {
      is_active: true,
      starts_at: { lte: now },
      ends_at: { gte: now },
    },
  });

  if (!activeSeason || !dateRange) {
    return {
      season: {
        code: seasonInfo.code,
        name: seasonInfo.displayName,
        days_remaining: 0,
        ends_at: new Date(),
      },
      achievements: [],
      stats: {
        chapters_read: 0,
        series_completed: 0,
        series_added: 0,
        streak_max: 0,
        seasonal_xp: 0,
      },
    };
  }

  const stats = await getSeasonalUserStats(tx, userId, activeSeason.code);

  const seasonalAchievements = await tx.achievement.findMany({
    where: {
      is_seasonal: true,
      OR: [
        { season_id: activeSeason.id },
        { season_id: null }
      ],
    },
  });

  const unlockedAchievements = await tx.seasonalUserAchievement.findMany({
    where: {
      user_id: userId,
      season_id: activeSeason.id,
    },
    select: {
      achievement_id: true,
      unlocked_at: true,
    },
  });

  const unlockedMap = new Map<string, Date>(
    unlockedAchievements.map((ua: { achievement_id: string; unlocked_at: Date }) => [ua.achievement_id, ua.unlocked_at])
  );

  const achievements: SeasonalAchievementProgress[] = [];

  for (const achievement of seasonalAchievements) {
    const criteria = achievement.criteria as SeasonalAchievementCriteria;
    if (!criteria) continue;
    
    const isEndOfSeason = criteria.type === 'seasonal_xp_percentile';
    const currentValue = isEndOfSeason ? 0 : getStatForCriteria(stats, criteria.type);
    const threshold = criteria.threshold;
    const progressPercent = isEndOfSeason 
      ? 0 
      : Math.min(100, Math.round((currentValue / threshold) * 100));
    const isUnlocked = unlockedMap.has(achievement.id);
    const unlockedAt = unlockedMap.get(achievement.id) || null;

    achievements.push({
      code: achievement.code,
      name: achievement.name,
      description: achievement.description || '',
      xp_reward: achievement.xp_reward,
      rarity: achievement.rarity,
      current_value: currentValue,
      threshold,
      progress_percent: progressPercent,
      is_unlocked: isUnlocked,
      unlocked_at: unlockedAt,
      is_end_of_season: isEndOfSeason,
    });
  }

  achievements.sort((a, b) => {
    if (a.is_unlocked !== b.is_unlocked) return a.is_unlocked ? 1 : -1;
    return b.progress_percent - a.progress_percent;
  });

  const daysRemaining = Math.max(
    0,
    Math.ceil((dateRange.end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );

  return {
    season: {
      code: activeSeason.code,
      name: activeSeason.name,
      days_remaining: daysRemaining,
      ends_at: activeSeason.ends_at,
    },
    achievements,
    stats,
  };
}

/**
 * Get past seasons with their achievements (completed or missed)
 */
export async function getPastSeasonAchievements(
  tx: TransactionClient,
  userId: string
): Promise<{
  season_code: string;
  season_name: string;
  final_xp: number;
  final_rank: number | null;
  achievements: PastSeasonAchievement[];
}[]> {
  const now = new Date();

  const pastSeasons = await tx.season.findMany({
    where: {
      ends_at: { lt: now },
    },
    orderBy: {
      starts_at: 'desc',
    },
  });

  if (pastSeasons.length === 0) {
    return [];
  }

  const results = [];

  for (const season of pastSeasons) {
    const seasonAchievements = await tx.achievement.findMany({
      where: {
        is_seasonal: true,
        OR: [
          { season_id: season.id },
          { season_id: null }
        ],
      },
    });

    const userUnlocked = await tx.seasonalUserAchievement.findMany({
      where: {
        user_id: userId,
        season_id: season.id,
      },
      select: {
        achievement_id: true,
        unlocked_at: true,
      },
    });

    const unlockedMap = new Map(
      userUnlocked.map((u: { achievement_id: string; unlocked_at: Date }) => [u.achievement_id, u.unlocked_at])
    );

    const userSeasonXp = await tx.userSeasonXP.findUnique({
      where: {
        user_id_season_id: {
          user_id: userId,
          season_id: season.id,
        },
      },
    });

    const achievements: PastSeasonAchievement[] = seasonAchievements.map((a: {
      id: string;
      code: string;
      name: string;
      description: string | null;
      xp_reward: number;
      rarity: string;
    }) => ({
      code: a.code,
      name: a.name,
      description: a.description || '',
      xp_reward: a.xp_reward,
      rarity: a.rarity,
      status: unlockedMap.has(a.id) ? 'completed' as const : 'missed' as const,
      unlocked_at: unlockedMap.get(a.id) || null,
      season_code: season.code,
      season_name: season.name,
    }));

    results.push({
      season_code: season.code,
      season_name: season.name,
      final_xp: userSeasonXp?.final_xp || 0,
      final_rank: userSeasonXp?.final_rank || null,
      achievements,
    });
  }

  return results;
}

/**
 * Seed seasonal achievements into the database
 */
export async function seedSeasonalAchievements(tx: TransactionClient): Promise<void> {
  for (const def of SEASONAL_ACHIEVEMENTS) {
    await tx.achievement.upsert({
      where: { code: def.code },
      update: {
        name: def.name,
        description: def.description,
        xp_reward: def.xp_reward,
        rarity: def.rarity,
        criteria: def.criteria,
        is_seasonal: true,
      },
      create: {
        code: def.code,
        name: def.name,
        description: def.description,
        xp_reward: def.xp_reward,
        rarity: def.rarity,
        criteria: def.criteria,
        is_seasonal: true,
      },
    });
  }
}
