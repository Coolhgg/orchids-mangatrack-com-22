import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, handleApiError, ApiError, ErrorCodes, getClientIp } from "@/lib/api-utils"
import { 
  calculateLevel, 
  xpForLevel, 
  calculateLevelProgress 
} from "@/lib/gamification/xp"
import { 
  getCurrentSeasonInfo,
  getSeasonDaysRemaining,
  getSeasonProgress,
  getSeasonDateRange,
  needsSeasonRollover,
  getCurrentSeason
} from "@/lib/gamification/seasons"

/**
 * XP Progress API
 * 
 * Returns all XP-related data needed for the dashboard:
 * - Current level and XP
 * - Progress to next level
 * - Seasonal XP and context
 * - Lifetime vs seasonal breakdown
 * - Leaderboard rank (seasonal)
 * 
 * All calculations happen server-side - frontend is READ-ONLY
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    if (!await checkRateLimit(`xp-progress:${ip}`, 60, 60000)) {
      throw new ApiError('Too many requests', 429, ErrorCodes.RATE_LIMITED)
    }

    const supabase = await createClient()
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser()

    if (authError || !authUser) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    // Fetch user data with retries
    const user = await withRetry(
      () => prisma.user.findUnique({
        where: { id: authUser.id },
        select: {
          id: true,
          xp: true,
          level: true,
          season_xp: true,
          current_season: true,
          streak_days: true,
          longest_streak: true,
          chapters_read: true,
          active_days: true,
        }
      }),
      3,
      200
    )

    if (!user) {
      throw new ApiError("User not found", 404, ErrorCodes.NOT_FOUND)
    }

    // Calculate level progress (server-side only)
    const currentXp = user.xp || 0
    const currentLevel = calculateLevel(currentXp)
    const currentLevelXp = xpForLevel(currentLevel)
    const nextLevelXp = xpForLevel(currentLevel + 1)
    const xpInCurrentLevel = currentXp - currentLevelXp
    const xpNeededForNextLevel = nextLevelXp - currentLevelXp
    const levelProgress = calculateLevelProgress(currentXp)

    // Get season context
    const seasonInfo = getCurrentSeasonInfo()
    const currentSeason = getCurrentSeason()
    const dateRange = getSeasonDateRange(currentSeason)
    const daysRemaining = getSeasonDaysRemaining()
    const seasonProgress = getSeasonProgress()

    // Handle season rollover check
    const seasonXp = needsSeasonRollover(user.current_season) ? 0 : (user.season_xp || 0)

    // Get seasonal rank
    const seasonalRank = await withRetry(
      () => prisma.user.count({
        where: {
          season_xp: { gt: seasonXp },
          current_season: currentSeason
        }
      }),
      2,
      200
    )

    // Get total users in season for context
    const totalSeasonalUsers = await withRetry(
      () => prisma.user.count({
        where: {
          season_xp: { gt: 0 },
          current_season: currentSeason
        }
      }),
      2,
      200
    )

    // Calculate percentile (top X%)
    const percentile = totalSeasonalUsers > 0 
      ? Math.max(1, Math.round(((seasonalRank + 1) / totalSeasonalUsers) * 100))
      : 100

    return NextResponse.json({
      // Level info
      level: {
        current: currentLevel,
        xp_in_level: xpInCurrentLevel,
        xp_for_next: xpNeededForNextLevel,
        progress: Math.round(levelProgress * 100), // 0-100%
        next_level_total_xp: nextLevelXp,
      },

      // XP totals
      xp: {
        lifetime: currentXp,
        seasonal: seasonXp,
      },

      // Season context
      season: {
        code: seasonInfo.code,
        key: seasonInfo.key,
        name: seasonInfo.name,
        year: seasonInfo.year,
        display_name: seasonInfo.displayName,
        days_remaining: daysRemaining,
        progress: Math.round(seasonProgress * 100), // 0-100%
        starts_at: dateRange?.start.toISOString(),
        ends_at: dateRange?.end.toISOString(),
      },

      // Leaderboard context (seasonal rank only)
      rank: {
        seasonal: seasonalRank + 1, // 1-indexed
        total_participants: totalSeasonalUsers,
        percentile: percentile, // Top X%
      },

      // Activity stats
      stats: {
        streak_days: user.streak_days || 0,
        longest_streak: user.longest_streak || 0,
        chapters_read: user.chapters_read || 0,
        active_days: user.active_days || 0,
      }
    })
  } catch (error: unknown) {
    if (isTransientError(error)) {
      return NextResponse.json(
        { error: 'Database temporarily unavailable', code: ErrorCodes.INTERNAL_ERROR },
        { status: 503 }
      )
    }
    return handleApiError(error)
  }
}
