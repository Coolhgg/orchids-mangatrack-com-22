import { NextRequest, NextResponse } from "next/server"
import { prisma, withRetry, isTransientError } from "@/lib/prisma"
import { checkRateLimit, sanitizeInput, USERNAME_REGEX, handleApiError, ApiError, ErrorCodes, getClientIp, withErrorHandling } from "@/lib/api-utils"

// Reserved usernames that can't be registered
const RESERVED_USERNAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'support', 
  'help', 'info', 'contact', 'api', 'www', 'mail', 'email',
  'mangatrack', 'manga', 'manhwa', 'webtoon', 'moderator', 'mod',
  'settings', 'profile', 'library', 'discover', 'feed',
  'notifications', 'users', 'series', 'leaderboard', 'friends'
])

/**
 * GET /api/auth/check-username
 * Checks if a username is available
 */
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    // Rate limit: 30 requests per minute per IP
    const ip = getClientIp(request);
    
    if (!await checkRateLimit(`check-username:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED)
    }

    const { searchParams } = new URL(request.url)
    const rawUsername = searchParams.get("username")

    if (!rawUsername) {
      throw new ApiError("Username is required", 400, ErrorCodes.BAD_REQUEST)
    }

    // Sanitize and normalize username
    const username = sanitizeInput(rawUsername.toLowerCase(), 30)

    // Validate username format
    if (username.length < 3) {
      throw new ApiError("Username must be at least 3 characters", 400, ErrorCodes.VALIDATION_ERROR)
    }
    
    if (username.length > 20) {
      throw new ApiError("Username must be 20 characters or less", 400, ErrorCodes.VALIDATION_ERROR)
    }

    if (!USERNAME_REGEX.test(username)) {
      throw new ApiError("Username can only contain letters, numbers, underscores, and hyphens", 400, ErrorCodes.VALIDATION_ERROR)
    }

    // Check reserved usernames
    if (RESERVED_USERNAMES.has(username)) {
      throw new ApiError("This username is reserved", 409, ErrorCodes.CONFLICT)
    }

    // Check if username exists in database with retry logic
    try {
      const existingUser = await withRetry(
        () => prisma.user.findFirst({
          where: { 
            username: { 
              equals: username, 
              mode: 'insensitive' 
            } 
          },
          select: { id: true }
        }),
        3,  // 3 retries
        150 // 150ms base delay
      )

      if (existingUser) {
        throw new ApiError("Username is already taken", 409, ErrorCodes.CONFLICT)
      }

      return { available: true }
      
    } catch (dbError: any) {
        // Re-throw ApiErrors directly (e.g., "Username is already taken")
        if (dbError instanceof ApiError) {
          throw dbError
        }
        
        // Log the error for debugging
        console.error("Username check database error:", dbError.message || dbError)
        
        // If it's a transient error, return a special response
        // that tells the frontend to allow registration to proceed
        // The actual uniqueness check will happen during user creation
        if (isTransientError(dbError)) {
          return { 
            available: true,
            warning: "Could not verify username availability. Please try again or proceed with registration."
          }
        }
        
        // For non-transient errors, throw as ApiError
        throw new ApiError("Failed to check username availability. Please try again.", 503, ErrorCodes.INTERNAL_ERROR)
      }
  })
}
