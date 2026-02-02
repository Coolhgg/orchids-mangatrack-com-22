import { NextRequest, NextResponse } from "next/server"
import { prisma, prismaRead, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"
import { 
  getCurrentSeason, 
  isValidSeason, 
  getSeasonDisplayName, 
  getRecentSeasons,
  convertLegacySeasonCode,
  getSeasonDaysRemaining,
  getCurrentSeasonInfo
} from "@/lib/gamification/seasons"
import { calculateEffectiveXp, calculateEffectiveSeasonXp, TRUST_SCORE_DEFAULT, TRUST_SCORE_MIN_FOR_LEADERBOARD } from "@/lib/gamification/trust-score"

const VALID_CATEGORIES = ['xp', 'streak', 'chapters', 'efficiency', 'season'] as const
const VALID_PERIODS = ['week', 'month', 'all-time', 'current-season'] as const

// Type for user data from leaderboard queries
interface LeaderboardUser {
  id: string;
  username: string;
  avatar_url: string | null;
  xp: number;
  level: number;
  streak_days: number;
  chapters_read: number;
  active_days: number;
  season_xp: number;
  current_season: string | null;
  trust_score: number | null;
}

/**
 * LEADERBOARD API
 * 
 * ANIME-STYLE SEASONAL LEADERBOARDS:
 * - Seasons are quarterly: Winter (Q1), Spring (Q2), Summer (Q3), Fall (Q4)
 * - Season format: "YYYY-Q[1-4]" (e.g., "2026-Q1" for Winter 2026)
 * - Season XP resets at season boundaries
 * - Lifetime XP is permanent
 * 
 * TRUST SCORE INTEGRATION:
 * - For XP-based categories (xp, season, efficiency), ranking uses effective_xp
 * - effective_xp = xp * trust_score
 * - This silently reduces influence of suspicious accounts
 * - Raw XP is preserved and shown to user, only ranking is affected
 */
export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request)
    if (!await checkRateLimit(`leaderboard:${ip}`, 30, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED)
    }

    const { searchParams } = new URL(request.url)
    const period = searchParams.get("period") || "all-time"
    const category = searchParams.get("category") || "xp"
    const limit = Math.min(Math.max(1, parseInt(searchParams.get("limit") || "50")), 100)
    let season = searchParams.get("season") // Optional: specific season like "2026-Q1"

    if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      throw new ApiError(`Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}`, 400, ErrorCodes.VALIDATION_ERROR)
    }

    if (!VALID_PERIODS.includes(period as typeof VALID_PERIODS[number])) {
      throw new ApiError(`Invalid period. Must be one of: ${VALID_PERIODS.join(', ')}`, 400, ErrorCodes.VALIDATION_ERROR)
    }

    // Convert legacy season format if needed (YYYY-MM -> YYYY-Q[1-4])
    if (season) {
      season = convertLegacySeasonCode(season)
    }

    // Validate season format if provided
    if (season && !isValidSeason(season)) {
      throw new ApiError('Invalid season format. Must be YYYY-Q[1-4] (e.g., 2026-Q1 for Winter)', 400, ErrorCodes.VALIDATION_ERROR)
    }

    const selectFields = {
      id: true,
      username: true,
      avatar_url: true,
      xp: true,
      level: true,
      streak_days: true,
      chapters_read: true,
      active_days: true,
      season_xp: true,
      current_season: true,
      trust_score: true,
    } as const

    // Determine the target season for seasonal queries
    const targetSeason = season || getCurrentSeason()
    const seasonInfo = getCurrentSeasonInfo()

    // Handle SEASONAL XP leaderboard (category=season or period=current-season)
      if (category === "season" || period === "current-season") {
        const users = await withRetry(
          () => prismaRead.user.findMany({
            select: selectFields,
            where: { 
              season_xp: { gt: 0 },
              trust_score: { gte: TRUST_SCORE_MIN_FOR_LEADERBOARD },
              OR: [
                { current_season: targetSeason },
                ...(targetSeason.match(/^\d{4}-Q([1-4])$/) ? [{
                  current_season: {
                    startsWith: targetSeason.split('-Q')[0] + '-'
                  }
                }] : [])
              ]
            },
            take: limit * 2,
          }),
          3,
          200
        ) as LeaderboardUser[]

      // Filter and convert legacy seasons, calculate effective XP
      const usersWithEffective = users
        .filter(user => {
          if (!user.current_season) return false
          const normalizedSeason = convertLegacySeasonCode(user.current_season)
          return normalizedSeason === targetSeason
        })
        .map(user => ({
          ...user,
          effective_season_xp: calculateEffectiveSeasonXp(
            user.season_xp || 0, 
            user.trust_score ?? TRUST_SCORE_DEFAULT
          ),
          normalized_xp: user.active_days && user.active_days > 0 
            ? Math.round((user.xp / user.active_days) * 100) / 100 
            : user.xp
        }))

      // Sort by effective_season_xp (trust-weighted)
      usersWithEffective.sort((a, b) => b.effective_season_xp - a.effective_season_xp)

      // Take top N and add rank
      const rankedUsers = usersWithEffective.slice(0, limit).map((user, index) => {
        // Remove trust_score from response (silent enforcement)
        const { trust_score, effective_season_xp, ...rest } = user
        return {
          rank: index + 1,
          ...rest,
        }
      })

      return NextResponse.json({ 
        users: rankedUsers,
        category: "season",
        period: period === "current-season" ? "current-season" : "all-time",
        // Season context for UI
        season: targetSeason,
        season_display: getSeasonDisplayName(targetSeason),
        season_key: seasonInfo.key,
        season_name: seasonInfo.name,
        season_year: seasonInfo.year,
        days_remaining: getSeasonDaysRemaining(),
        // Available seasons for dropdown
        available_seasons: getRecentSeasons(8),
        current_season: getCurrentSeason(),
        total: rankedUsers.length,
      })
    }

    if (category === "efficiency") {
        const users = await withRetry(
          () => prismaRead.user.findMany({
            select: selectFields,
            where: { 
              xp: { gt: 0 }, 
              active_days: { gt: 0 },
              trust_score: { gte: TRUST_SCORE_MIN_FOR_LEADERBOARD }
            },
            take: limit * 2,
          }),
          3,
          200
        ) as LeaderboardUser[]

      // TRUST SCORE: Use effective XP for efficiency calculation
      const usersWithNormalized = users.map(user => {
        const effectiveXp = calculateEffectiveXp(
          user.xp || 0, 
          user.trust_score ?? TRUST_SCORE_DEFAULT
        )
        return {
          ...user,
          effective_xp: effectiveXp,
          normalized_xp: Math.round((effectiveXp / Math.max(user.active_days || 1, 1)) * 100) / 100
        }
      })

      usersWithNormalized.sort((a, b) => b.normalized_xp - a.normalized_xp)

      const rankedUsers = usersWithNormalized.slice(0, limit).map((user, index) => {
        // Remove trust_score and effective_xp from response (silent enforcement)
        const { trust_score, effective_xp, ...rest } = user
        return {
          rank: index + 1,
          ...rest,
          // Show original XP to user, not effective XP
          xp: user.xp,
        }
      })

      return NextResponse.json({ 
        users: rankedUsers,
        category,
        period,
        total: rankedUsers.length,
      })
    }

    // Non-XP categories (streak, chapters) - also filter by trust score
      if (category === "streak" || category === "chapters") {
        const orderBy = category === "streak" 
          ? { streak_days: "desc" as const } 
          : { chapters_read: "desc" as const }
        
        const where = category === "streak"
          ? { streak_days: { gt: 0 }, trust_score: { gte: TRUST_SCORE_MIN_FOR_LEADERBOARD } }
          : { chapters_read: { gt: 0 }, trust_score: { gte: TRUST_SCORE_MIN_FOR_LEADERBOARD } }
        
        const users = await withRetry(
          () => prismaRead.user.findMany({
            select: selectFields,
            orderBy,
            take: limit,
            where,
          }),
          3,
          200
        ) as LeaderboardUser[]

      const rankedUsers = users.map((user, index) => {
        const { trust_score, ...rest } = user
        return {
          rank: index + 1,
          ...rest,
          normalized_xp: user.active_days && user.active_days > 0 
            ? Math.round((user.xp / user.active_days) * 100) / 100 
            : user.xp
        }
      })

      return NextResponse.json({ 
        users: rankedUsers,
        category,
        period,
        total: rankedUsers.length,
      })
    }

    // XP leaderboard (default) - apply trust weighting
      const users = await withRetry(
        () => prisma.user.findMany({
          select: selectFields,
          where: { 
            xp: { gt: 0 },
            trust_score: { gte: TRUST_SCORE_MIN_FOR_LEADERBOARD }
          },
          take: limit * 2,
        }),
        3,
        200
      ) as LeaderboardUser[]

    // TRUST SCORE: Calculate effective XP and sort by it
    const usersWithEffective = users.map(user => ({
      ...user,
      effective_xp: calculateEffectiveXp(
        user.xp || 0, 
        user.trust_score ?? TRUST_SCORE_DEFAULT
      ),
      normalized_xp: user.active_days && user.active_days > 0 
        ? Math.round((user.xp / user.active_days) * 100) / 100 
        : user.xp
    }))

    // Sort by effective_xp (trust-weighted)
    usersWithEffective.sort((a, b) => b.effective_xp - a.effective_xp)

    // Take top N and add rank
    const rankedUsers = usersWithEffective.slice(0, limit).map((user, index) => {
      // Remove trust_score and effective_xp from response (silent enforcement)
      const { trust_score, effective_xp, ...rest } = user
      return {
        rank: index + 1,
        ...rest,
      }
    })

    return NextResponse.json({ 
      users: rankedUsers,
      category,
      period,
      total: rankedUsers.length,
    })
  } catch (error: unknown) {
    if (isTransientError(error)) {
      return NextResponse.json(
        { 
          error: 'Database temporarily unavailable',
          code: ErrorCodes.INTERNAL_ERROR,
          users: [],
          category: 'xp',
          period: 'all-time',
          total: 0
        },
        { status: 503 }
      )
    }
    
    return handleApiError(error)
  }
}
