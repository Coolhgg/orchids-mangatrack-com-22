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
    if (!await checkRateLimit(`series-stats:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { id } = await params

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

    let stats = await prisma.seriesStats.findUnique({
      where: { series_id: id },
    })

    if (!stats) {
      const libraryStats = await prisma.libraryEntry.groupBy({
        by: ["status"],
        where: { series_id: id },
        _count: { id: true },
      })

      const ratingStats = await prisma.libraryEntry.groupBy({
        by: ["user_rating"],
        where: { 
          series_id: id,
          user_rating: { not: null },
        },
        _count: { id: true },
      })

      const statusCounts: Record<string, number> = {}
      for (const stat of libraryStats) {
        statusCounts[stat.status] = stat._count.id
      }

      const ratingCounts: Record<number, number> = {}
      for (const stat of ratingStats) {
        if (stat.user_rating !== null) {
          ratingCounts[stat.user_rating] = stat._count.id
        }
      }

      const totalReaders = libraryStats.reduce((sum, s) => sum + s._count.id, 0)
      const totalRatings = ratingStats.reduce((sum, s) => sum + s._count.id, 0)

      stats = await prisma.seriesStats.upsert({
        where: { series_id: id },
        create: {
          series_id: id,
          total_readers: totalReaders,
          readers_reading: statusCounts["reading"] || 0,
          readers_completed: statusCounts["completed"] || 0,
          readers_planning: statusCounts["plan_to_read"] || 0,
          readers_dropped: statusCounts["dropped"] || 0,
          readers_on_hold: statusCounts["on_hold"] || 0,
          total_ratings: totalRatings,
          rating_1: ratingCounts[1] || 0,
          rating_2: ratingCounts[2] || 0,
          rating_3: ratingCounts[3] || 0,
          rating_4: ratingCounts[4] || 0,
          rating_5: ratingCounts[5] || 0,
          rating_6: ratingCounts[6] || 0,
          rating_7: ratingCounts[7] || 0,
          rating_8: ratingCounts[8] || 0,
          rating_9: ratingCounts[9] || 0,
          rating_10: ratingCounts[10] || 0,
        },
        update: {
          total_readers: totalReaders,
          readers_reading: statusCounts["reading"] || 0,
          readers_completed: statusCounts["completed"] || 0,
          readers_planning: statusCounts["plan_to_read"] || 0,
          readers_dropped: statusCounts["dropped"] || 0,
          readers_on_hold: statusCounts["on_hold"] || 0,
          total_ratings: totalRatings,
          rating_1: ratingCounts[1] || 0,
          rating_2: ratingCounts[2] || 0,
          rating_3: ratingCounts[3] || 0,
          rating_4: ratingCounts[4] || 0,
          rating_5: ratingCounts[5] || 0,
          rating_6: ratingCounts[6] || 0,
          rating_7: ratingCounts[7] || 0,
          rating_8: ratingCounts[8] || 0,
          rating_9: ratingCounts[9] || 0,
          rating_10: ratingCounts[10] || 0,
          updated_at: new Date(),
        },
      })
    }

    const totalRatings = stats.total_ratings || 0
    const weightedSum = 
      stats.rating_1 * 1 +
      stats.rating_2 * 2 +
      stats.rating_3 * 3 +
      stats.rating_4 * 4 +
      stats.rating_5 * 5 +
      stats.rating_6 * 6 +
      stats.rating_7 * 7 +
      stats.rating_8 * 8 +
      stats.rating_9 * 9 +
      stats.rating_10 * 10
    
    const averageRating = totalRatings > 0 ? (weightedSum / totalRatings).toFixed(2) : null

    return NextResponse.json({
      series_id: id,
      tracking_stats: {
        total_readers: stats.total_readers,
        reading: stats.readers_reading,
        completed: stats.readers_completed,
        plan_to_read: stats.readers_planning,
        dropped: stats.readers_dropped,
        on_hold: stats.readers_on_hold,
      },
      rating_stats: {
        total_ratings: stats.total_ratings,
        average_rating: averageRating ? parseFloat(averageRating) : null,
        distribution: {
          1: stats.rating_1,
          2: stats.rating_2,
          3: stats.rating_3,
          4: stats.rating_4,
          5: stats.rating_5,
          6: stats.rating_6,
          7: stats.rating_7,
          8: stats.rating_8,
          9: stats.rating_9,
          10: stats.rating_10,
        },
      },
      popularity: {
        rank: stats.popularity_rank,
        weekly_readers: stats.weekly_readers,
        monthly_readers: stats.monthly_readers,
        trending_rank: stats.trending_rank,
      },
      updated_at: stats.updated_at.toISOString(),
    })
  } catch (error: unknown) {
    console.error("Failed to fetch series stats:", error)
    
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2023') {
      return NextResponse.json(
        { error: "Invalid series ID format" },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: "Failed to fetch series stats" },
      { status: 500 }
    )
  }
}
