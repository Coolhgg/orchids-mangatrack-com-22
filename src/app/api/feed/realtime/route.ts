import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"
import { PRODUCTION_QUERIES } from "@/lib/sql/production-queries"

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed-realtime:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    // Execute the MangaTrack-logic real-time feed query
    const results = await prisma.$queryRawUnsafe<any[]>(
      PRODUCTION_QUERIES.REALTIME_UPDATES_FEED,
      limit
    );

    return NextResponse.json({
      updates: results.map(row => ({
        chapter_id: row.chapter_id,
        series_title: row.series_title,
        cover_url: row.cover_url,
        chapter_number: Number(row.chapter_number),
        activity_at: row.activity_at,
        sources: row.available_sources
      })),
      count: results.length
    });

  } catch (error: any) {
    return handleApiError(error);
  }
}
