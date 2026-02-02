import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@/lib/supabase/server";
import { scrapers } from "@/lib/scrapers";
import { syncChapters } from "@/lib/series-sync";
import { 
  handleApiError, 
  ApiError, 
  ErrorCodes, 
  validateOrigin,
  getClientIp,
  getRateLimitInfo 
} from "@/lib/api-utils";

const ADMIN_USER_IDS = process.env.ADMIN_USER_IDS?.split(",") || [];

async function requireAdmin(request: NextRequest) {
  const ip = getClientIp(request);
  const ratelimit = await getRateLimitInfo(`admin-db-repair:${ip}`, 30, 60000);
  
  if (!ratelimit.allowed) {
    throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !ADMIN_USER_IDS.includes(user.id)) {
    throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
  }

  return { user, ratelimit };
}

export async function GET(req: NextRequest) {
  try {
    const { ratelimit } = await requireAdmin(req);
    const stats = await getDatabaseHealthStats();
    return NextResponse.json(stats, {
      headers: {
        'X-RateLimit-Limit': ratelimit.limit.toString(),
        'X-RateLimit-Remaining': ratelimit.remaining.toString(),
        'X-RateLimit-Reset': ratelimit.reset.toString(),
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

  export async function POST(req: NextRequest) {
    try {
      validateOrigin(req);
      validateContentType(req);
      await validateJsonSize(req, 1024 * 5); // 5KB limit for repair actions
      const { ratelimit } = await requireAdmin(req);

    const body = await req.json();
    const { action, seriesId, options } = body;

    let result;
    switch (action) {
      case "health-check":
        result = await getDatabaseHealthStats();
        break;

      case "force-sync-series":
        if (!seriesId) {
          throw new ApiError("seriesId required", 400, ErrorCodes.BAD_REQUEST);
        }
        result = await forceSyncSeries(seriesId, options);
        break;

      case "fix-metadata-status":
        result = await fixMetadataStatus();
        break;

      case "relink-orphan-library":
        result = await relinkOrphanLibraryEntries();
        break;

      case "cleanup-broken-sources":
        result = await cleanupBrokenSources();
        break;

      case "cleanup-duplicate-series":
        result = await cleanupDuplicateSeries(options?.keepId);
        break;

      case "batch-sync-empty-series":
        result = await batchSyncEmptySeries(options?.limit || 10);
        break;

      default:
        throw new ApiError("Unknown action", 400, ErrorCodes.BAD_REQUEST);
    }

    return NextResponse.json(result, {
      headers: {
        'X-RateLimit-Limit': ratelimit.limit.toString(),
        'X-RateLimit-Remaining': ratelimit.remaining.toString(),
        'X-RateLimit-Reset': ratelimit.reset.toString(),
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}

async function getDatabaseHealthStats() {
  const [
    totalSeries,
    seriesNoChapters,
    totalChapters,
    orphanChapters,
    totalSources,
    brokenSources,
    pendingMetadata,
    totalLibrary,
    orphanLibrary,
    seriesNoDesc,
    seriesNoMangadex,
  ] = await Promise.all([
    prisma.series.count({ where: { deleted_at: null } }),
    prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count FROM series s
      WHERE s.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM logical_chapters c WHERE c.series_id = s.id AND c.deleted_at IS NULL)
    `.then((r) => r[0].count),
    prisma.chapter.count({ where: { deleted_at: null } }),
    prisma.$queryRaw<[{ count: number }]>`
      SELECT COUNT(*)::int as count FROM logical_chapters c
      WHERE c.deleted_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM chapter_sources cs WHERE cs.chapter_id = c.id)
    `.then((r) => r[0].count),
    prisma.seriesSource.count({}),
    prisma.seriesSource.count({ where: { source_status: "broken" } }),
    prisma.seriesSource.count({ where: { metadata_status: "pending" } }),
    prisma.libraryEntry.count({ where: { deleted_at: null } }),
    prisma.libraryEntry.count({ where: { series_id: null, deleted_at: null } }),
    prisma.series.count({
      where: { OR: [{ description: null }, { description: "" }], deleted_at: null },
    }),
    prisma.series.count({ where: { mangadex_id: null, deleted_at: null } }),
  ]);

  const importStatus = await prisma.series.groupBy({
    by: ["import_status"],
    _count: true,
    where: { deleted_at: null },
  });

  const seriesWithMismatchedCounts = await prisma.$queryRaw<
    Array<{
      id: string;
      title: string;
      metadata_chapters: number | null;
      latest_chapter: string | null;
      actual_chapters: number;
    }>
  >`
    SELECT 
      s.id,
      s.title,
      s.chapter_count as metadata_chapters,
      s.latest_chapter::text,
      COUNT(c.id)::int as actual_chapters
    FROM series s
    LEFT JOIN logical_chapters c ON c.series_id = s.id AND c.deleted_at IS NULL
    WHERE s.deleted_at IS NULL
    GROUP BY s.id
    HAVING (s.chapter_count IS NOT NULL AND s.chapter_count > 10 AND COUNT(c.id) < s.chapter_count / 2)
       OR (s.latest_chapter IS NOT NULL AND s.latest_chapter > 50 AND COUNT(c.id) < 10)
    ORDER BY s.latest_chapter DESC NULLS LAST
    LIMIT 20
  `;

  return {
    summary: {
      totalSeries,
      seriesNoChapters,
      seriesNoChaptersPercent: ((seriesNoChapters / totalSeries) * 100).toFixed(1),
      totalChapters,
      orphanChapters,
      totalSources,
      brokenSources,
      pendingMetadata,
      pendingMetadataPercent: ((pendingMetadata / totalSources) * 100).toFixed(1),
      totalLibrary,
      orphanLibrary,
      orphanLibraryPercent: totalLibrary > 0 ? ((orphanLibrary / totalLibrary) * 100).toFixed(1) : "0",
      seriesNoDesc,
      seriesNoMangadex,
    },
    importStatus: importStatus.reduce(
      (acc, s) => ({ ...acc, [s.import_status || "null"]: s._count }),
      {} as Record<string, number>
    ),
    seriesWithMismatchedCounts: seriesWithMismatchedCounts.slice(0, 10).map((s) => ({
      id: s.id,
      title: s.title?.substring(0, 50),
      expected: s.metadata_chapters || s.latest_chapter,
      actual: s.actual_chapters,
    })),
  };
}

async function forceSyncSeries(seriesId: string, options?: { noLimit?: boolean }) {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      sources: {
        where: { source_status: { not: "broken" } },
        orderBy: { sync_priority: "asc" },
      },
    },
  });

  if (!series) {
    throw new Error("Series not found");
  }

  const results: Array<{
    source: string;
    status: string;
    chaptersFound: number;
    chaptersSynced: number;
    error?: string;
  }> = [];

  for (const source of series.sources) {
    const scraper = scrapers[source.source_name.toLowerCase()];
    if (!scraper) {
      results.push({
        source: source.source_name,
        status: "skipped",
        chaptersFound: 0,
        chaptersSynced: 0,
        error: "No scraper available",
      });
      continue;
    }

    try {
      console.log(`[Force Sync] Scraping ${source.source_name} for ${series.title}...`);

      const scrapedData = await scraper.scrapeSeries(source.source_id);
      const chaptersFound = scrapedData.chapters.length;

      console.log(`[Force Sync] Found ${chaptersFound} chapters from ${source.source_name}`);

      if (chaptersFound === 0) {
        results.push({
          source: source.source_name,
          status: "empty",
          chaptersFound: 0,
          chaptersSynced: 0,
        });
        continue;
      }

      const chaptersSynced = await syncChapters(
        seriesId,
        source.source_id,
        source.source_name,
        scrapedData.chapters,
        { forceUpdate: true }
      );

      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          last_success_at: new Date(),
          last_checked_at: new Date(),
          failure_count: 0,
          source_status: "active",
          source_chapter_count: chaptersFound,
        },
      });

      results.push({
        source: source.source_name,
        status: "success",
        chaptersFound,
        chaptersSynced,
      });
    } catch (error) {
      console.error(`[Force Sync] Error with ${source.source_name}:`, error);

      await prisma.seriesSource.update({
        where: { id: source.id },
        data: {
          last_checked_at: new Date(),
          failure_count: { increment: 1 },
        },
      });

      results.push({
        source: source.source_name,
        status: "error",
        chaptersFound: 0,
        chaptersSynced: 0,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  const totalChaptersAfter = await prisma.chapter.count({
    where: { series_id: seriesId, deleted_at: null },
  });

  const maxChapter = await prisma.chapter.findFirst({
    where: { series_id: seriesId, deleted_at: null },
    orderBy: { chapter_number: "desc" },
    select: { chapter_number: true },
  });

  if (maxChapter) {
    await prisma.series.update({
      where: { id: seriesId },
      data: {
        latest_chapter: maxChapter.chapter_number,
        chapter_count: totalChaptersAfter,
        last_synced_at: new Date(),
      },
    });
  }

  return {
    seriesId,
    title: series.title,
    results,
    totalChaptersAfter,
    latestChapter: maxChapter?.chapter_number,
  };
}

async function fixMetadataStatus() {
  const updated = await prisma.seriesSource.updateMany({
    where: {
      metadata_status: "pending",
      last_success_at: { not: null },
    },
    data: {
      metadata_status: "complete",
    },
  });

  const stillPending = await prisma.seriesSource.count({
    where: { metadata_status: "pending" },
  });

  const neverSynced = await prisma.seriesSource.updateMany({
    where: {
      metadata_status: "pending",
      last_success_at: null,
      created_at: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
    data: {
      metadata_status: "failed",
    },
  });

  return {
    markedComplete: updated.count,
    markedFailed: neverSynced.count,
    stillPending,
  };
}

async function relinkOrphanLibraryEntries() {
  const orphanEntries = await prisma.libraryEntry.findMany({
    where: {
      series_id: null,
      deleted_at: null,
    },
    select: {
      id: true,
      imported_title: true,
      source_url: true,
      source_name: true,
    },
    take: 100,
  });

  let linked = 0;
  let failed = 0;

  for (const entry of orphanEntries) {
    try {
      let series = null;

      if (entry.source_url) {
        const mangadexMatch = entry.source_url.match(
          /mangadex\.org\/title\/([a-f0-9-]+)/i
        );
        if (mangadexMatch) {
          series = await prisma.series.findFirst({
            where: { mangadex_id: mangadexMatch[1] },
          });
        }
      }

      if (!series && entry.imported_title) {
        series = await prisma.series.findFirst({
          where: {
            title: { contains: entry.imported_title, mode: "insensitive" },
          },
          orderBy: { created_at: "asc" },
        });
      }

      if (series) {
        await prisma.libraryEntry.update({
          where: { id: entry.id },
          data: {
            series_id: series.id,
            metadata_status: "enriched",
          },
        });
        linked++;
      } else {
        failed++;
      }
    } catch (err) {
      console.error(`[Relink] Error processing entry ${entry.id}:`, err);
      failed++;
    }
  }

  return { processed: orphanEntries.length, linked, failed };
}

async function cleanupBrokenSources() {
  const deleted = await prisma.seriesSource.deleteMany({
    where: {
      source_status: "broken",
      failure_count: { gte: 10 },
      last_success_at: null,
    },
  });

  const reset = await prisma.seriesSource.updateMany({
    where: {
      source_status: "broken",
      failure_count: { lt: 10 },
    },
    data: {
      source_status: "active",
      failure_count: 0,
    },
  });

  return { deleted: deleted.count, reset: reset.count };
}

async function cleanupDuplicateSeries(keepId?: string) {
  const duplicates = await prisma.$queryRaw<
    Array<{ title: string; count: number; ids: string[] }>
  >`
    SELECT title, COUNT(*)::int as count, array_agg(id) as ids
    FROM series
    WHERE deleted_at IS NULL
    GROUP BY title
    HAVING COUNT(*) > 1
    ORDER BY count DESC
    LIMIT 50
  `;

  let merged = 0;

  for (const dup of duplicates) {
    if (dup.count <= 1) continue;

    const allSeries = await prisma.series.findMany({
      where: { id: { in: dup.ids } },
      include: {
        _count: { select: { chapters: true, sources: true } },
      },
      orderBy: { created_at: "asc" },
    });

    const primary =
      keepId && dup.ids.includes(keepId)
        ? allSeries.find((s) => s.id === keepId)!
        : allSeries.reduce((best, curr) =>
            curr._count.chapters + curr._count.sources >
            best._count.chapters + best._count.sources
              ? curr
              : best
          );

    const others = allSeries.filter((s) => s.id !== primary.id);

    for (const other of others) {
      await prisma.chapter.updateMany({
        where: { series_id: other.id },
        data: { series_id: primary.id },
      });

      await prisma.seriesSource.updateMany({
        where: { series_id: other.id },
        data: { series_id: primary.id },
      });

      await prisma.libraryEntry.updateMany({
        where: { series_id: other.id },
        data: { series_id: primary.id },
      });

      await prisma.series.update({
        where: { id: other.id },
        data: { deleted_at: new Date() },
      });

      merged++;
    }
  }

  return { duplicateGroups: duplicates.length, seriesMerged: merged };
}

async function batchSyncEmptySeries(limit: number) {
  const emptySeries = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT s.id, s.title
    FROM series s
    WHERE s.deleted_at IS NULL
    AND s.mangadex_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM logical_chapters c WHERE c.series_id = s.id AND c.deleted_at IS NULL)
    ORDER BY s.created_at DESC
    LIMIT ${limit}
  `;

  const results: Array<{ id: string; title: string; status: string; chapters: number }> = [];

  for (const series of emptySeries) {
    try {
      const result = await forceSyncSeries(series.id);
      results.push({
        id: series.id,
        title: series.title,
        status: "success",
        chapters: result.totalChaptersAfter,
      });
    } catch (err) {
      results.push({
        id: series.id,
        title: series.title,
        status: "error",
        chapters: 0,
      });
    }

    await new Promise((r) => setTimeout(r, 2000));
  }

  return { processed: results.length, results };
}
