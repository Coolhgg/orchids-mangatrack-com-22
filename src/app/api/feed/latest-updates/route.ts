import { prismaRead } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes, parsePaginationParams } from "@/lib/api-utils"
import { LATEST_UPDATES_SQL, LATEST_UPDATES_COUNT_SQL } from "@/lib/feed-eligibility"

interface LatestUpdateRow {
  id: string
  chapter_number: string
  chapter_title: string | null
  volume_number: number | null
  published_at: Date | null
  first_detected_at: Date
  series_id: string
  series_title: string
  cover_url: string | null
  content_rating: string | null
  series_status: string | null
  series_type: string
  catalog_tier: string
}

interface CountResult {
  total: bigint
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed-latest-updates:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePaginationParams(searchParams);

    const rawResults = await prismaRead.$queryRawUnsafe(LATEST_UPDATES_SQL, limit + 1, offset) as LatestUpdateRow[];
    const countResult = await prismaRead.$queryRawUnsafe(LATEST_UPDATES_COUNT_SQL) as CountResult[];

    const hasMore = rawResults.length > limit;
    const results = hasMore ? rawResults.slice(0, -1) : rawResults;
    const total = Number(countResult[0]?.total || 0);

    const chapterIds = results.map((r: LatestUpdateRow) => r.id);
    const chapterSources = chapterIds.length > 0
      ? await prismaRead.chapterSource.findMany({
          where: { chapter_id: { in: chapterIds }, is_available: true },
          include: {
            SeriesSource: {
              select: { id: true, source_name: true, source_url: true, trust_score: true }
            }
          },
          orderBy: { detected_at: 'asc' }
        })
      : [];

    const sourcesByChapter = new Map<string, typeof chapterSources>();
    for (const cs of chapterSources) {
      const existing = sourcesByChapter.get(cs.chapter_id) || [];
      existing.push(cs);
      sourcesByChapter.set(cs.chapter_id, existing);
    }

    const items = results.map((row: LatestUpdateRow) => {
      const sources = sourcesByChapter.get(row.id) || [];
      const sortedSources = [...sources].sort((a, b) => 
        Number(b.SeriesSource.trust_score) - Number(a.SeriesSource.trust_score)
      );
      const primarySource = sortedSources[0];

      return {
        id: row.id,
        chapter_number: Number(row.chapter_number),
        chapter_title: row.chapter_title,
        volume_number: row.volume_number,
        published_at: row.published_at?.toISOString() || null,
        discovered_at: row.first_detected_at.toISOString(),
        series: {
          id: row.series_id,
          title: row.series_title,
          cover_url: row.cover_url,
          content_rating: row.content_rating,
          status: row.series_status,
          type: row.series_type,
          catalog_tier: row.catalog_tier,
        },
        sources: sortedSources.map(s => ({
          id: s.id,
          chapter_url: s.source_chapter_url,
          scanlation_group: s.scanlation_group,
          language: s.language,
          source: {
            id: s.SeriesSource.id,
            name: s.SeriesSource.source_name,
            url: s.SeriesSource.source_url,
            trust_score: Number(s.SeriesSource.trust_score),
          }
        })),
        primary_source: primarySource ? {
          id: primarySource.id,
          chapter_url: primarySource.source_chapter_url,
          source_name: primarySource.SeriesSource.source_name,
          language: primarySource.language,
        } : null
      };
    });

    return NextResponse.json({
      feed_type: 'latest_updates',
      results: items,
      total,
      has_more: hasMore,
      pagination: {
        limit,
        offset,
        next_offset: hasMore ? offset + limit : null,
      },
      rules: {
        description: 'Chapter availability events for Tier B/C manga (excludes Chapter 1 for untracked Tier C)',
        allowed_tiers: ['B', 'C'],
        chapter_filter: 'all (excludes Ch1 for Tier C)',
        exclusion: 'Chapter 1 of Tier C (untracked) manga',
      }
    });

  } catch (error: unknown) {
    return handleApiError(error);
  }
}
