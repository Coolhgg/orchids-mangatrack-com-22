import { NextRequest, NextResponse } from "next/server"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { getRateLimitInfo, sanitizeInput, handleApiError, getClientIp, ErrorCodes } from "@/lib/api-utils"

/**
 * SECURITY: Escape ILIKE special characters to prevent pattern injection
 */
function escapeILikePattern(input: string): string {
  return input
    .replace(/\\/g, '\\\\')  // Escape backslashes first
    .replace(/%/g, '\\%')    // Escape percent signs
    .replace(/_/g, '\\_')    // Escape underscores
}

    export async function GET(request: NextRequest) {
      try {
        // Rate limit: 30 requests per minute per IP
        const ip = getClientIp(request)
        const rateLimitInfo = await getRateLimitInfo(`user-search:${ip}`, 30, 60000)
        
        if (!rateLimitInfo.allowed) {
          const retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000)
          return NextResponse.json(
            { error: "Too many requests. Please wait a moment.", code: ErrorCodes.RATE_LIMITED },
            { 
              status: 429,
              headers: { 'Retry-After': retryAfter.toString() }
            }
          )
    }

    const { searchParams } = new URL(request.url)
    const rawQuery = searchParams.get("q")
    const limit = Math.min(parseInt(searchParams.get("limit") || "10"), 50)

    if (!rawQuery || rawQuery.length < 2) {
      return NextResponse.json({ users: [] })
    }

    // Sanitize and escape search query
    const sanitized = sanitizeInput(rawQuery, 100)
    const escapedQuery = escapeILikePattern(sanitized)

    if (escapedQuery.length < 2) {
      return NextResponse.json({ users: [] })
    }

    // Search users using Supabase client
    const { data: users, error } = await supabaseAdmin
      .from('users')
      .select('id, username, avatar_url, xp, level, privacy_settings')
      .ilike('username', `%${escapedQuery}%`)
      .order('xp', { ascending: false })
      .limit(limit)

    if (error) throw error

    // Post-filter for privacy settings
    const filteredUsers = (users || [])
      .filter((user: any) => {
        const privacy = user.privacy_settings as any
        return !privacy || privacy.profile_searchable !== false
      })
      .map((user: any) => ({
        id: user.id,
        username: user.username,
        avatar_url: user.avatar_url,
        xp: user.xp,
        level: user.level,
      }))

    return NextResponse.json({ users: filteredUsers })
  } catch (error) {
    return handleApiError(error)
  }
}
