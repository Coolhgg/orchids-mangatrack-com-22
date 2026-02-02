/**
 * I. SEARCH, BROWSE & DISCOVERY (Bugs 141-160)
 * 
 * Comprehensive fixes for search and browse functionality.
 */

// Bug 141: Fuzzy search degrades badly without trigram threshold
export interface SearchConfig {
  minTrigramSimilarity: number;
  maxResults: number;
  minQueryLength: number;
  useFullTextSearch: boolean;
}

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  minTrigramSimilarity: 0.3,
  maxResults: 50,
  minQueryLength: 2,
  useFullTextSearch: true
};

export function shouldUseFuzzySearch(query: string, config: SearchConfig = DEFAULT_SEARCH_CONFIG): boolean {
  return query.length >= config.minQueryLength && query.length <= 100;
}

// Bug 142: Search query not sanitized for pathological input
const PATHOLOGICAL_PATTERNS = [
  /(.)\1{10,}/g,
  /[%_]{5,}/g,
  /\s{10,}/g,
  /[^\p{L}\p{N}\s\-'"]/gu
];

export function sanitizeSearchQuery(query: string): { sanitized: string; wasModified: boolean } {
  let sanitized = query.trim();
  let wasModified = false;

  for (const pattern of PATHOLOGICAL_PATTERNS) {
    const before = sanitized;
    sanitized = sanitized.replace(pattern, ' ');
    if (before !== sanitized) wasModified = true;
  }

  sanitized = sanitized.replace(/\s+/g, ' ').trim();
  if (sanitized !== query.trim()) wasModified = true;

  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200);
    wasModified = true;
  }

  return { sanitized, wasModified };
}

// Bug 143: Empty-string search can trigger full-table scan
export function validateSearchQuery(query: string): { valid: boolean; error: string | null } {
  if (!query || query.trim().length === 0) {
    return { valid: false, error: 'Search query cannot be empty' };
  }

  if (query.trim().length < 2) {
    return { valid: false, error: 'Search query must be at least 2 characters' };
  }

  if (query.length > 200) {
    return { valid: false, error: 'Search query too long' };
  }

  return { valid: true, error: null };
}

// Bug 144: Search pagination unstable under concurrent writes
export interface StableCursor {
  sortValue: string | number;
  id: string;
  direction: 'forward' | 'backward';
}

export function createSearchCursor(
  item: { id: string; relevance?: number; created_at?: Date }
): string {
  const sortValue = item.relevance ?? item.created_at?.getTime() ?? 0;
  return Buffer.from(`${sortValue}:${item.id}`).toString('base64url');
}

export function parseSearchCursor(cursor: string): StableCursor | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf-8');
    const [sortStr, id] = decoded.split(':');
    if (!sortStr || !id) return null;

    const sortValue = parseFloat(sortStr);
    return { sortValue: isNaN(sortValue) ? sortStr : sortValue, id, direction: 'forward' };
  } catch {
    return null;
  }
}

// Bug 145: Browse filters not mutually exclusive-safe
export interface BrowseFilters {
  status?: string[];
  type?: string[];
  genres?: string[];
  excludeGenres?: string[];
  contentRating?: string[];
  year?: { min?: number; max?: number };
}

export function validateBrowseFilters(filters: BrowseFilters): { valid: boolean; conflicts: string[] } {
  const conflicts: string[] = [];

  if (filters.genres && filters.excludeGenres) {
    const overlap = filters.genres.filter(g => filters.excludeGenres?.includes(g));
    if (overlap.length > 0) {
      conflicts.push(`Cannot include and exclude same genres: ${overlap.join(', ')}`);
    }
  }

  if (filters.year?.min && filters.year?.max && filters.year.min > filters.year.max) {
    conflicts.push('Year min cannot be greater than max');
  }

  return { valid: conflicts.length === 0, conflicts };
}

// Bug 146: Genre inclusion logic fails on empty arrays
export function applyGenreFilter(
  seriesGenres: string[],
  includeGenres: string[] | undefined,
  excludeGenres: string[] | undefined
): boolean {
  if (excludeGenres && excludeGenres.length > 0) {
    for (const exclude of excludeGenres) {
      if (seriesGenres.includes(exclude)) return false;
    }
  }

  if (!includeGenres || includeGenres.length === 0) return true;

  for (const include of includeGenres) {
    if (seriesGenres.includes(include)) return true;
  }

  return false;
}

// Bug 147: Genre exclusion logic not indexed
export function buildGenreFilterQuery(
  includeGenres?: string[],
  excludeGenres?: string[]
): string {
  const conditions: string[] = [];

  if (includeGenres && includeGenres.length > 0) {
    const genreList = includeGenres.map(g => `'${g}'`).join(', ');
    conditions.push(`genres && ARRAY[${genreList}]::varchar[]`);
  }

  if (excludeGenres && excludeGenres.length > 0) {
    const excludeList = excludeGenres.map(g => `'${g}'`).join(', ');
    conditions.push(`NOT (genres && ARRAY[${excludeList}]::varchar[])`);
  }

  return conditions.length > 0 ? conditions.join(' AND ') : '1=1';
}

// Bug 148: Source filter mismatches series-source join
export function buildSourceFilterQuery(sourceName: string): string {
  return `
    EXISTS (
      SELECT 1 FROM series_sources ss 
      WHERE ss.series_id = series.id 
      AND ss.source_name = '${sourceName}'
      AND ss.source_status = 'active'
    )
  `;
}

// Bug 149: Trending stats can lag indefinitely
export interface TrendingStats {
  seriesId: string;
  weeklyReaders: number;
  monthlyReaders: number;
  trendingRank: number | null;
  lastCalculatedAt: Date;
  isStale: boolean;
}

export function isTrendingStatsStale(lastCalculated: Date, maxAgeHours: number = 6): boolean {
  const ageMs = Date.now() - lastCalculated.getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

// Bug 150: Trending rank ties not deterministically ordered
export interface TrendingSortKey {
  trendingRank: number;
  weeklyReaders: number;
  id: string;
}

export function compareTrendingRanks(a: TrendingSortKey, b: TrendingSortKey): number {
  if (a.trendingRank !== b.trendingRank) {
    return a.trendingRank - b.trendingRank;
  }

  if (a.weeklyReaders !== b.weeklyReaders) {
    return b.weeklyReaders - a.weeklyReaders;
  }

  return a.id.localeCompare(b.id);
}

export function buildTrendingOrderByClause(): string {
  return 'ORDER BY trending_rank ASC NULLS LAST, weekly_readers DESC, id ASC';
}

// Bug 151: Browse results mix resolved and unresolved metadata
export type MetadataQuality = 'canonical' | 'inferred' | 'missing';

export function categorizeMetadataQuality(
  series: { metadata_source: string; title: string; cover_url: string | null }
): MetadataQuality {
  if (series.metadata_source === 'CANONICAL') return 'canonical';
  if (series.metadata_source === 'USER_OVERRIDE') return 'canonical';
  if (series.title && series.cover_url) return 'inferred';
  return 'missing';
}

// Bug 152: Browse cache invalidation incomplete
export interface BrowseCacheKey {
  filters: string;
  sort: string;
  page: number;
}

export function generateBrowseCacheKey(filters: BrowseFilters, sort: string, page: number): string {
  const filterStr = JSON.stringify(filters, Object.keys(filters).sort());
  return `browse:${Buffer.from(filterStr).toString('base64url')}:${sort}:${page}`;
}

export function getCacheInvalidationPatterns(seriesId: string): string[] {
  return [
    'browse:*',
    `series:${seriesId}:*`,
    'trending:*'
  ];
}

// Bug 153: Search results not deduped across sources
export interface DedupedSearchResult {
  seriesId: string;
  bestMatch: { title: string; relevance: number; source: string };
  allMatches: { title: string; relevance: number; source: string }[];
}

export function dedupeSearchResults(
  results: { seriesId: string; title: string; relevance: number; source: string }[]
): DedupedSearchResult[] {
  const grouped = new Map<string, DedupedSearchResult>();

  for (const result of results) {
    const existing = grouped.get(result.seriesId);

    if (!existing) {
      grouped.set(result.seriesId, {
        seriesId: result.seriesId,
        bestMatch: { title: result.title, relevance: result.relevance, source: result.source },
        allMatches: [{ title: result.title, relevance: result.relevance, source: result.source }]
      });
    } else {
      existing.allMatches.push({ title: result.title, relevance: result.relevance, source: result.source });
      if (result.relevance > existing.bestMatch.relevance) {
        existing.bestMatch = { title: result.title, relevance: result.relevance, source: result.source };
      }
    }
  }

  return Array.from(grouped.values());
}

// Bug 154: Search ranking ignores source confidence
export interface RankedSearchResult {
  seriesId: string;
  title: string;
  textRelevance: number;
  sourceConfidence: number;
  metadataQuality: number;
  combinedScore: number;
}

export function calculateCombinedSearchScore(
  textRelevance: number,
  sourceConfidence: number,
  metadataQuality: MetadataQuality
): number {
  const qualityScore = metadataQuality === 'canonical' ? 1.0 :
    metadataQuality === 'inferred' ? 0.7 : 0.3;

  return (textRelevance * 0.6) + (sourceConfidence * 0.2) + (qualityScore * 0.2);
}

// Bug 155: Browse endpoints vulnerable to heavy query abuse
export const BROWSE_LIMITS = {
  maxFilters: 10,
  maxGenres: 20,
  maxPage: 100,
  maxPageSize: 50,
  maxConcurrentQueries: 5
};

export function validateBrowseRequest(
  filters: BrowseFilters,
  page: number,
  pageSize: number
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (page > BROWSE_LIMITS.maxPage) {
    errors.push(`Page cannot exceed ${BROWSE_LIMITS.maxPage}`);
  }

  if (pageSize > BROWSE_LIMITS.maxPageSize) {
    errors.push(`Page size cannot exceed ${BROWSE_LIMITS.maxPageSize}`);
  }

  if (filters.genres && filters.genres.length > BROWSE_LIMITS.maxGenres) {
    errors.push(`Cannot filter by more than ${BROWSE_LIMITS.maxGenres} genres`);
  }

  const filterCount = Object.keys(filters).filter(k => 
    filters[k as keyof BrowseFilters] !== undefined
  ).length;

  if (filterCount > BROWSE_LIMITS.maxFilters) {
    errors.push(`Cannot apply more than ${BROWSE_LIMITS.maxFilters} filters`);
  }

  return { valid: errors.length === 0, errors };
}

// Bug 156: No max filter complexity guard
export function estimateQueryComplexity(filters: BrowseFilters): number {
  let complexity = 1;

  if (filters.genres?.length) complexity += filters.genres.length * 2;
  if (filters.excludeGenres?.length) complexity += filters.excludeGenres.length * 3;
  if (filters.status?.length) complexity += filters.status.length;
  if (filters.type?.length) complexity += filters.type.length;
  if (filters.year) complexity += 2;
  if (filters.contentRating?.length) complexity += filters.contentRating.length;

  return complexity;
}

export function isQueryTooComplex(filters: BrowseFilters, maxComplexity: number = 50): boolean {
  return estimateQueryComplexity(filters) > maxComplexity;
}

// Bug 157: Search results inconsistent between requests
export interface ConsistentSearchParams {
  query: string;
  queryHash: string;
  timestamp: number;
  seed: number;
}

export function createConsistentSearchParams(query: string): ConsistentSearchParams {
  const hash = Buffer.from(query.toLowerCase().trim()).toString('base64url');
  return {
    query,
    queryHash: hash,
    timestamp: Date.now(),
    seed: Math.floor(Date.now() / 60000)
  };
}

// Bug 158: Browse joins can explode row counts
export function buildOptimizedBrowseQuery(
  hasSourceFilter: boolean,
  hasGenreFilter: boolean
): string {
  let query = 'SELECT s.* FROM series s';

  if (hasSourceFilter) {
    query += `
      WHERE EXISTS (
        SELECT 1 FROM series_sources ss 
        WHERE ss.series_id = s.id
        AND ss.source_status = 'active'
        LIMIT 1
      )
    `;
  }

  if (hasGenreFilter) {
    query = query.includes('WHERE') 
      ? query + ' AND s.genres IS NOT NULL'
      : query + ' WHERE s.genres IS NOT NULL';
  }

  return query;
}

// Bug 159: Search query planner can switch to seq scan
export const SEARCH_INDEX_HINTS = {
  titleSearch: 'SET enable_seqscan = off; SET enable_indexscan = on;',
  genreFilter: 'SET enable_bitmapscan = on;',
  resetDefaults: 'RESET enable_seqscan; RESET enable_indexscan; RESET enable_bitmapscan;'
};

// Bug 160: No protection against search amplification attacks
export interface SearchRateLimit {
  userId: string | null;
  ip: string;
  queriesInWindow: number;
  windowStart: Date;
  isBlocked: boolean;
}

const searchRateLimits = new Map<string, SearchRateLimit>();

export function checkSearchRateLimit(
  userId: string | null,
  ip: string,
  maxQueriesPerMinute: number = 30
): { allowed: boolean; remaining: number; retryAfterMs: number } {
  const key = userId || ip;
  const now = Date.now();
  const windowMs = 60000;

  let limit = searchRateLimits.get(key);

  if (!limit || now - limit.windowStart.getTime() > windowMs) {
    limit = {
      userId,
      ip,
      queriesInWindow: 0,
      windowStart: new Date(now),
      isBlocked: false
    };
    searchRateLimits.set(key, limit);
  }

  if (limit.queriesInWindow >= maxQueriesPerMinute) {
    const retryAfter = windowMs - (now - limit.windowStart.getTime());
    return { allowed: false, remaining: 0, retryAfterMs: retryAfter };
  }

  limit.queriesInWindow++;
  return {
    allowed: true,
    remaining: maxQueriesPerMinute - limit.queriesInWindow,
    retryAfterMs: 0
  };
}
