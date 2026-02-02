import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { seriesResolutionQueue } from "@/lib/queues"
import { CrawlGatekeeper } from "@/lib/crawl-gatekeeper"
import { getSourceFromUrl } from "@/lib/constants/sources"
import { extractMangaDexId } from "@/lib/mangadex-utils"
import { checkRateLimit, ApiError, ErrorCodes, handleApiError, getClientIp, validateOrigin } from "@/lib/api-utils"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    validateOrigin(req)
    validateContentType(req)
    const { id: seriesId } = await params
    
    // Rate limit: 10 updates per minute per IP
    const ip = getClientIp(req);
    if (!await checkRateLimit(`series-metadata:${ip}`, 10, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const { canonical_url } = await req.json()
    if (!canonical_url) {
      return NextResponse.json({ message: "canonical_url is required" }, { status: 400 })
    }

    const platform = getSourceFromUrl(canonical_url)
    if (!platform || !['MangaDex', 'AniList', 'MyAnimeList'].includes(platform)) {
      return NextResponse.json({ message: "Only MangaDex, AniList, or MAL are accepted" }, { status: 400 })
    }

    // 1. Handle MangaDex specially (dual purpose: sync + metadata)
    if (platform === 'MangaDex') {
      const sourceId = extractMangaDexId(canonical_url) || canonical_url

      const seriesSource = await prisma.seriesSource.upsert({
        where: {
          source_name_source_id: {
            source_name: 'MangaDex',
            source_id: sourceId
          }
        },
        update: {
          series_id: seriesId,
          source_url: canonical_url,
        },
        create: {
          series_id: seriesId,
          source_name: 'MangaDex',
          source_id: sourceId,
          source_url: canonical_url,
          sync_priority: 'WARM'
        }
      })

      // Trigger sync for MangaDex
      const series = await prisma.series.findUnique({
        where: { id: seriesId },
        select: { catalog_tier: true }
      });

      await CrawlGatekeeper.enqueueIfAllowed(
        seriesSource.id,
        series?.catalog_tier || 'C',
        'USER_REQUEST',
        { 
          sourceId: seriesSource.id,
          seriesId: seriesId,
          force: true 
        }
      );
    }

    // 2. Update series external_links
    const series = await prisma.series.findUnique({
      where: { id: seriesId },
      select: { external_links: true }
    })

    const links = (series?.external_links as any) || {}
    links[platform.toLowerCase()] = canonical_url

    await prisma.series.update({
      where: { id: seriesId },
      data: {
        external_links: links,
        // If it's mangadex, we also update mangadex_id
        ...(platform === 'MangaDex' ? { mangadex_id: extractMangaDexId(canonical_url) } : {})
      }
    })

    // 3. Queue metadata resolution
    await seriesResolutionQueue.add(
      `resolve-${seriesId}-${Date.now()}`,
      { 
        seriesId: seriesId,
        platform: platform.toLowerCase(),
        url: canonical_url,
        force: true
      },
      { priority: 1 }
    )

    return NextResponse.json({
      success: true,
      message: "Metadata update queued."
    })

  } catch (error: any) {
    console.error("[METADATA_POST]", error)
    return handleApiError(error)
  }
}
