import { prisma } from '@/lib/prisma';
import { checkSourceQueue, isQueueHealthy } from '@/lib/queues';
import { areWorkersOnline } from '@/lib/redis';
import { detectSearchIntent } from '@/lib/search-intent';
import { shouldEnqueueExternalSearch, markQueryEnqueued, normalizeSearchQuery } from '@/lib/search-utils';
import { SEARCH_PRIORITY } from '@/lib/search-cache';

const QUEUE_HEALTH_THRESHOLD = 1000;

export interface SeriesSearchResult {
  id: string;
  title: string;
  canonical_series_id: string | null;
  total_follows: number | null;
  average_rating: number | null;
  cover_url: string | null;
  type: string | null;
  status: string | null;
  genres: string[] | null;
  content_rating: string | null;
  description: string | null;
  alternative_titles: Record<string, string> | null;
  best_match_score: number;
}

export interface SeriesSearchOptions {
  searchQuery: string;
  limit?: number;
  offset?: number;
  safeBrowsingMode?: 'sfw' | 'questionable' | 'nsfw';
  userId?: string;
  isPremium?: boolean;
}

export interface SeriesSearchResponse {
  results: SeriesSearchResult[];
  total: number;
  hasMore: boolean;
  externalSearchTriggered: boolean;
}

/**
 * Series Search Query with Content Filtering
 * 
 * CONTENT POLICY: 'pornographic' content is BLOCKED platform-wide.
 * All safe browsing modes filter it out:
 * - sfw: safe, suggestive only
 * - questionable: safe, suggestive, questionable (legacy mode)
 * - nsfw: safe, suggestive, erotica (NOT pornographic - blocked platform-wide)
 * 
 * NULL content_rating is always included (legacy data support)
 */
const SERIES_SEARCH_QUERY = `
WITH normalized_query AS (
  SELECT lower(unaccent($1::text)) AS q
),

search_matches AS (
  SELECT 
    s.id,
    s.title,
    s.alternative_titles,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.content_rating,
    s.total_follows,
    s.average_rating,
    s.mangadex_id,
    s.canonical_series_id,
    s.created_at,
    s.description,
    nq.q AS normalized_query,
    CASE 
      WHEN lower(unaccent(s.title)) = nq.q THEN 1
      WHEN lower(unaccent(COALESCE(s.search_index, ''))) = nq.q THEN 1
      ELSE 0 
    END AS exact_match_boost,
    GREATEST(
      similarity(lower(unaccent(s.title)), nq.q),
      similarity(lower(unaccent(COALESCE(s.search_index, ''))), nq.q)
    ) AS similarity_score
  FROM series s
  CROSS JOIN normalized_query nq
  WHERE 
    s.deleted_at IS NULL
    AND (
      lower(unaccent(s.title)) % nq.q
      OR lower(unaccent(COALESCE(s.search_index, ''))) % nq.q
      OR lower(unaccent(s.title)) ILIKE '%' || nq.q || '%'
    )
    AND (
      ($4::text = 'sfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive'))) OR
      ($4::text = 'questionable' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'questionable'))) OR
      ($4::text = 'nsfw' AND (s.content_rating IS NULL OR s.content_rating IN ('safe', 'suggestive', 'erotica')))
    )
),

deduplicated AS (
  SELECT 
    sm.*,
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(sm.canonical_series_id::text, sm.mangadex_id, sm.id::text) 
      ORDER BY 
        sm.total_follows DESC NULLS LAST,
        sm.similarity_score DESC,
        sm.created_at DESC
    ) AS rn
  FROM search_matches sm
)

SELECT 
  d.id,
  d.title,
  COALESCE(d.canonical_series_id::text, d.mangadex_id) AS canonical_series_id,
  d.total_follows,
  d.average_rating,
  d.cover_url,
  d.type,
  d.status,
  d.genres,
  d.content_rating,
  d.description,
  d.alternative_titles,
  (d.exact_match_boost * 1000 + COALESCE(d.total_follows, 0) * 0.001 + d.similarity_score * 100)::numeric AS best_match_score
FROM deduplicated d
WHERE d.rn = 1
ORDER BY 
  d.exact_match_boost DESC,
  d.total_follows DESC NULLS LAST,
  d.similarity_score DESC,
  d.created_at DESC
LIMIT $2::integer
OFFSET $3::integer;
`;

export async function searchSeries(options: SeriesSearchOptions): Promise<SeriesSearchResponse> {
  const {
    searchQuery,
    limit = 24,
    offset = 0,
    safeBrowsingMode = 'sfw',
    userId,
    isPremium = false,
  } = options;

  if (!searchQuery || searchQuery.trim().length === 0) {
    return { results: [], total: 0, hasMore: false, externalSearchTriggered: false };
  }

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);
  const normalizedKey = normalizeSearchQuery(searchQuery);

  const results = await prisma.$queryRawUnsafe<SeriesSearchResult[]>(
    SERIES_SEARCH_QUERY,
    searchQuery,
    safeLimit + 1,
    safeOffset,
    safeBrowsingMode
  );

  const hasMore = results.length > safeLimit;
  const trimmedResults = hasMore ? results.slice(0, safeLimit) : results;

  let externalSearchTriggered = false;

  if (trimmedResults.length < 5 && offset === 0) {
    try {
      const intent = detectSearchIntent(normalizedKey, trimmedResults);
      const hasGoodMatch = trimmedResults.some((r) => {
        const title = (r.title || '').toLowerCase();
        const q = normalizedKey.toLowerCase();
        return (title.includes(q) || q.includes(title)) && r.cover_url && r.description;
      });

      if (intent !== 'NOISE' || !hasGoodMatch) {
        const workersOnline = await areWorkersOnline();
        const queueHealthy = await isQueueHealthy(checkSourceQueue, QUEUE_HEALTH_THRESHOLD);

        if (workersOnline && queueHealthy) {
          const decision = await shouldEnqueueExternalSearch(normalizedKey, checkSourceQueue);

          if (decision.shouldEnqueue) {
            const jobId = normalizedKey;
            await checkSourceQueue.add(
              'check-source',
              {
                query: searchQuery,
                normalizedKey,
                intent,
                trigger: 'user_search',
                userId,
                isPremium,
              },
              {
                jobId,
                priority: isPremium ? SEARCH_PRIORITY.CRITICAL : SEARCH_PRIORITY.STANDARD,
                removeOnComplete: true,
              }
            );
            await markQueryEnqueued(normalizedKey);
            externalSearchTriggered = true;
          } else {
            const existingJob = await checkSourceQueue.getJob(normalizedKey);
            if (existingJob) {
              externalSearchTriggered = true;
            }
          }
        }
      }
    } catch (e) {
      console.error('[seriesSearch] External search trigger error:', e);
    }
  }

  return {
    results: trimmedResults,
    total: trimmedResults.length,
    hasMore,
    externalSearchTriggered,
  };
}

export async function searchSeriesSimple(
  searchQuery: string,
  limit: number = 24,
  offset: number = 0,
  safeBrowsingMode: 'sfw' | 'questionable' | 'nsfw' = 'sfw'
): Promise<SeriesSearchResult[]> {
  if (!searchQuery || searchQuery.trim().length === 0) {
    return [];
  }

  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.max(0, offset);

  const results = await prisma.$queryRawUnsafe<SeriesSearchResult[]>(
    SERIES_SEARCH_QUERY,
    searchQuery,
    safeLimit,
    safeOffset,
    safeBrowsingMode
  );

  return results;
}
