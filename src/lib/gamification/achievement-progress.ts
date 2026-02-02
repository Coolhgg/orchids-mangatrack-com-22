/**
 * ACHIEVEMENT PROGRESS CALCULATION
 * 
 * RULES (LOCKED):
 * 1. Progress computed dynamically from canonical user stats
 * 2. No extra tables - uses existing User, LibraryEntry, Follow tables
 * 3. Based on canonical stats: chapters_read, streak_days, library count, etc.
 * 
 * CRITERIA TYPES:
 * - chapter_count: user.chapters_read
 * - completed_count: COUNT(library_entries WHERE status='completed')
 * - library_count: COUNT(library_entries)
 * - follow_count: COUNT(follows WHERE follower_id=user_id)
 * - streak_count: user.streak_days
 */

import { PrismaClient } from '@prisma/client';
import { TransactionClient } from '../prisma';

export interface AchievementCriteria {
  type: 'chapter_count' | 'completed_count' | 'library_count' | 'follow_count' | 'streak_count';
  threshold: number;
}

export interface AchievementProgress {
  achievementId: string;
  code: string;
  name: string;
  description: string | null;
  rarity: string;
  xpReward: number;
  isHidden: boolean;
  isSeasonal: boolean;
  
  // Progress data
  criteriaType: string;
  currentValue: number;
  threshold: number;
  progressPercent: number; // 0-100
  isUnlocked: boolean;
  unlockedAt: Date | null;
}

export interface UserAchievementStats {
  chapters_read: number;
  completed_count: number;
  library_count: number;
  follow_count: number;
  streak_days: number;
}

/**
 * Fetch canonical stats for a user from existing tables
 * No extra tables - computed from User, LibraryEntry, Follow
 */
export async function getUserAchievementStats(
  prisma: TransactionClient,
  userId: string
): Promise<UserAchievementStats> {
  try {
    const [user, completedCount, libraryCount, followCount] = await Promise.all([
      prisma.user.findUnique({
        where: { id: userId },
        select: {
          chapters_read: true,
          streak_days: true,
        }
      }),
      prisma.libraryEntry.count({
        where: { 
          user_id: userId, 
          status: 'completed',
          deleted_at: null,
        }
      }),
      prisma.libraryEntry.count({
        where: { 
          user_id: userId,
          deleted_at: null,
        }
      }),
      prisma.follow.count({
        where: { follower_id: userId }
      }),
    ]);

    return {
      chapters_read: user?.chapters_read ?? 0,
      completed_count: completedCount,
      library_count: libraryCount,
      follow_count: followCount,
      streak_days: user?.streak_days ?? 0,
    };
  } catch (error) {
    // Log error but return safe defaults to prevent crashes
    console.error('[Achievement Progress] Error fetching user stats:', error);
    return {
      chapters_read: 0,
      completed_count: 0,
      library_count: 0,
      follow_count: 0,
      streak_days: 0,
    };
  }
}

/**
 * Map criteria type to stat field name
 */
function getCriteriaStatKey(criteriaType: string): keyof UserAchievementStats | null {
  const mapping: Record<string, keyof UserAchievementStats> = {
    chapter_count: 'chapters_read',
    completed_count: 'completed_count',
    library_count: 'library_count',
    follow_count: 'follow_count',
    streak_count: 'streak_days',
  };
  return mapping[criteriaType] || null;
}

/**
 * Validates achievement criteria
 * Returns true if criteria is valid, false otherwise
 */
function isValidCriteria(criteria: unknown): criteria is AchievementCriteria {
  if (!criteria || typeof criteria !== 'object') return false;
  
  const c = criteria as Record<string, unknown>;
  
  // Must have type as string
  if (typeof c.type !== 'string') return false;
  
  // Must have threshold as positive number
  if (typeof c.threshold !== 'number' || c.threshold <= 0 || !Number.isFinite(c.threshold)) {
    return false;
  }
  
  // Type must be recognized
  const validTypes = ['chapter_count', 'completed_count', 'library_count', 'follow_count', 'streak_count'];
  if (!validTypes.includes(c.type)) return false;
  
  return true;
}

/**
 * Calculate progress for a single achievement
 */
export function calculateAchievementProgress(
  achievement: {
    id: string;
    code: string;
    name: string;
    description: string | null;
    rarity: string;
    xp_reward: number;
    is_hidden: boolean;
    is_seasonal: boolean;
    criteria: unknown;
  },
  stats: UserAchievementStats,
  isUnlocked: boolean,
  unlockedAt: Date | null
): AchievementProgress | null {
  // Validate criteria using type guard
  if (!isValidCriteria(achievement.criteria)) {
    return null;
  }

  const criteria = achievement.criteria;
  const statKey = getCriteriaStatKey(criteria.type);
  
  if (!statKey) {
    return null;
  }

  const currentValue = Math.max(0, stats[statKey]); // Ensure non-negative
  const threshold = criteria.threshold;
  
  // Calculate progress percentage (cap at 100, handle edge cases)
  // threshold is guaranteed > 0 by isValidCriteria
  const rawPercent = (currentValue / threshold) * 100;
  const progressPercent = Math.min(100, Math.max(0, Math.round(rawPercent)));

  return {
    achievementId: achievement.id,
    code: achievement.code,
    name: achievement.name,
    description: achievement.description,
    rarity: achievement.rarity,
    xpReward: achievement.xp_reward,
    isHidden: achievement.is_hidden,
    isSeasonal: achievement.is_seasonal,
    criteriaType: criteria.type,
    currentValue,
    threshold,
    progressPercent,
    isUnlocked,
    unlockedAt,
  };
}

/**
 * Get progress for all achievements for a user
 * 
 * VISIBILITY RULES:
 * - Unlocked achievements: Always shown with progress
 * - Locked visible achievements: Shown with progress
 * - Locked hidden achievements: NOT shown (surprise factor)
 */
export async function getAchievementProgressForUser(
  prisma: TransactionClient,
  userId: string,
  options?: {
    includeUnlocked?: boolean;  // Include already unlocked (default: true)
    includeHidden?: boolean;    // Include hidden locked (default: false)
    seasonalOnly?: boolean;     // Only seasonal achievements
  }
): Promise<AchievementProgress[]> {
  const {
    includeUnlocked = true,
    includeHidden = false,
    seasonalOnly = false,
  } = options || {};

  try {
    // 1. Fetch user stats
    const stats = await getUserAchievementStats(prisma, userId);

    // 2. Fetch all achievements
    const whereClause: Record<string, unknown> = {};
    if (seasonalOnly) {
      whereClause.is_seasonal = true;
    }

    const achievements = await prisma.achievement.findMany({
      where: whereClause,
      select: {
        id: true,
        code: true,
        name: true,
        description: true,
        rarity: true,
        xp_reward: true,
        is_hidden: true,
        is_seasonal: true,
        criteria: true,
      }
    });

    // 3. Fetch user's unlocked achievements
    const unlockedAchievements = await prisma.userAchievement.findMany({
      where: { user_id: userId },
      select: {
        achievement_id: true,
        unlocked_at: true,
      }
    });

    const unlockedMap = new Map<string, Date>(
      unlockedAchievements.map((ua: any) => [ua.achievement_id, ua.unlocked_at])
    );

    // 4. Calculate progress for each achievement
    const progressList: AchievementProgress[] = [];

    for (const achievement of achievements) {
      const isUnlocked = unlockedMap.has(achievement.id);
      const unlockedAt = (unlockedMap.get(achievement.id) as Date) || null;

      // Skip if not including unlocked and achievement is unlocked
      if (!includeUnlocked && isUnlocked) {
        continue;
      }

      // Skip hidden achievements that are not unlocked (unless includeHidden)
      if (achievement.is_hidden && !isUnlocked && !includeHidden) {
        continue;
      }

      const progress = calculateAchievementProgress(
        achievement,
        stats,
        isUnlocked,
        unlockedAt
      );

      if (progress) {
        progressList.push(progress);
      }
    }

    // Sort: In-progress (closest to completion) first, then unlocked
    return progressList.sort((a, b) => {
      // Unlocked achievements go to the end
      if (a.isUnlocked !== b.isUnlocked) {
        return a.isUnlocked ? 1 : -1;
      }
      
      // For locked achievements, sort by progress (highest first)
      if (!a.isUnlocked && !b.isUnlocked) {
        return b.progressPercent - a.progressPercent;
      }
      
      // For unlocked, sort by unlock date (most recent first)
      if (a.unlockedAt && b.unlockedAt) {
        return b.unlockedAt.getTime() - a.unlockedAt.getTime();
      }
      
      return 0;
    });
  } catch (error) {
    console.error('[Achievement Progress] Error fetching progress:', error);
    return [];
  }
}

/**
 * Get "next up" achievements - closest to being unlocked
 */
export async function getNextUpAchievements(
  prisma: TransactionClient,
  userId: string,
  limit: number = 3
): Promise<AchievementProgress[]> {
  // Validate and clamp limit
  const safeLimit = Math.min(50, Math.max(1, Math.floor(limit)));
  
  const allProgress = await getAchievementProgressForUser(prisma, userId, {
    includeUnlocked: false,
    includeHidden: false,
  });

  // Filter to only those with some progress (> 0%)
  // and not yet complete
  return allProgress
    .filter(p => p.progressPercent > 0 && p.progressPercent < 100)
    .slice(0, safeLimit);
}

/**
 * Format progress for display
 * Example: "73 / 100 chapters"
 */
export function formatProgress(progress: AchievementProgress): string {
  const typeLabels: Record<string, string> = {
    chapter_count: 'chapters',
    completed_count: 'completed',
    library_count: 'in library',
    follow_count: 'following',
    streak_count: 'day streak',
  };

  const label = typeLabels[progress.criteriaType] || 'progress';
  return `${progress.currentValue} / ${progress.threshold} ${label}`;
}
