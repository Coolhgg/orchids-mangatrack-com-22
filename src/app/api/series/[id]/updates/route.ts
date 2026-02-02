import { prisma, withRetry } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`series-updates:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { id } = await params
    const { searchParams } = new URL(request.url)
    const cursor = searchParams.get("cursor")
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50)

    if (!UUID_REGEX.test(id)) {
      return NextResponse.json(
        { error: "Invalid series ID format" },
        { status: 400 }
      )
    }

    const series = await withRetry(() =>
      prisma.series.findUnique({
        where: { id },
        select: { id: true },
      })
    )

    if (!series) {
      return NextResponse.json(
        { error: "Series not found" },
        { status: 404 }
      )
    }

        const cursorDate = cursor ? new Date(cursor) : undefined

        const updates = await prisma.chapter.findMany({
          where: {
            series_id: id,
            ...(cursorDate && { first_detected_at: { lt: cursorDate } }),
          },
          orderBy: { first_detected_at: "desc" },
          take: limit + 1,
          include: {
            sources: {
              where: { is_available: true },
              include: {
                series_source: {
                  select: {
                    id: true,
                    source_name: true,
                    source_url: true,
                    trust_score: true,
                  },
                },
              },
            },
          },
        })

        const hasMore = updates.length > limit
        const items = hasMore ? updates.slice(0, -1) : updates
        const nextCursor = hasMore ? items[items.length - 1].first_detected_at.toISOString() : null

        return NextResponse.json({
          updates: items.map((lc) => {
            // Sort sources by trust_score desc to pick the "best" one as primary
            const sortedSources = [...lc.sources].sort((a, b) => 
              Number(b.series_source.trust_score) - Number(a.series_source.trust_score)
            );
            const primarySource = sortedSources[0];

            return {
              id: lc.id,
              chapter_number: Number(lc.chapter_number),
              chapter_title: lc.chapter_title,
              volume_number: lc.volume_number,
                published_at: lc.published_at?.toISOString() || null,
                discovered_at: lc.first_detected_at.toISOString(),
                // Include multiple sources as per Canonical Specification Rule 2
                sources: sortedSources.map(s => ({
                  id: s.id,
                  chapter_url: s.source_chapter_url,
                  scanlation_group: s.scanlation_group,
                  language: s.language,
                  source: {
                    id: s.series_source.id,
                    name: s.series_source.source_name,
                    url: s.series_source.source_url,
                    trust_score: Number(s.series_source.trust_score),
                  }
                })),
                // Backward compatibility fields using primary source
                chapter_url: primarySource?.source_chapter_url,
                scanlation_group: primarySource?.scanlation_group,
                language: primarySource?.language,
              source: primarySource ? {
                id: primarySource.series_source.id,
                name: primarySource.series_source.source_name,
                url: primarySource.series_source.source_url,
                trust_score: Number(primarySource.series_source.trust_score),
              } : null,
            };
          }),
          next_cursor: nextCursor,
          has_more: hasMore,
        })

  } catch (error: unknown) {
    console.error("Failed to fetch series updates:", error)
    
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2023') {
      return NextResponse.json(
        { error: "Invalid series ID format" },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: "Failed to fetch series updates" },
      { status: 500 }
    )
  }
}
