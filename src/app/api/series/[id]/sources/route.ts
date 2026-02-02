import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { syncSourceQueue } from "@/lib/queues"
import { getSourceFromUrl } from "@/lib/constants/sources"
import { handleApiError, ApiError, ErrorCodes, checkRateLimit, getClientIp, validateOrigin } from "@/lib/api-utils"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    validateOrigin(req)
    validateContentType(req)
    const ip = getClientIp(req)
    if (!await checkRateLimit(`series-sources:${ip}`, 10, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED)
    }

    const { id: seriesId } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const { source_url } = await req.json()
    if (!source_url) {
      throw new ApiError("source_url is required", 400, ErrorCodes.BAD_REQUEST)
    }

    const sourceName = getSourceFromUrl(source_url)
    if (!sourceName) {
      throw new ApiError("Unsupported source site", 400, ErrorCodes.BAD_REQUEST)
    }

    let sourceId = source_url
    try {
      const url = new URL(source_url)
      if (sourceName === 'MangaDex') {
        sourceId = url.pathname.split('/').pop() || source_url
      } else {
        sourceId = url.pathname
      }
    } catch (err) {
      console.warn(`[SeriesSource] Failed to parse source URL "${source_url}", using raw URL as sourceId:`, err instanceof Error ? err.message : err)
    }

    const seriesSource = await prisma.seriesSource.upsert({
      where: {
        source_name_source_id: {
          source_name: sourceName,
          source_id: sourceId
        }
      },
      update: {
        series_id: seriesId,
        source_url: source_url,
        source_status: 'active',
      },
      create: {
        series_id: seriesId,
        source_name: sourceName,
        source_id: sourceId,
        source_url: source_url,
        sync_priority: 'WARM',
        source_status: 'active',
      }
    })

    await prisma.libraryEntry.updateMany({
      where: {
        user_id: user.id,
        series_id: seriesId
      },
      data: {
        source_url: source_url,
        source_name: sourceName
      }
    })

    await syncSourceQueue.add(
      `sync-${seriesSource.id}`,
      { 
        sourceId: seriesSource.id,
        seriesId: seriesId,
        force: true 
      },
      { priority: 1 }
    )

    return NextResponse.json({
      success: true,
      source_id: seriesSource.id,
      message: "Source attached. Chapter sync started."
    })
  } catch (error) {
    return handleApiError(error)
  }
}
