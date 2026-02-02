import { CanonicalFilter } from '../schemas/filters';
import { 
  escapeILikePattern, 
  normalizeToTitleCase, 
  normalizeToLowercase 
} from '../api-utils';
import { 
  CursorData, 
  PaginationConfig, 
  encodeCursor as encodeCursorBase,
  decodeCursor as decodeCursorBase,
  getSortConfig as getSortConfigBase,
  buildSupabaseCursorFilter
} from '../cursor-pagination';

// Re-export for backwards compatibility
export { getSortConfig, decodeCursor } from '../cursor-pagination';

// Valid source values (lowercase in DB)
const VALID_SOURCES = new Set([
  'mangadex'
]);

// Base SELECT fields for series
const SERIES_SELECT_FIELDS = `
  id,
  title,
  alternative_titles,
  description,
  cover_url,
  type,
  status,
  genres,
  tags,
  content_rating,
  total_follows,
  total_views,
  average_rating,
  updated_at,
  created_at,
  chapter_count,
  content_warnings,
  original_language,
  translated_languages,
    first_chapter_date,
    last_chapter_date,
    catalog_tier,
    activity_score,
    import_status
  `;


export function getSortColumn(sortBy: string): string {
  const config = getSortConfigBase(sortBy);
  return config.sortColumn;
}

/**
 * Create cursor from last item - uses unified cursor format
 */
export function createSearchCursor(
  item: Record<string, any>,
  sortBy: string
): string {
  const config = getSortConfigBase(sortBy);
  const cursorData: CursorData = {
    s: config.sortColumn,
    d: config.ascending ? 'asc' : 'desc',
    v: item[config.sortColumn] ?? null,
    i: item.id
  };
  return encodeCursorBase(cursorData);
}

// Legacy encodeCursor - now uses unified format
export function encodeCursor(value: any, id: string, sortBy: string = 'newest'): string {
  const config = getSortConfigBase(sortBy);
  const cursorData: CursorData = {
    s: config.sortColumn,
    d: config.ascending ? 'asc' : 'desc',
    v: value ?? null,
    i: id
  };
  return encodeCursorBase(cursorData);
}

/**
 * Escapes a value for use in Supabase filter strings
 * Prevents injection in .or() and similar string-based filters
 */
function escapeFilterValue(value: string): string {
  if (!value || typeof value !== 'string') return '';
  
  // Remove any characters that could break out of the filter context
  return value
    .replace(/[\\'"`,()[\]{}]/g, '') // Remove quotes, backslashes, commas, parens, brackets
    .replace(/\s+/g, ' ')            // Normalize whitespace
    .trim()
    .slice(0, 200);                  // Limit length
}

/**
 * Validates a date string is in ISO format
 */
function isValidISODate(dateStr: string): boolean {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/;
  if (!isoDateRegex.test(dateStr)) return false;
  
  // Also verify it's a valid date
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

/**
 * Get series IDs that have multiple sources (2+)
 * Used for source='multiple' filter
 */
export async function getSeriesIdsWithMultipleSources(
  supabase: any
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('series_sources')
    .select('series_id');
  
  if (error) {
    console.error('[Search] Error fetching series sources:', error);
    return new Set();
  }

  // Count occurrences per series_id
  const counts = new Map<string, number>();
  for (const row of data || []) {
    counts.set(row.series_id, (counts.get(row.series_id) || 0) + 1);
  }

  // Return series with 2+ sources
  const result = new Set<string>();
  for (const [seriesId, count] of counts) {
    if (count >= 2) {
      result.add(seriesId);
    }
  }
  
  return result;
}

/**
 * Strip nested series_sources from results (we don't need it in output)
 */
export function stripSourcesFromResults(data: any[]): any[] {
  return data.map(item => {
    const { series_sources, ...rest } = item;
    return rest;
  });
}

/**
 * Build series query with all filters including source filtering via inner join
 * 
 * @param supabase - Supabase client
 * @param filters - Canonical filter object
 * @param source - Source filter value (e.g., 'mangadex', 'multiple', null)
 * @param multipleSourceIds - Pre-fetched series IDs for 'multiple' filter (optional)
 */
export function buildSeriesQuery(
  supabase: any,
  filters: CanonicalFilter,
  source?: string | null,
  multipleSourceIds?: Set<string> | null
) {
  // Build SELECT with optional source join
  let selectFields = SERIES_SELECT_FIELDS;
  
  // For source filter (except 'multiple'), use inner join with series_sources
  if (source && source !== 'all' && source !== 'multiple' && VALID_SOURCES.has(source)) {
    selectFields = `${SERIES_SELECT_FIELDS}, series_sources!inner(source_name)`;
  }

  let query = supabase
    .from('series')
    .select(selectFields, { count: 'exact' })
    .is('deleted_at', null)
    .neq('content_rating', 'pornographic'); // CRITICAL: Always exclude pornographic content (platform policy)

  // Apply source filter
  if (source && source !== 'all') {
    if (source === 'multiple' && multipleSourceIds !== undefined && multipleSourceIds !== null) {
      // For 'multiple' sources, use .in() with pre-fetched IDs
      if (multipleSourceIds.size === 0) {
        // No matching series - add impossible condition
        query = query.in('id', ['00000000-0000-0000-0000-000000000000']);
      } else {
        query = query.in('id', Array.from(multipleSourceIds));
      }
    } else if (source !== 'multiple' && VALID_SOURCES.has(source)) {
      // For specific sources, use inner join filter
      query = query.eq('series_sources.source_name', source);
    }
  }

  // 1. Text Search - SECURITY: Properly escape the search query
  if (filters.q && typeof filters.q === 'string' && filters.q.trim().length > 0) {
    const sanitizedQuery = escapeILikePattern(filters.q.trim().slice(0, 200).toLowerCase());
    query = query.or(`search_index.ilike.%${sanitizedQuery}%,description.ilike.%${sanitizedQuery}%`);
  }

  // 2. Exact Matches (Types, Rating, Status) - These use .in() which is safe
  if (Array.isArray(filters.type) && filters.type.length > 0) {
    const safeTypes = normalizeToLowercase(filters.type.map(t => escapeFilterValue(t))).slice(0, 20);
    if (safeTypes.length > 0) query = query.in('type', safeTypes);
  }
  if (Array.isArray(filters.contentRating) && filters.contentRating.length > 0) {
    const safeRatings = normalizeToLowercase(filters.contentRating.map(r => escapeFilterValue(r))).slice(0, 10);
    if (safeRatings.length > 0) query = query.in('content_rating', safeRatings);
  }
  if (Array.isArray(filters.publicationStatus) && filters.publicationStatus.length > 0) {
    const safeStatuses = normalizeToLowercase(filters.publicationStatus.map(s => escapeFilterValue(s))).slice(0, 10);
    if (safeStatuses.length > 0) query = query.in('status', safeStatuses);
  }
  if (filters.languages?.original && typeof filters.languages.original === 'string') {
    query = query.eq('original_language', escapeFilterValue(filters.languages.original));
  }

  // 3. Array Overlap/Contains (Genres, Tags, Themes, Translated Languages)
  const arrayOp = filters.mode === 'all' ? 'contains' : 'overlaps';
  
  if (Array.isArray(filters.genres) && filters.genres.length > 0) {
    const safeGenres = filters.genres.map(g => escapeFilterValue(g)).filter(Boolean).slice(0, 50);
    const normalizedGenres = normalizeToTitleCase(safeGenres);
    if (normalizedGenres.length > 0) query = query[arrayOp]('genres', normalizedGenres);
  }
  if (Array.isArray(filters.tags) && filters.tags.length > 0) {
    const safeTags = filters.tags.map(t => escapeFilterValue(t)).filter(Boolean).slice(0, 50);
    const normalizedTags = normalizeToTitleCase(safeTags);
    if (normalizedTags.length > 0) query = query[arrayOp]('tags', normalizedTags);
  }
  if (Array.isArray(filters.themes) && filters.themes.length > 0) {
    const safeThemes = filters.themes.map(t => escapeFilterValue(t)).filter(Boolean).slice(0, 50);
    const normalizedThemes = normalizeToTitleCase(safeThemes);
    if (normalizedThemes.length > 0) query = query[arrayOp]('tags', normalizedThemes);
  }
  if (filters.languages?.translated && Array.isArray(filters.languages.translated) && filters.languages.translated.length > 0) {
    const safeLangs = filters.languages.translated.map(l => escapeFilterValue(l)).filter(Boolean).slice(0, 20);
    if (safeLangs.length > 0) query = query.contains('translated_languages', safeLangs);
  }

  // 4. Content Warnings
  if (filters.contentWarnings?.include && Array.isArray(filters.contentWarnings.include) && filters.contentWarnings.include.length > 0) {
    const safeIncludes = filters.contentWarnings.include.map(w => escapeFilterValue(w)).filter(Boolean).slice(0, 20);
    const normalizedIncludes = normalizeToTitleCase(safeIncludes);
    if (normalizedIncludes.length > 0) query = query.contains('content_warnings', normalizedIncludes);
  }
  if (filters.contentWarnings?.exclude && Array.isArray(filters.contentWarnings.exclude) && filters.contentWarnings.exclude.length > 0) {
    const safeExcludes = filters.contentWarnings.exclude.map(w => escapeFilterValue(w)).filter(Boolean).slice(0, 20);
    const normalizedExcludes = normalizeToTitleCase(safeExcludes);
    if (normalizedExcludes.length > 0) {
      query = query.not('content_warnings', 'ov', `{${normalizedExcludes.join(',')}}`);
    }
  }

  // 5. Ranges (Chapters, Dates)
  if (filters.chapterCount?.min !== undefined) {
    const min = Number(filters.chapterCount.min);
    if (Number.isFinite(min) && min >= 0) {
      query = query.gte('chapter_count', Math.floor(min));
    }
  }
  if (filters.chapterCount?.max !== undefined) {
    const max = Number(filters.chapterCount.max);
    if (Number.isFinite(max) && max >= 0) {
      query = query.lte('chapter_count', Math.floor(max));
    }
  }
  
  if (filters.releasePeriod?.from && isValidISODate(filters.releasePeriod.from)) {
    query = query.gte('first_chapter_date', filters.releasePeriod.from);
  }
  if (filters.releasePeriod?.to && isValidISODate(filters.releasePeriod.to)) {
    query = query.lte('first_chapter_date', filters.releasePeriod.to);
  }

  // 6. Pagination & Sorting
  const sortConfig = getSortConfigBase(filters.sortBy);
  const { sortColumn, ascending } = sortConfig;

  // Apply cursor filter if present
  if (filters.cursor && typeof filters.cursor === 'string') {
    const cursor = decodeCursorBase(filters.cursor);
    
    if (cursor) {
      if (cursor.s === sortColumn && cursor.d === (ascending ? 'asc' : 'desc')) {
        const { applyFilter } = buildSupabaseCursorFilter(cursor, sortConfig);
        query = applyFilter(query);
      }
    }
  }

  // Enforce strict limit bounds - fetch limit+1 to determine has_more
  const safeLimit = Math.min(Math.max(1, Number(filters.limit) || 24), 100);

  query = query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(safeLimit + 1);

  return query;
}
