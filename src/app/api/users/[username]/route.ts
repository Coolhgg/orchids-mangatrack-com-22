import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma, prismaRead, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, validateUsername, handleApiError, ApiError, ErrorCodes, getClientIp } from "@/lib/api-utils"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ username: string }> }
) {
  try {
    const { username } = await params
    
    // Rate limit: 60 requests per minute per IP for profile views
    const ip = getClientIp(request);
    if (!await checkRateLimit(`profile:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    // Validate username format to prevent injection/path traversal
    if (!validateUsername(username)) {
      throw new ApiError("Invalid username format", 400, ErrorCodes.VALIDATION_ERROR);
    }

    const supabase = await createClient()
    const { data: { user: currentUser } } = await supabase.auth.getUser()

    // Try to get user from database with retry logic and case-insensitivity
    let targetUser = null
    try {
      targetUser = await withRetry(
        () => prismaRead.user.findFirst({
          where: { 
            username: { 
              equals: username, 
              mode: 'insensitive' 
            } 
          },
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
            xp: true,
            level: true,
            streak_days: true,
            created_at: true,
            privacy_settings: true,
          },
        }),
        2,
        200
      )
    } catch (dbError: any) {
      console.warn(`[Profile API] Database error for username ${username}:`, dbError.message?.slice(0, 100))
      
      // If the database is unreachable, try to find the user via Supabase Auth metadata (if they are the current user)
      if (isTransientError(dbError) && currentUser && currentUser.user_metadata?.username?.toLowerCase() === username.toLowerCase()) {
        console.log(`[Profile API] Returning partial data from Supabase for current user ${username}`)
        return NextResponse.json({
          user: {
            id: currentUser.id,
            username: currentUser.user_metadata?.username || username,
            avatar_url: currentUser.user_metadata?.avatar_url || null,
            bio: null,
            xp: 0,
            level: 1,
            streak_days: 0,
              created_at: currentUser.created_at,
              privacy_settings: { library_public: false, activity_public: false, profile_public: false },
            },
          stats: {
            libraryCount: 0,
            followersCount: 0,
            followingCount: 0,
          },
          library: [],
          achievements: [],
          isFollowing: false,
          isOwnProfile: true,
          _warning: "Database temporarily unavailable. Showing limited profile information."
        })
      }
      throw dbError
    }

    if (!targetUser) {
      throw new ApiError("User not found", 404, ErrorCodes.NOT_FOUND);
    }

    const isOwnProfile = currentUser?.id === targetUser.id
    const privacySettings = targetUser.privacy_settings as any || {}
    const isProfilePublic = privacySettings.profile_public !== false

    // BUG 79: Enforce permission checks on read endpoints
    // If profile is private and it's not the owner, mask sensitive fields
    if (!isProfilePublic && !isOwnProfile) {
      targetUser = {
        ...targetUser,
        bio: null,
        avatar_url: null,
        xp: 0,
        level: 1,
        streak_days: 0,
        created_at: targetUser.created_at, // Keep created_at but could be masked if needed
      } as any
    }

    // Fetch related data with retry and error handling
    let stats = { libraryCount: 0, followersCount: 0, followingCount: 0 }
    let isFollowing = false
    let library: any[] = []
    let achievements: any[] = []

    try {
      // If profile is private, hide stats from public
      if (!isProfilePublic && !isOwnProfile) {
        stats = { libraryCount: 0, followersCount: 0, followingCount: 0 }
      } else {
        const [libraryCount, followersCount, followingCount, followingRecord] = await withRetry(
          () => Promise.all([
            prismaRead.libraryEntry.count({ where: { user_id: targetUser.id } }),
            prismaRead.follow.count({ where: { following_id: targetUser.id } }),
            prismaRead.follow.count({ where: { follower_id: targetUser.id } }),
            currentUser
              ? prisma.follow.findUnique({
                  where: {
                    follower_id_following_id: {
                      follower_id: currentUser.id,
                      following_id: targetUser.id,
                    },
                  },
                })
              : Promise.resolve(null),
          ]),
          2,
          150
        )

        stats = { libraryCount, followersCount, followingCount }
        isFollowing = !!followingRecord
      }

        const isLibraryPublic = privacySettings.library_public !== false

        if ((isLibraryPublic && isProfilePublic) || isOwnProfile) {
        library = await withRetry(
          () => prismaRead.libraryEntry.findMany({
              where: { user_id: targetUser.id, status: "reading" },
              take: 6,
              orderBy: { updated_at: "desc" },
              include: {
                series: {
                  select: {
                    id: true,
                    title: true,
                    cover_url: true,
                  },
                },
              },
            }),
            2,
            150
          )
        }

        if (isProfilePublic || isOwnProfile) {
          /**
           * HIDDEN ACHIEVEMENTS LOGIC:
           * - Hidden achievements (is_hidden=true) are NOT shown until unlocked
           * - Once unlocked, they appear in user_achievements and are shown normally
           * - XP is granted normally regardless of hidden status
           * 
           * Since we're querying UserAchievement (already unlocked), we include
           * the is_hidden field so UI can optionally show a "secret" badge effect
           */
          achievements = await withRetry(
            () => prismaRead.userAchievement.findMany({
              where: { user_id: targetUser.id },
              take: 8,
              orderBy: { unlocked_at: "desc" },
              include: {
                achievement: {
                  select: {
                    id: true,
                    name: true,
                    description: true,
                    icon_url: true,
                    rarity: true,
                    is_hidden: true, // Include for UI "revealed" effect
                  },
                },
              },
            }),
            2,
            150
          )
        }
    } catch (relationError: any) {
      console.warn(`[Profile API] Error fetching relations for ${username}:`, relationError.message?.slice(0, 100))
      // Continue with empty arrays if relations fail but user was found
    }

    return NextResponse.json({
      user: targetUser,
      stats,
      library,
      achievements,
      isFollowing,
      isOwnProfile,
    })
  } catch (error: any) {
    return handleApiError(error)
  }
}
