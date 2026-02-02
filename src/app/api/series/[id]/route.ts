import { prisma, withRetry } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"
import { createClient } from "@/lib/supabase/server"
import { recordSignal } from "@/lib/analytics/signals"

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`series:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED)
    }

    const { id } = await params

    if (!UUID_REGEX.test(id)) {
      throw new ApiError("Invalid series ID format", 400, ErrorCodes.VALIDATION_ERROR)
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    const series = await withRetry(() =>
      prisma.series.findUnique({
        where: { id, deleted_at: null },
        include: {
          sources: {
            orderBy: { trust_score: "desc" },
          },
          creators: {
            include: {
              creator: true,
            },
          },
          stats: true,
          relations: {
            include: {
              related: {
                select: {
                  id: true,
                  title: true,
                  cover_url: true,
                  type: true,
                  status: true,
                },
              },
            },
          },
        },
      })
    )

    if (!series) {
      throw new ApiError("Series not found", 404, ErrorCodes.NOT_FOUND)
    }

    // Record manga_click signal for authenticated users (non-blocking)
    if (user) {
      recordSignal({
        user_id: user.id,
        series_id: id,
        signal_type: 'manga_click',
        metadata: { source: 'series_page' }
      }).catch(err => console.error('[Series] Failed to record signal:', err.message));
    }

    let libraryEntry = null
    let userProgress = null

    if (user) {
      libraryEntry = await prisma.libraryEntry.findFirst({
        where: {
          user_id: user.id,
          series_id: id,
          deleted_at: null, // BUG FIX: Respect soft delete
        },
      })

      if (libraryEntry) {
      const readChapters = await prisma.userChapterRead.findMany({
            where: {
              user_id: user.id,
              chapter: {
                series_id: id,
              },
            },
            select: {
              chapter_id: true,
              chapter: {
                select: {
                  chapter_number: true,
                },
              },
            },
          })

          userProgress = {
            status: libraryEntry.status,
            last_read_chapter: libraryEntry.last_read_chapter ? Number(libraryEntry.last_read_chapter) : null,
            preferred_source: libraryEntry.preferred_source,
            user_rating: libraryEntry.user_rating,
            chapters_read: readChapters.map((r) => ({
              chapter_id: r.chapter_id,
              chapter_number: r.chapter.chapter_number ? Number(r.chapter.chapter_number) : null,
            })),
          }
      }
    }

    // Get chapter stats per source through ChapterSource model
    const chapterSourceStats = await prisma.chapterSource.groupBy({
      by: ["series_source_id"],
      where: { 
        chapter: { series_id: id }
      },
      _count: { id: true },
    });

    // Get max chapter number per source
    const sourceChapterMaxes = await prisma.chapterSource.findMany({
      where: { 
        chapter: { series_id: id }
      },
      select: {
        series_source_id: true,
        chapter: {
          select: { chapter_number: true }
        }
      }
    });

    // Build a map of source -> max chapter number
    const sourceMaxChapters = new Map<string, string>();
    for (const sc of sourceChapterMaxes) {
      const current = sourceMaxChapters.get(sc.series_source_id);
      const chNum = sc.chapter.chapter_number;
      if (!current || (chNum && parseFloat(chNum) > parseFloat(current))) {
        sourceMaxChapters.set(sc.series_source_id, chNum);
      }
    }

    const totalChapters = await prisma.chapter.count({
      where: { series_id: id },
    })

    const latestChapter = await prisma.chapter.findFirst({
      where: { series_id: id },
      orderBy: { chapter_number: "desc" },
      select: { chapter_number: true, published_at: true },
    })

    const sourcesWithStats = series.sources.map(source => {
      const stats = chapterSourceStats.find(c => c.series_source_id === source.id)
      const maxChapterNum = sourceMaxChapters.get(source.id)
      return {
        id: source.id,
        source_name: source.source_name,
        source_url: source.source_url,
        source_title: source.source_title,
        trust_score: Number(source.trust_score),
        chapter_count: stats?._count.id || 0,
        latest_chapter: maxChapterNum ? Number(maxChapterNum) : null,
        last_success_at: source.last_success_at?.toISOString() || null,
        cover_url: source.cover_url,
      }
    })

    const authors = series.creators
      .filter(sc => sc.role === "author")
      .map(sc => ({ id: sc.creator.id, name: sc.creator.name }))
    const artists = series.creators
      .filter(sc => sc.role === "artist")
      .map(sc => ({ id: sc.creator.id, name: sc.creator.name }))

    const relatedSeries = series.relations.map(r => ({
      id: r.related.id,
      title: r.related.title,
      cover_url: r.related.cover_url,
      type: r.related.type,
      status: r.related.status,
      relation_type: r.relation_type,
    }))

    return NextResponse.json({
      id: series.id,
      mangadex_id: series.mangadex_id,
      title: series.title,
      alternative_titles: series.alternative_titles,
      description: series.description,
      cover_url: series.cover_url,
      type: series.type,
      status: series.status,
      genres: series.genres,
      tags: series.tags,
      themes: series.themes,
      format_tags: series.format_tags,
      demographic: series.demographic,
      content_rating: series.content_rating,
      content_warnings: series.content_warnings,
      original_language: series.original_language,
      translated_languages: series.translated_languages,
      year: series.year || series.release_year,
      external_links: series.external_links,
      authors,
      artists,
      sources: sourcesWithStats,
      related_series: relatedSeries,
      stats: series.stats ? {
        total_readers: series.stats.total_readers,
        readers_reading: series.stats.readers_reading,
        readers_completed: series.stats.readers_completed,
        readers_planning: series.stats.readers_planning,
        readers_dropped: series.stats.readers_dropped,
        readers_on_hold: series.stats.readers_on_hold,
        total_ratings: series.stats.total_ratings,
        rating_distribution: {
          1: series.stats.rating_1,
          2: series.stats.rating_2,
          3: series.stats.rating_3,
          4: series.stats.rating_4,
          5: series.stats.rating_5,
          6: series.stats.rating_6,
          7: series.stats.rating_7,
          8: series.stats.rating_8,
          9: series.stats.rating_9,
          10: series.stats.rating_10,
        },
        popularity_rank: series.stats.popularity_rank,
        trending_rank: series.stats.trending_rank,
      } : null,
      total_chapters: totalChapters,
      latest_chapter: latestChapter ? Number(latestChapter.chapter_number) : null,
      last_chapter_at: latestChapter?.published_at?.toISOString() || series.last_chapter_at?.toISOString() || null,
      total_follows: series.total_follows,
      total_views: series.total_views,
      average_rating: series.average_rating ? Number(series.average_rating) : null,
      user_progress: userProgress,
      in_library: !!libraryEntry,
      created_at: series.created_at.toISOString(),
      updated_at: series.updated_at.toISOString(),
    })
  } catch (error: unknown) {
    // BUG FIX: Use centralized error handler for consistency
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2023') {
      return handleApiError(new ApiError("Invalid series ID format", 400, ErrorCodes.VALIDATION_ERROR))
    }
    
    return handleApiError(error)
  }
}
