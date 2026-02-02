import { prisma } from "@/lib/prisma"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, getClientIp, handleApiError, ApiError, ErrorCodes } from "@/lib/api-utils"
import { createClient } from "@/lib/supabase/server"
import { redisApi, REDIS_KEY_PREFIX } from "@/lib/redis"

interface ActivityEventRow {
  id: string;
  series_id: string;
  series_title: string;
  series_thumbnail: string | null;
  chapter_id: string;
  chapter_number: string;
  chapter_type: string;
  chapter_title: string | null;
  volume_number: number | null;
  source_id: string;
  source_name: string;
  source_url: string;
  event_type: string;
  discovered_at: Date;
}

// BUG FIX: Whitelist valid filter values to prevent injection
const VALID_FILTERS = new Set(['all', 'unread']);

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    if (!await checkRateLimit(`feed-activity:${ip}`, 60, 60000)) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const { searchParams } = new URL(request.url);
    const cursorStr = searchParams.get("cursor");
    
    // BUG FIX: Validate and sanitize limit parameter
    const rawLimit = parseInt(searchParams.get("limit") || "30", 10);
    const limit = Math.min(Math.max(1, isNaN(rawLimit) ? 30 : rawLimit), 100);
    
    // BUG FIX: Validate filter against whitelist
    const rawFilter = searchParams.get("filter") || "all";
    const filter = VALID_FILTERS.has(rawFilter) ? rawFilter : "all";

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ entries: [], next_cursor: null, has_more: false });
    }

    // 1. Caching Layer
    const versionKey = `${REDIS_KEY_PREFIX}feed:v:${user.id}`;
    let version = await redisApi.get(versionKey);
    if (!version) {
      version = "1";
      await redisApi.set(versionKey, version);
    }

    const cacheKey = `${REDIS_KEY_PREFIX}feed:act:${user.id}:v${version}:${filter}:${cursorStr || 'initial'}:${limit}`;
    const cached = await redisApi.get(cacheKey);
    if (cached) {
      try {
        return NextResponse.json(JSON.parse(cached));
      } catch {
        // BUG FIX: Handle corrupted cache gracefully
        console.warn("[Feed] Corrupted cache entry, fetching fresh data");
      }
    }

    // 2. Fetch from DB if cache miss
    // Get last seen timestamp for "New" badge logic
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { feed_last_seen_at: true }
    });
    const feedLastSeenAt = dbUser?.feed_last_seen_at || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // Decode cursor with validation
    let cursorData: { d: string, i: string } | null = null;
    if (cursorStr) {
      try {
        const decoded = Buffer.from(cursorStr, 'base64').toString();
        const parsed = JSON.parse(decoded);
        // BUG FIX: Validate cursor structure
        if (parsed && typeof parsed.d === 'string' && typeof parsed.i === 'string') {
          // Validate date format
          const parsedDate = new Date(parsed.d);
          if (!isNaN(parsedDate.getTime())) {
            // Validate UUID format for id
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
            if (uuidRegex.test(parsed.i)) {
              cursorData = parsed;
            }
          }
        }
      } catch (e) {
        console.error("Invalid cursor:", e);
        // BUG FIX: Don't expose error details, just ignore invalid cursor
      }
    }

    const params: any[] = [user.id];
    let query = `
      SELECT ae.*
      FROM availability_events ae
      JOIN series s ON ae.series_id::uuid = s.id::uuid
      JOIN chapters lc ON ae.chapter_id::uuid = lc.id::uuid
      WHERE ae.user_id = $1::uuid
        AND s.deleted_at IS NULL
        AND lc.deleted_at IS NULL
    `;

    // Apply unread filter if requested (filter is already validated)
    if (filter === "unread") {
      query += `
        AND NOT EXISTS (
          SELECT 1 FROM user_chapter_reads_v2
          WHERE user_id = $1::uuid
          AND chapter_id = ae.chapter_id
        )
      `;
    }

    if (cursorData) {
      query += `
        AND (
          ae.discovered_at < $${params.length + 1}::timestamptz 
          OR (ae.discovered_at = $${params.length + 1}::timestamptz AND ae.id < $${params.length + 2}::uuid)
        )
      `;
      params.push(cursorData.d, cursorData.i);
    }

    query += `
      ORDER BY ae.discovered_at DESC, ae.id DESC
      LIMIT $${params.length + 1}
    `;
    params.push(limit + 1);

    const events = await prisma.$queryRawUnsafe<ActivityEventRow[]>(query, ...params);

    const hasMore = events.length > limit;
    const items = hasMore ? events.slice(0, -1) : events;
    
    // Generate next cursor
    const nextCursor = hasMore && items.length > 0 
      ? Buffer.from(JSON.stringify({
          d: items[items.length - 1].discovered_at.toISOString(),
          i: items[items.length - 1].id
        })).toString('base64')
      : null;

    // Fetch read status in a separate query to adhere to "No joins at request time" for the main event query
    const chapterIds = Array.from(new Set(items.map(e => e.chapter_id)));
    
    // BUG FIX: Only query if there are chapter IDs to check
    let readSet = new Set<string>();
    if (chapterIds.length > 0) {
      const readChapters = await prisma.userChapterReadV2.findMany({
        where: {
          user_id: user.id,
          chapter_id: { in: chapterIds }
        },
        select: { chapter_id: true }
      });
      readSet = new Set(readChapters.map(rc => rc.chapter_id));
    }

    const response = {
      entries: items.map((event) => ({
        id: event.id,
        series: {
          id: event.series_id,
          title: event.series_title,
          cover_url: event.series_thumbnail,
          content_rating: null,
          status: null,
          type: 'manga',
        },
        chapter_number: Number(event.chapter_number),
        chapter_title: event.chapter_title,
        volume_number: event.volume_number,
        is_unseen: new Date(event.discovered_at) > feedLastSeenAt,
        is_read: readSet.has(event.chapter_id),
        sources: [{
          name: event.source_name,
          url: event.source_url,
          discovered_at: event.discovered_at.toISOString(),
        }],
        first_discovered_at: event.discovered_at.toISOString(),
        last_updated_at: event.discovered_at.toISOString(),
      })),
      next_cursor: nextCursor,
      has_more: hasMore,
    };

    // Cache the response for 60 seconds
    try {
      await redisApi.set(cacheKey, JSON.stringify(response), 'EX', 60);
    } catch (cacheError) {
      // BUG FIX: Don't fail the request if caching fails
      console.warn("[Feed] Failed to cache response:", cacheError);
    }

    return NextResponse.json(response);
  } catch (error) {
    return handleApiError(error);
  }
}
