import { supabaseAdmin } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { getRateLimitInfo, handleApiError, getClientIp, ErrorCodes } from "@/lib/api-utils"
import { getBestCoversBatch, isValidCoverUrl } from "@/lib/cover-resolver"
import { isBlockedContent } from "@/lib/constants/safe-browsing"

const VALID_MODES = ['velocity', 'classic'] as const
const VALID_TYPES = ['manga', 'manhwa', 'manhua', 'webtoon'] as const

type Mode = typeof VALID_MODES[number]
type SeriesType = typeof VALID_TYPES[number]

const MAX_OFFSET = 10000

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimitInfo = await getRateLimitInfo(`trending:${ip}`, 60, 60000)
  
  if (!rateLimitInfo.allowed) {
    const retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000)
    return NextResponse.json(
      { error: 'Too many requests. Please wait a moment.', code: ErrorCodes.RATE_LIMITED },
      { 
        status: 429,
        headers: { 'Retry-After': retryAfter.toString() }
      }
    )
  }

  const searchParams = request.nextUrl.searchParams
  const mode = (searchParams.get('mode') || 'velocity') as Mode
  const rawType = searchParams.get('type')
  
  const parsedLimit = parseInt(searchParams.get('limit') || '20', 10)
  const parsedOffset = parseInt(searchParams.get('offset') || '0', 10)
  const limit = Math.min(Math.max(1, isNaN(parsedLimit) ? 20 : parsedLimit), 50)
  const offset = Math.min(Math.max(0, isNaN(parsedOffset) ? 0 : parsedOffset), MAX_OFFSET)

  if (!VALID_MODES.includes(mode)) {
    return NextResponse.json(
      { error: 'Invalid mode. Must be one of: velocity, classic' },
      { status: 400 }
    )
  }

  let type: SeriesType | null = null
  if (rawType) {
    if (VALID_TYPES.includes(rawType as SeriesType)) {
      type = rawType as SeriesType
    } else {
      return NextResponse.json(
        { error: `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}` },
        { status: 400 }
      )
    }
  }

  try {
    const { data: trendingData, error, count } = await supabaseAdmin.rpc('get_velocity_trending_series', {
      p_type: type,
      p_limit: limit,
      p_offset: offset
    }, { count: 'exact' })

    if (error) throw error

    // CRITICAL: Filter out pornographic content (platform policy)
    const filteredData = (trendingData || []).filter((s: any) => !isBlockedContent(s.content_rating))

    const seriesIds = filteredData.map((s: any) => s.id)
    const bestCovers = await getBestCoversBatch(seriesIds)

    return NextResponse.json({
      results: filteredData.map((s: any) => {
        const bestCover = bestCovers.get(s.id)
        const fallbackCover = isValidCoverUrl(s.cover_url) ? s.cover_url : null
        return {
          id: s.id,
          title: s.title,
          cover_url: bestCover?.cover_url || fallbackCover,
          type: s.type,
          status: s.status,
          total_follows: s.total_follows,
          latest_chapter: s.latest_chapter,
          last_chapter_at: s.last_chapter_at,
          trending_score: s.trending_score,
          velocity: {
            chapters: s.v_chapters,
            follows: s.v_follows,
            activity: s.v_activity,
            chapters_24h: s.chapters_24h,
            chapters_72h: s.chapters_72h,
            follows_24h: s.follows_24h,
            follows_72h: s.follows_72h,
            last_chapter_event_at: s.last_chapter_event_at
          }
        }
      }),
      total: count || filteredData.length,
      limit,
      offset,
      mode,
      has_more: filteredData.length === limit
    })

  } catch (error: any) {
    return handleApiError(error)
  }
}
