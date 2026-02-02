import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma, withRetry } from "@/lib/prisma"
import { checkRateLimit, handleApiError, ApiError, ErrorCodes, getClientIp, getRateLimitInfo } from "@/lib/api-utils"
import { getAchievementProgressForUser, getNextUpAchievements } from "@/lib/gamification/achievement-progress"

/**
 * GET /api/users/me/achievements
 * 
 * Returns achievement progress for the authenticated user.
 * 
 * Query params:
 * - view: "all" | "in_progress" | "unlocked" | "next_up" (default: "all")
 * - limit: number (default: 20, max: 50)
 */
export async function GET(request: Request) {
  try {
    const ip = getClientIp(request)
    const rateLimitKey = `achievements:${ip}`
    
    const rateLimitInfo = await getRateLimitInfo(rateLimitKey, 60, 60000)
    if (!rateLimitInfo.allowed) {
      const error = new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
      ;(error as any).retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000)
      throw error
    }

    const supabase = await createClient()
    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError) {
      console.error('[Achievements API] Auth error:', authError.message)
      throw new ApiError("Authentication failed", 401, ErrorCodes.UNAUTHORIZED)
    }

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const { searchParams } = new URL(request.url)
    const view = searchParams.get("view") || "all"
    
    // Validate view parameter
    const validViews = ["all", "in_progress", "unlocked", "next_up"]
    if (!validViews.includes(view)) {
      throw new ApiError(
        `Invalid view parameter. Must be one of: ${validViews.join(", ")}`,
        400,
        ErrorCodes.BAD_REQUEST
      )
    }
    
    // Parse and validate limit parameter
    const limitParam = searchParams.get("limit")
    let limit = 20
    if (limitParam !== null) {
      const parsedLimit = parseInt(limitParam, 10)
      if (isNaN(parsedLimit) || parsedLimit < 1) {
        throw new ApiError("Invalid limit parameter. Must be a positive integer.", 400, ErrorCodes.BAD_REQUEST)
      }
      limit = Math.min(50, parsedLimit)
    }

    let progressData

    switch (view) {
      case "next_up":
        // Get achievements closest to being unlocked
        progressData = await withRetry(
          () => getNextUpAchievements(prisma, user.id, limit),
          2,
          200
        )
        break

      case "in_progress":
        // Get only locked achievements with progress
        progressData = await withRetry(
          () => getAchievementProgressForUser(prisma, user.id, {
            includeUnlocked: false,
            includeHidden: false,
          }),
          2,
          200
        )
        progressData = progressData.filter(p => p.progressPercent > 0).slice(0, limit)
        break

      case "unlocked":
        // Get only unlocked achievements
        progressData = await withRetry(
          () => getAchievementProgressForUser(prisma, user.id, {
            includeUnlocked: true,
            includeHidden: false,
          }),
          2,
          200
        )
        progressData = progressData.filter(p => p.isUnlocked).slice(0, limit)
        break

      case "all":
      default:
        // Get all achievements (locked + unlocked, excluding hidden locked)
        progressData = await withRetry(
          () => getAchievementProgressForUser(prisma, user.id, {
            includeUnlocked: true,
            includeHidden: false,
          }),
          2,
          200
        )
        progressData = progressData.slice(0, limit)
        break
    }

    // Also get user stats for context
    const userStats = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        chapters_read: true,
        streak_days: true,
        longest_streak: true,
        xp: true,
        level: true,
      }
    })

    // Count unlocked vs total visible
    const unlockedCount = progressData.filter(p => p.isUnlocked).length
    const totalVisible = progressData.length

    return NextResponse.json({
      achievements: progressData,
      stats: {
        unlockedCount,
        totalVisible,
        chaptersRead: userStats?.chapters_read ?? 0,
        currentStreak: userStats?.streak_days ?? 0,
        longestStreak: userStats?.longest_streak ?? 0,
      },
      view,
      pagination: {
        limit,
        returned: progressData.length,
      }
    }, {
      headers: {
        'X-RateLimit-Limit': rateLimitInfo.limit.toString(),
        'X-RateLimit-Remaining': rateLimitInfo.remaining.toString(),
        'X-RateLimit-Reset': rateLimitInfo.reset.toString(),
      }
    })
  } catch (error) {
    return handleApiError(error)
  }
}
