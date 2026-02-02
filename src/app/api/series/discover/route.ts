
import { supabaseAdmin } from "@/lib/supabase/admin"
import { NextRequest, NextResponse } from "next/server"
import { getRateLimitInfo, handleApiError, getClientIp, ErrorCodes } from "@/lib/api-utils"
import { getBestCoversBatch, isValidCoverUrl } from "@/lib/cover-resolver"
import { DISCOVERY_SECTIONS, DiscoverySection } from "@/lib/discovery"
import { isBlockedContent } from "@/lib/constants/safe-browsing"

export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rateLimitInfo = await getRateLimitInfo(`discover:${ip}`, 60, 60000)
  
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
  const section = searchParams.get('section') as DiscoverySection
  const windowParam = searchParams.get('window') as 'today' | 'week' | 'month'
  const limit = Math.min(Math.max(1, parseInt(searchParams.get('limit') || '20')), 50)
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0'))

  if (!section || !Object.values(DISCOVERY_SECTIONS).includes(section)) {
    return NextResponse.json(
      { error: `Invalid section. Must be one of: ${Object.values(DISCOVERY_SECTIONS).join(', ')}` },
      { status: 400 }
    )
  }

  // Calculate trending window and half-life if applicable
  let windowHours = 168 // 7 days default
  let halfLifeHours = 72 // 3 days default

  if (section === DISCOVERY_SECTIONS.TRENDING) {
    if (windowParam === 'today') {
      windowHours = 24
      halfLifeHours = 12
    } else if (windowParam === 'month') {
      windowHours = 720
      halfLifeHours = 360
    }
  }

  try {
    const { data, error } = await supabaseAdmin.rpc('get_discover_section', {
      p_section: section,
      p_limit: limit,
      p_offset: offset,
      p_window_hours: windowHours,
      p_half_life_hours: halfLifeHours
    })

    if (error) throw error

    // CRITICAL: Filter out pornographic content (platform policy)
    const filteredData = (data || []).filter((s: any) => !isBlockedContent(s.content_rating))

    const seriesIds = filteredData.map((s: any) => s.id)
    const bestCovers = await getBestCoversBatch(seriesIds)

    return NextResponse.json({
      results: filteredData.map((s: any) => {
        const bestCover = bestCovers.get(s.id)
        const fallbackCover = isValidCoverUrl(s.cover_url) ? s.cover_url : null
        return {
          ...s,
          cover_url: bestCover?.cover_url || fallbackCover,
        }
      }),
      limit,
      offset,
      section,
      has_more: filteredData.length === limit
    })

  } catch (error: any) {
    return handleApiError(error)
  }
}
