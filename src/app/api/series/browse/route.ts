import { supabaseAdminRead } from "@/lib/supabase/admin"
import { prisma } from "@/lib/prisma"
import { PRODUCTION_QUERIES } from "@/lib/sql/production-queries"
import { NextRequest, NextResponse } from "next/server"
import { 
  getRateLimitInfo, 
  handleApiError, 
  sanitizeInput,
  escapeILikePattern,
  sanitizeFilterArray,
  normalizeToTitleCase,
  normalizeToLowercase,
  getClientIp,
  ErrorCodes
} from "@/lib/api-utils"
import { getBestCoversBatch, isValidCoverUrl } from "@/lib/cover-resolver"
import { FILTER_PARAMS, DEPRECATED_PARAMS, getChapterCountRange, getReleaseDateRange } from "@/lib/constants/filters"
import {
  decodeCursor,
  createCursor,
  getSortConfig,
  validateCursorSort,
  type CursorData,
  type PaginationConfig
} from "@/lib/cursor-pagination"

const VALID_SORT_VALUES = new Set([
  'newest', 'oldest', 'score', 'rating', 'score_asc',
  'popularity', 'popular', 'popularity_asc',
  'updated', 'latest_chapter', 'follows', 'views'
])

const VALID_STATUS_VALUES = new Set([
  'all', 'releasing', 'finished', 'ongoing', 'completed', 'hiatus', 'cancelled'
])

const VALID_CONTENT_RATINGS = new Set([
  'all', 'safe', 'suggestive', 'erotica'
])

const VALID_TYPES = new Set([
  'manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'novel', 'light_novel', 'all'
])

const VALID_SOURCES = new Set([
  'all', 'mangadex', 'mangapark', 'mangasee', 'multiple'
])

const VALID_PERIODS = new Set([
  'all', 'this_month', 'last_month', 'this_year', 'custom'
])

const VALID_CHAPTER_COUNTS = new Set([
  '0', '1+', '10+', '20+', '30+', '50+', '100+', '200+'
])

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
  catalog_tier,
  activity_score,
  last_chapter_date,
  created_at,
  updated_at
`

const STATUS_MAP: Record<string, string[]> = {
  releasing: ['ongoing', 'releasing'],
  finished: ['completed', 'finished'],
  ongoing: ['ongoing', 'releasing'],
  completed: ['completed', 'finished'],
  hiatus: ['hiatus', 'on hiatus'],
  cancelled: ['cancelled', 'discontinued'],
}

function getParam(
  searchParams: URLSearchParams,
  canonicalKey: keyof typeof FILTER_PARAMS
): string | null {
  const P = FILTER_PARAMS
  const canonicalName = P[canonicalKey]
  
  const canonicalValue = searchParams.get(canonicalName)
  if (canonicalValue !== null) {
    return canonicalValue
  }
  
  for (const [deprecated, canonical] of Object.entries(DEPRECATED_PARAMS)) {
    if (canonical === canonicalKey) {
      const deprecatedValue = searchParams.get(deprecated)
      if (deprecatedValue !== null) {
        return deprecatedValue
      }
    }
  }
  
  return null
}

interface BrowseFilters {
  q: string | null
  types: string[]
  genres: string[]
  themes: string[]
  includeWarnings: string[]
  excludeWarnings: string[]
  status: string | null
  contentRating: string | null
  period: string | null
  dateFrom: Date | null
  dateTo: Date | null
  chapters: number | null
  originalLanguage: string | null
  translatedLanguage: string | null
}

async function searchSeriesIds(searchQuery: string, safeBrowsingMode: string = 'sfw', genres: string[] = []): Promise<Set<string>> {
  const escapedQuery = escapeILikePattern(searchQuery);
  const data = await prisma.$queryRawUnsafe<{ id: string }[]>(
    PRODUCTION_QUERIES.SERIES_DISCOVERY,
    escapedQuery,
    genres.length > 0 ? genres : null,
    safeBrowsingMode,
    1000 // Limit for pre-filtering
  );
  
  return new Set((data || []).map(r => r.id));
}

function applyBaseFilters(query: any, filters: BrowseFilters, hasSearchQuery: boolean, source: string | null) {
  const { types, genres, themes, includeWarnings, excludeWarnings, status, contentRating, chapters, period, dateFrom, dateTo, originalLanguage, translatedLanguage } = filters

  // CRITICAL: Always exclude pornographic content (platform policy)
  query = query.neq('content_rating', 'pornographic')

  // Tier filtering removed: always include A, B, C

  if (types.length > 0) {
    query = query.in('type', types)
  }

  if (genres.length > 0) {
    query = query.contains('genres', genres)
  }

  if (themes.length > 0) {
    query = query.or(`tags.cs.{${themes.join(',')}},themes.cs.{${themes.join(',')}}`)
  }

  if (includeWarnings.length > 0) {
    query = query.contains('tags', includeWarnings)
  }

  if (excludeWarnings.length > 0) {
    query = query.not('tags', 'ov', `{${excludeWarnings.join(',')}}`)
  }

  if (status && status !== 'all') {
    const statusValues = STATUS_MAP[status] || [status]
    query = query.in('status', statusValues)
  }

  if (contentRating && contentRating !== 'all') {
    query = query.eq('content_rating', contentRating)
  }

  if (chapters !== null && chapters > 0) {
    query = query.gte('chapter_count', chapters)
  }

  if (period && period !== 'all' && dateFrom && dateTo) {
    query = query.gte('last_chapter_date', dateFrom.toISOString())
    query = query.lte('last_chapter_date', dateTo.toISOString())
  }

  if (originalLanguage && originalLanguage !== 'all') {
    query = query.eq('original_language', originalLanguage)
  }

  if (translatedLanguage && translatedLanguage !== 'all') {
    query = query.contains('translated_languages', [translatedLanguage])
  }

  return query
}

function applyCursorCondition(query: any, cursor: CursorData, sortConfig: PaginationConfig) {
  const { sortColumn } = sortConfig
  const { v: cursorValue, i: cursorId, d: direction } = cursor
  const isDescending = direction === 'desc'

  if (cursorValue === null) {
    // Already in NULL section, only get items with NULL and larger ID (since we sort id ASC)
    query = query.and(`${sortColumn}.is.null,id.gt.${cursorId}`)
  } else {
    const escapedValue = typeof cursorValue === 'string' 
      ? cursorValue.replace(/,/g, '\\,').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
      : cursorValue
    
    if (isDescending) {
      // DESC: (col < val) OR (col = val AND id > cursorId) OR (col IS NULL)
      query = query.or(
        `${sortColumn}.lt.${escapedValue},` +
        `and(${sortColumn}.eq.${escapedValue},id.gt.${cursorId}),` +
        `${sortColumn}.is.null`
      )
    } else {
      // ASC: (col > val) OR (col = val AND id > cursorId)
      // Note: NULLs are not included here as they come first in ASC NULLS FIRST and we are past them
      query = query.or(
        `${sortColumn}.gt.${escapedValue},` +
        `and(${sortColumn}.eq.${escapedValue},id.gt.${cursorId})`
      )
    }
  }

  return query
}

async function getSeriesIdsWithChapterCount(minChapters: number): Promise<Set<string>> {
  const { data, error } = await supabaseAdminRead
    .from('series_sources')
    .select('series_id, source_chapter_count')
  
  if (error || !data) return new Set()
  
  const maxCounts = new Map<string, number>()
  for (const row of data) {
    const current = maxCounts.get(row.series_id) || 0
    maxCounts.set(row.series_id, Math.max(current, row.source_chapter_count || 0))
  }
  
  return new Set(
    [...maxCounts.entries()]
      .filter(([_, count]) => count >= minChapters)
      .map(([id]) => id)
  )
}

async function getSeriesIdsWithReleasePeriod(from: Date, to: Date): Promise<Set<string>> {
  const { data, error } = await supabaseAdminRead
    .from('chapters')
    .select('series_source_id')
    .gte('published_at', from.toISOString())
    .lte('published_at', to.toISOString())
    .not('published_at', 'is', null)
    .limit(10000)
  
  if (error || !data || data.length === 0) return new Set()
  
  const sourceIds = [...new Set(data.map(c => c.series_source_id).filter(Boolean))]
  
  if (sourceIds.length === 0) return new Set()
  
  const seriesIds = new Set<string>()
  const CHUNK_SIZE = 100
  
  for (let i = 0; i < sourceIds.length; i += CHUNK_SIZE) {
    const chunk = sourceIds.slice(i, i + CHUNK_SIZE)
    const { data: sources, error: sourcesError } = await supabaseAdminRead
      .from('series_sources')
      .select('series_id')
      .in('id', chunk)
    
    if (!sourcesError && sources) {
      sources.forEach(s => seriesIds.add(s.series_id))
    }
  }
  
  return seriesIds
}

async function getSeriesIdsWithMultipleSources(): Promise<Set<string>> {
  const data = await prisma.$queryRawUnsafe<{ series_id: string }[]>(
    PRODUCTION_QUERIES.MULTIPLE_SOURCES
  );
  
  return new Set((data || []).map(r => r.series_id));
}

function buildSeriesQuery(
  baseFilters: BrowseFilters,
  sortConfig: PaginationConfig,
  limit: number,
  source: string | null,
  cursor: CursorData | null,
  preFilteredIds: string[] | null,
  hasSearchQuery: boolean
) {
  const { sortColumn, ascending, nullsFirst } = sortConfig

  let selectFields = SERIES_SELECT_FIELDS
  
  if (source && source !== 'all' && source !== 'multiple') {
    selectFields = `${SERIES_SELECT_FIELDS}, series_sources!inner(source_name)`
  }

  let query = supabaseAdminRead
    .from('series')
    .select(selectFields, { count: 'exact' })
    .is('deleted_at', null)

  if (preFilteredIds !== null) {
    if (preFilteredIds.length === 0) {
      query = query.in('id', ['00000000-0000-0000-0000-000000000000'])
    } else {
      query = query.in('id', preFilteredIds)
    }
  }

  if (source && source !== 'all' && source !== 'multiple') {
    query = query.eq('series_sources.source_name', source)
  }

  query = applyBaseFilters(query, baseFilters, hasSearchQuery, source)

  if (cursor) {
    query = applyCursorCondition(query, cursor, sortConfig)
  }

  query = query
    .order(sortColumn, { ascending, nullsFirst })
    .order('id', { ascending: true })
    .limit(limit)

  return query
}

function stripSourcesFromResults(data: any[]): any[] {
  return data.map(item => {
    const { series_sources, ...rest } = item
    return rest
  })
}

interface SeriesRow {
  id: string
  title: string
  alternative_titles: any
  description: string | null
  cover_url: string | null
  type: string
  status: string | null
  genres: string[]
  tags: string[]
  content_rating: string | null
  total_follows: number
  total_views: number
  average_rating: number | null
  created_at: string
  updated_at: string
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request)
  const rateLimitInfo = await getRateLimitInfo(`browse:${ip}`, 100, 60000)
  
  if (!rateLimitInfo.allowed) {
    const retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000)
    return NextResponse.json(
      { error: 'Too many requests', code: ErrorCodes.RATE_LIMITED },
      { 
        status: 429,
        headers: { 'Retry-After': retryAfter.toString() }
      }
    )
  }

  const { searchParams } = new URL(request.url)
  const P = FILTER_PARAMS
  
  // Parse query param
    const rawQuery = getParam(searchParams, 'query')
    const q = rawQuery ? sanitizeInput(rawQuery, 200) : null
    const hasSearchQuery = !!(q && q.length >= 2)
    
    // Parse sort param - default to 'popularity' if search query exists, 'latest_chapter' otherwise
    const rawSort = getParam(searchParams, 'sort')
    const defaultSort = hasSearchQuery ? 'popularity' : 'latest_chapter'
    const sort = rawSort && VALID_SORT_VALUES.has(rawSort) ? rawSort : defaultSort
  
  // Parse limit param
  const limit = Math.min(Math.max(1, parseInt(searchParams.get(P.limit) || '24')), 100)
  
  // Parse cursor param
  const cursorParam = getParam(searchParams, 'cursor')
  let cursor: CursorData | null = null
  
  if (cursorParam) {
    cursor = decodeCursor(cursorParam)
    if (cursor && !validateCursorSort(cursor, sort)) {
      cursor = null
    }
  }
  
  // Parse types param: s.type = ANY($1::varchar[])
  const rawTypes = sanitizeFilterArray(getParam(searchParams, 'types')?.split(',') || [], 10)
  const types = normalizeToLowercase(rawTypes).filter(t => VALID_TYPES.has(t) && t !== 'all')
  
  // Parse genres param: s.genres @> $1::varchar[]
  const rawGenres = sanitizeFilterArray(searchParams.get(P.genres)?.split(',') || [], 20)
  const genres = normalizeToTitleCase(rawGenres)
  
  // Parse themes param: s.tags @> $1::varchar[]
  const rawThemes = sanitizeFilterArray(getParam(searchParams, 'themes')?.split(',') || [], 20)
  const themes = normalizeToTitleCase(rawThemes)
  
  // Parse includeWarnings param: s.tags @> $1::varchar[]
  const rawIncludeWarnings = sanitizeFilterArray(getParam(searchParams, 'includeWarnings')?.split(',') || [], 20)
  const includeWarnings = normalizeToTitleCase(rawIncludeWarnings)
  
  // Parse excludeWarnings param: NOT (s.tags && $1::varchar[])
  const rawExcludeWarnings = sanitizeFilterArray(getParam(searchParams, 'excludeWarnings')?.split(',') || [], 20)
  const excludeWarnings = normalizeToTitleCase(rawExcludeWarnings)
  
  // Parse status param: s.status = ANY($1::varchar[])
  const rawStatus = getParam(searchParams, 'status')
  const status = rawStatus && VALID_STATUS_VALUES.has(rawStatus.toLowerCase()) ? rawStatus.toLowerCase() : null
  
  // Parse content rating param: s.content_rating = $1
  const rawContentRating = getParam(searchParams, 'rating')
  const contentRating = rawContentRating && VALID_CONTENT_RATINGS.has(rawContentRating.toLowerCase()) ? rawContentRating.toLowerCase() : null
  
  // Parse source param
  const rawSource = getParam(searchParams, 'source')
  const source = rawSource && VALID_SOURCES.has(rawSource.toLowerCase()) ? rawSource.toLowerCase() : null
  
  // Parse period param (release period)
  const rawPeriod = getParam(searchParams, 'period')
  const period = rawPeriod && VALID_PERIODS.has(rawPeriod.toLowerCase()) ? rawPeriod.toLowerCase() : null
  
  // Parse date range params
  const dateFrom = getParam(searchParams, 'dateFrom')
  const dateTo = getParam(searchParams, 'dateTo')
  
    // Parse chapter count param
    const rawChapters = getParam(searchParams, 'chapters')
    const chapters = rawChapters && VALID_CHAPTER_COUNTS.has(rawChapters) ? rawChapters : null
    const chaptersMin = chapters ? getChapterCountRange(chapters).min : null
    
    // Parse original language param
    const rawOrigLang = getParam(searchParams, 'origLang')
    const originalLanguage = rawOrigLang && rawOrigLang !== 'all' ? rawOrigLang.toLowerCase() : null
    
    // Parse translated language param
    const rawTransLang = getParam(searchParams, 'transLang')
    const translatedLanguage = rawTransLang && rawTransLang !== 'all' ? rawTransLang.toLowerCase() : null

    try {
      const sortConfig = getSortConfig(sort)

      // Parse date range if period is specified
      let parsedDateFrom: Date | null = null
      let parsedDateTo: Date | null = null
      if (period && period !== 'all') {
        const { from, to } = getReleaseDateRange(period, dateFrom, dateTo)
        parsedDateFrom = from
        parsedDateTo = to
      }

      const baseFilters: BrowseFilters = {
        q,
        types,
        genres,
        themes,
        includeWarnings,
        excludeWarnings,
        status,
        contentRating,
        period,
        dateFrom: parsedDateFrom,
        dateTo: parsedDateTo,
        chapters: chaptersMin,
        originalLanguage,
        translatedLanguage
      }

    let data: SeriesRow[] = []
      let count: number | null = null
      let preFilteredIds: string[] | null = null

      // Parallel pre-filtering
      const preFilterPromises: Promise<Set<string>>[] = []
      
      if (hasSearchQuery) {
        const safeMode = contentRating === 'safe' ? 'sfw' : (contentRating === 'suggestive' ? 'questionable' : 'nsfw')
        preFilterPromises.push(searchSeriesIds(q!, safeMode, genres))
      }
      
      if (source === 'multiple') {
        preFilterPromises.push(getSeriesIdsWithMultipleSources())
      }
      
      if (preFilterPromises.length > 0) {
        const preFilterResults = await Promise.all(preFilterPromises)
        
        // Intersect all pre-filtered sets
        let intersection: Set<string> | null = null
        for (const resultSet of preFilterResults) {
          if (intersection === null) {
            intersection = resultSet
          } else {
            const newIntersection = new Set<string>()
            for (const id of resultSet) {
              if (intersection.has(id)) {
                newIntersection.add(id)
              }
            }
            intersection = newIntersection
          }
        }
        
        preFilteredIds = intersection ? [...intersection] : []
      }

      // NOTE: Chapter count and release period filters are now handled directly via SQL
      // Using s.chapter_count and s.last_chapter_date columns in applyBaseFilters

      const query = buildSeriesQuery(baseFilters, sortConfig, limit + 1, source, cursor, preFilteredIds, hasSearchQuery)
    const result = await query
    if (result.error) throw result.error
    data = (result.data as unknown as SeriesRow[]) || []
    count = result.count
    
    if (source && source !== 'all' && source !== 'multiple') {
      data = stripSourcesFromResults(data) as SeriesRow[]
    }

    const hasMore = data.length > limit
    if (hasMore) {
      data = data.slice(0, limit)
    }

    let nextCursor: string | null = null
    if (hasMore && data.length > 0) {
      const lastItem = data[data.length - 1]
      nextCursor = createCursor(lastItem, sortConfig)
    }

    const seriesIds = data.map(s => s.id)
    const bestCovers = await getBestCoversBatch(seriesIds)

    const results = data.map(s => {
      const bestCover = bestCovers.get(s.id)
      const fallbackCover = isValidCoverUrl(s.cover_url) ? s.cover_url : null
      return {
        ...s,
        cover_url: bestCover?.cover_url || fallbackCover,
        genres: s.genres || [],
        themes: s.tags || []
      }
    })

    const uniqueResults = Array.from(new Map(results.map(s => [s.id, s])).values());

    return NextResponse.json({
      status: 'complete',
      results: uniqueResults,
        ...(count !== null && { total: count }),
        has_more: hasMore,
        next_cursor: nextCursor,
        filters_applied: {
          types,
          genres,
          themes,
          includeWarnings,
          excludeWarnings,
          status,
          rating: contentRating,
          source,
          period,
          dateFrom,
          dateTo,
          chapters,
          chaptersMin,
          originalLanguage,
          translatedLanguage,
          sort
        }
      })

  } catch (error: any) {
    console.error('Browse API Error:', error)
    return handleApiError(error)
  }
}
