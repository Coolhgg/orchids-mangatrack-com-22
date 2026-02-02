import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes, parsePaginationParams } from "@/lib/api-utils"
import { Prisma } from "@prisma/client"

interface AvailabilityEventRow {
  event_id: string
  occurred_at: Date
  series_id: string
  series_title: string
  series_cover: string | null
  chapter_number: string
  source_name: string
  source_url: string
  scanlation_group: string | null
}

interface CountResult {
  total: bigint
}

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed-availability:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { searchParams } = new URL(request.url);
    const { limit, offset } = parsePaginationParams(searchParams);

    // Use Prisma.sql for type-safe parameterized queries (prevents SQL injection)
    const rawResults = await prisma.$queryRaw<AvailabilityEventRow[]>(Prisma.sql`
      SELECT 
        ca.id as event_id,
        ca.discovered_at as occurred_at,
        s.id as series_id,
        s.title as series_title,
        s.cover_url as series_cover,
        s.catalog_tier,
        ca.chapter_number,
        ca.source_name,
        ca.source_url,
        NULL as scanlation_group
      FROM chapter_availability ca
      JOIN series s ON s.id = ca.series_id
      WHERE s.deleted_at IS NULL
        AND (
          s.catalog_tier = 'B'
          OR (s.catalog_tier = 'C' AND ca.chapter_number > 1)
        )
      ORDER BY ca.discovered_at DESC
      LIMIT ${limit + 1}
      OFFSET ${offset}
    `);
    
    const countResult = await prisma.$queryRaw<CountResult[]>(Prisma.sql`
      SELECT COUNT(*) as total
      FROM chapter_availability ca
      JOIN series s ON s.id = ca.series_id
      WHERE s.deleted_at IS NULL
        AND (
          s.catalog_tier = 'B'
          OR (s.catalog_tier = 'C' AND ca.chapter_number > 1)
        )
    `);

    const hasMore = rawResults.length > limit;
    const results = hasMore ? rawResults.slice(0, -1) : rawResults;
    const total = Number(countResult[0]?.total || 0);

    const items = results.map((row: AvailabilityEventRow) => ({
      event_id: row.event_id,
      occurred_at: row.occurred_at.toISOString(),
      series: {
        id: row.series_id,
        title: row.series_title,
        cover_url: row.series_cover,
      },
      chapter: {
        id: `${row.series_id}-${row.chapter_number}`, // Virtual ID since we group by number
        number: Number(row.chapter_number),
        display: row.chapter_number,
      },
      source: {
        name: row.source_name,
        url: row.source_url,
        group: row.scanlation_group,
      },
    }));

    return NextResponse.json({
      feed_type: 'availability_events',
      results: items,
      total,
      has_more: hasMore,
      pagination: {
        limit,
        offset,
        next_offset: hasMore ? offset + limit : null,
      }
    });

  } catch (error: unknown) {
    return handleApiError(error);
  }
}
