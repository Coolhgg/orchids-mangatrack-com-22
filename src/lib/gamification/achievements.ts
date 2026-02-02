
import { TransactionClient } from '../prisma';
import { logActivity } from './activity';
import { addXp, calculateLevel } from './xp';
import { calculateSeasonXpUpdate } from './seasons';

/**
 * ACHIEVEMENT XP RULESET (LOCKED):
 * 
 * 1. Achievements grant XP exactly ONCE per user (or once per season for seasonal).
 * 2. XP amount is FIXED per achievement (achievement.xp_reward).
 * 3. XP is granted ONLY at the moment the achievement is unlocked.
 * 4. XP must NOT be recalculated, multiplied, or scaled.
 * 5. Re-triggering the same achievement must NEVER grant XP again.
 * 6. Achievement XP is INDEPENDENT from Chapter/Streak/Completion XP.
 * 7. SEASONAL XP: Achievement XP updates BOTH lifetime xp AND season_xp.
 * 8. SEASONAL ACHIEVEMENTS: Can only be unlocked during active season, XP awarded once per season.
 */

export type AchievementTrigger = 
  | 'chapter_read' 
  | 'series_completed' 
  | 'streak_reached'
  | 'series_added'
  | 'follow';

interface AchievementCriteria {
  type: 'chapter_count' | 'completed_count' | 'library_count' | 'follow_count' | 'streak_count';
  threshold: number;
}

export interface UnlockedAchievement {
  id: string;
  code: string;
  name: string;
  xp_reward: number;
  rarity: string;
  is_seasonal?: boolean;
  season_id?: string | null;
}

const TRIGGER_TO_CRITERIA_TYPES: Record<AchievementTrigger, string[]> = {
  chapter_read: ['chapter_count'],
  series_completed: ['completed_count'],
  streak_reached: ['streak_count'],
  series_added: ['library_count'],
  follow: ['follow_count'],
};

/**
 * Checks and awards achievements for a user.
 * Returns array of newly unlocked achievements (empty if none or re-trigger).
 * XP is awarded INDEPENDENTLY inside this function.
 * 
 * SEASONAL RULES:
 * - Seasonal achievements can only be unlocked during their active season
 * - User can unlock the same seasonal achievement once per season
 * - XP is awarded once per season unlock
 */
export async function checkAchievements(
  tx: TransactionClient,
  userId: string,
  trigger: AchievementTrigger,
  context?: { currentStreak?: number }
): Promise<UnlockedAchievement[]> {
  const relevantTypes = TRIGGER_TO_CRITERIA_TYPES[trigger];
  if (!relevantTypes || relevantTypes.length === 0) return [];

  const now = new Date();

  // 1. Fetch candidate PERMANENT achievements NOT YET unlocked by this user
  const permanentCandidates = await tx.achievement.findMany({
    where: {
      is_seasonal: false,
      NOT: {
        user_achievements: {
          some: { user_id: userId }
        }
      }
    }
  });

  // 2. Fetch candidate SEASONAL achievements for active seasons
  const activeSeason = await tx.season.findFirst({
    where: {
      is_active: true,
      starts_at: { lte: now },
      ends_at: { gte: now }
    }
  });

  let seasonalCandidates: typeof permanentCandidates = [];
  if (activeSeason) {
    seasonalCandidates = await tx.achievement.findMany({
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
              season_id: activeSeason.id
            }
          }
        }
      }
    });
  }

  // Combine and filter to relevant criteria types
  const allCandidates = [...permanentCandidates, ...seasonalCandidates];
  const relevantAchievements = allCandidates.filter((achievement: { criteria: unknown }) => {
    const criteria = achievement.criteria as AchievementCriteria | null;
    return criteria && relevantTypes.includes(criteria.type);
  });

  if (relevantAchievements.length === 0) return [];

  // 3. Get user's current stats for threshold comparison
  const stats = await getUserStatsForTrigger(tx, userId, trigger, context);

  // 4. Check each achievement and unlock if threshold met
  const newlyUnlocked: UnlockedAchievement[] = [];
  let totalAchievementXp = 0;

  for (const achievement of relevantAchievements) {
    const criteria = achievement.criteria as unknown as AchievementCriteria;
    const currentValue = stats[criteria.type] ?? 0;

      if (currentValue >= criteria.threshold) {
        try {
          if (achievement.is_seasonal && activeSeason) {
              // SEASONAL: Use upsert for atomic check-and-create (prevents race condition)
              const result = await tx.$queryRaw<{ already_existed: boolean }[]>`
                INSERT INTO "seasonal_user_achievements" (id, user_id, achievement_id, season_id, unlocked_at)
                VALUES (gen_random_uuid(), ${userId}::uuid, ${achievement.id}::uuid, ${activeSeason.id}::uuid, NOW())
                ON CONFLICT (user_id, achievement_id, season_id) DO NOTHING
                RETURNING FALSE as already_existed
              `;
              
              // If no rows returned, the record already existed (conflict triggered DO NOTHING)
              if (!result || result.length === 0) continue;

            await logActivity(tx, userId, 'seasonal_achievement_unlocked', {
              achievementId: achievement.id,
              metadata: {
                code: achievement.code,
                xp_reward: achievement.xp_reward,
                season_id: activeSeason.id,
                season_code: activeSeason.code,
              }
            });
            } else {
              // PERMANENT: Use upsert for atomic check-and-create (prevents race condition)
              const result = await tx.$queryRaw<{ already_existed: boolean }[]>`
                INSERT INTO "user_achievements" (id, user_id, achievement_id, unlocked_at)
                VALUES (gen_random_uuid(), ${userId}::uuid, ${achievement.id}::uuid, NOW())
                ON CONFLICT (user_id, achievement_id) DO NOTHING
                RETURNING FALSE as already_existed
              `;
              
              // If no rows returned, the record already existed (conflict triggered DO NOTHING)
              if (!result || result.length === 0) continue;

            await logActivity(tx, userId, 'achievement_unlocked', {
              achievementId: achievement.id,
              metadata: {
                code: achievement.code,
                xp_reward: achievement.xp_reward,
              }
            });
          }

          totalAchievementXp += achievement.xp_reward;

          newlyUnlocked.push({
            id: achievement.id,
            code: achievement.code,
            name: achievement.name,
            xp_reward: achievement.xp_reward,
            rarity: achievement.rarity,
            is_seasonal: achievement.is_seasonal,
            season_id: achievement.is_seasonal ? activeSeason?.id : null,
          });

        } catch (err: any) {
          if (err.code !== 'P2002') throw err;
        }
      }
  }

  // 5. Award achievement XP to user
  if (totalAchievementXp > 0) {
    const userProfile = await tx.user.findUnique({
      where: { id: userId },
      select: { xp: true, season_xp: true, current_season: true }
    });

    const currentXp = userProfile?.xp ?? 0;
    const newXp = addXp(currentXp, totalAchievementXp);
    const newLevel = calculateLevel(newXp);
    
    const seasonUpdate = calculateSeasonXpUpdate(
      userProfile?.season_xp ?? null,
      userProfile?.current_season ?? null,
      totalAchievementXp
    );

    await tx.user.update({
      where: { id: userId },
      data: {
        xp: newXp,
        level: newLevel,
        season_xp: seasonUpdate.season_xp,
        current_season: seasonUpdate.current_season,
      }
    });
  }

  return newlyUnlocked;
}

/**
 * Fetches user stats relevant to the trigger type
 */
async function getUserStatsForTrigger(
  tx: TransactionClient,
  userId: string,
  trigger: AchievementTrigger,
  context?: { currentStreak?: number }
): Promise<Record<string, number>> {
  const stats: Record<string, number> = {};

  switch (trigger) {
    case 'chapter_read': {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { chapters_read: true }
      });
      stats['chapter_count'] = user?.chapters_read ?? 0;
      break;
    }

    case 'series_completed': {
      const completedCount = await tx.libraryEntry.count({
        where: { 
          user_id: userId, 
          status: 'completed', 
          deleted_at: null 
        }
      });
      stats['completed_count'] = completedCount;
      break;
    }

    case 'series_added': {
      const libraryCount = await tx.libraryEntry.count({
        where: { 
          user_id: userId, 
          deleted_at: null 
        }
      });
      stats['library_count'] = libraryCount;
      break;
    }

    case 'follow': {
      const followCount = await tx.follow.count({
        where: { follower_id: userId }
      });
      stats['follow_count'] = followCount;
      break;
    }

    case 'streak_reached': {
      // Use context if provided (more accurate), else fetch from DB
      if (context?.currentStreak !== undefined) {
        stats['streak_count'] = context.currentStreak;
      } else {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: { streak_days: true }
        });
        stats['streak_count'] = user?.streak_days ?? 0;
      }
      break;
    }
  }

  return stats;
}
