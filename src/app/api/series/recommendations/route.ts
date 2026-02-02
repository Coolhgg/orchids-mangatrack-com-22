import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, handleApiError, getClientIp, ApiError, ErrorCodes } from "@/lib/api-utils"
import { getBestCoversBatch, isValidCoverUrl } from "@/lib/cover-resolver"
import { getPersonalRecommendations, getColdStartRecommendations, getHybridRecommendations, RecommendationResult } from "@/lib/recommendations"
import { supabaseAdmin } from "@/lib/supabase/admin"

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`recommendations:${ip}`, 30, 60000)) {
      throw new ApiError('Too many requests. Please wait a minute.', 429, ErrorCodes.RATE_LIMITED)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    let recommendations: RecommendationResult[] = []
    let isColdStart = false
    let isHybrid = false

    if (!user) {
      // 1. Logged-out users: Always cold-start
      recommendations = await getColdStartRecommendations('sfw')
      isColdStart = true
    } else {
      // 2. Logged-in users: Hybrid Ranking
      const { data: userProfile } = await supabaseAdmin
        .from('users')
        .select('safe_browsing_mode, language')
        .eq('id', user.id)
        .single()

      const { count: libraryCount } = await supabaseAdmin
        .from('library_entries')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .is('deleted_at', null)

      const { count: signalCount } = await supabaseAdmin
        .from('user_signals')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)

      const totalInteractions = (libraryCount || 0) + (signalCount || 0)

      // Use Hybrid Ranking Engine
      recommendations = await getHybridRecommendations(user.id, totalInteractions)
      isHybrid = true

      // Fallback if hybrid fails (shouldn't)
      if (recommendations.length === 0) {
        recommendations = await getColdStartRecommendations(
          (userProfile?.safe_browsing_mode as 'sfw' | 'nsfw') || 'sfw',
          userProfile?.language
        )
        isColdStart = true
        isHybrid = false
      }
    }

    if (recommendations.length === 0) {
      return NextResponse.json({ results: [], is_fallback: false })
    }

    // Resolve covers
    const ids = recommendations.map(r => r.id)
    const bestCovers = await getBestCoversBatch(ids)

    const results = recommendations.map(r => {
      const bestCover = bestCovers.get(r.id)
      const fallbackCover = isValidCoverUrl(r.cover_url) ? r.cover_url : null
      return {
        ...r,
        cover_url: bestCover?.cover_url || fallbackCover
      }
    })

    return NextResponse.json({ 
      results,
      is_cold_start: isColdStart 
    })

  } catch (error: any) {
    console.error('Recommendations API error:', error)
    return handleApiError(error)
  }
}
