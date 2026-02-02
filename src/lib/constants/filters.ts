// =====================================================
// COMPREHENSIVE FILTER CONSTANTS
// Production-grade filter system inspired by mangatrack.comm and mangapark.io
// VALUES MUST MATCH DATABASE (MangaDex format)
// =====================================================

// A. TYPE (stored lowercase in DB)
export const SERIES_TYPES = [
  { value: 'all', label: 'All Types' },
  { value: 'manga', label: 'Manga' },
  { value: 'manhwa', label: 'Manhwa' },
  { value: 'manhua', label: 'Manhua' },
  { value: 'webtoon', label: 'Webtoon' },
  { value: 'novel', label: 'Novel' },
  { value: 'light_novel', label: 'Light Novel' },
  { value: 'other', label: 'Other' },
] as const

export type SeriesType = typeof SERIES_TYPES[number]['value']

// B. GENRES (stored as Title Case in DB - matches MangaDex)
// IMPORTANT: value must match exactly what MangaDex returns
export const GENRES = [
  { value: 'Action', label: 'Action' },
  { value: 'Adventure', label: 'Adventure' },
  { value: "Boys' Love", label: "Boys' Love" },
  { value: 'Comedy', label: 'Comedy' },
  { value: 'Crime', label: 'Crime' },
  { value: 'Drama', label: 'Drama' },
  { value: 'Fantasy', label: 'Fantasy' },
  { value: "Girls' Love", label: "Girls' Love" },
  { value: 'Historical', label: 'Historical' },
  { value: 'Horror', label: 'Horror' },
  { value: 'Isekai', label: 'Isekai' },
  { value: 'Magical Girls', label: 'Magical Girls' },
  { value: 'Mecha', label: 'Mecha' },
  { value: 'Medical', label: 'Medical' },
  { value: 'Mystery', label: 'Mystery' },
  { value: 'Philosophical', label: 'Philosophical' },
  { value: 'Psychological', label: 'Psychological' },
  { value: 'Romance', label: 'Romance' },
  { value: 'Sci-Fi', label: 'Sci-Fi' },
  { value: 'Slice of Life', label: 'Slice of Life' },
  { value: 'Sports', label: 'Sports' },
  { value: 'Superhero', label: 'Superhero' },
  { value: 'Thriller', label: 'Thriller' },
  { value: 'Tragedy', label: 'Tragedy' },
  { value: 'Wuxia', label: 'Wuxia' },
] as const

export type Genre = typeof GENRES[number]['value']

// C. THEMES / TAGS (stored as Title Case in DB - matches MangaDex)
// IMPORTANT: value must match exactly what MangaDex returns
export const THEMES = [
  { value: 'Aliens', label: 'Aliens' },
  { value: 'Animals', label: 'Animals' },
  { value: 'Cooking', label: 'Cooking' },
  { value: 'Crossdressing', label: 'Crossdressing' },
  { value: 'Delinquents', label: 'Delinquents' },
  { value: 'Demons', label: 'Demons' },
  { value: 'Genderswap', label: 'Genderswap' },
  { value: 'Ghosts', label: 'Ghosts' },
  { value: 'Gyaru', label: 'Gyaru' },
  { value: 'Harem', label: 'Harem' },
  { value: 'Incest', label: 'Incest' },
  { value: 'Loli', label: 'Loli' },
  { value: 'Mafia', label: 'Mafia' },
  { value: 'Magic', label: 'Magic' },
  { value: 'Martial Arts', label: 'Martial Arts' },
  { value: 'Military', label: 'Military' },
  { value: 'Monster Girls', label: 'Monster Girls' },
  { value: 'Monsters', label: 'Monsters' },
  { value: 'Music', label: 'Music' },
  { value: 'Ninja', label: 'Ninja' },
  { value: 'Office Workers', label: 'Office Workers' },
  { value: 'Police', label: 'Police' },
  { value: 'Post-Apocalyptic', label: 'Post-Apocalyptic' },
  { value: 'Reincarnation', label: 'Reincarnation' },
  { value: 'Reverse Harem', label: 'Reverse Harem' },
  { value: 'Samurai', label: 'Samurai' },
  { value: 'School Life', label: 'School Life' },
  { value: 'Shota', label: 'Shota' },
  { value: 'Supernatural', label: 'Supernatural' },
  { value: 'Survival', label: 'Survival' },
  { value: 'Time Travel', label: 'Time Travel' },
  { value: 'Traditional Games', label: 'Traditional Games' },
  { value: 'Video Games', label: 'Video Games' },
  { value: 'Villainess', label: 'Villainess' },
  { value: 'Virtual Reality', label: 'Virtual Reality' },
  { value: 'Zombies', label: 'Zombies' },
] as const

export type Theme = typeof THEMES[number]['value']

// D. CONTENT WARNINGS (FILTERABLE ONLY - exclude/include)
// Stored as Title Case in DB
export const CONTENT_WARNINGS = [
  { value: 'Gore', label: 'Gore' },
  { value: 'Sexual Violence', label: 'Sexual Violence' },
  { value: 'Self-Harm', label: 'Self-Harm' },
] as const

export type ContentWarning = typeof CONTENT_WARNINGS[number]['value']

// E. PUBLICATION STATUS (stored lowercase in DB)
export const PUBLICATION_STATUS = [
  { value: 'all', label: 'All Status' },
  { value: 'ongoing', label: 'Ongoing' },
  { value: 'completed', label: 'Completed' },
  { value: 'hiatus', label: 'On Hiatus' },
  { value: 'cancelled', label: 'Cancelled' },
] as const

export type PublicationStatus = typeof PUBLICATION_STATUS[number]['value']

// F. RELEASE PERIOD
export const RELEASE_PERIODS = [
  { value: 'all', label: 'Any Time' },
  { value: 'this_month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'this_year', label: 'This Year' },
  { value: 'custom', label: 'Custom Range' },
] as const

export type ReleasePeriod = typeof RELEASE_PERIODS[number]['value']

// G. READABLE ON (SOURCE FILTER)
// Values must match series_sources.source_name (lowercase in DB)
// NOTE: Only sources that exist in the database should be listed here
export const SOURCES = [
  { value: 'all', label: 'All Sources' },
  { value: 'mangadex', label: 'MangaDex' },
  { value: 'multiple', label: 'Multiple Sources' },
] as const

export type Source = typeof SOURCES[number]['value']

// H. LANGUAGE
export const ORIGINAL_LANGUAGES = [
  { value: 'all', label: 'All Languages' },
  { value: 'ja', label: 'Japanese' },
  { value: 'ko', label: 'Korean' },
  { value: 'zh', label: 'Chinese' },
  { value: 'en', label: 'English' },
] as const

export const TRANSLATED_LANGUAGES = [
  { value: 'all', label: 'All Languages' },
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'pt-br', label: 'Portuguese (BR)' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'it', label: 'Italian' },
  { value: 'ru', label: 'Russian' },
  { value: 'id', label: 'Indonesian' },
  { value: 'th', label: 'Thai' },
  { value: 'vi', label: 'Vietnamese' },
] as const

export type OriginalLanguage = typeof ORIGINAL_LANGUAGES[number]['value']
export type TranslatedLanguage = typeof TRANSLATED_LANGUAGES[number]['value']

// I. CHAPTER COUNT
export const CHAPTER_COUNTS = [
  { value: '0', label: 'Any', min: 0, max: null },
  { value: '1+', label: '1+', min: 1, max: null },
  { value: '10+', label: '10+', min: 10, max: null },
  { value: '20+', label: '20+', min: 20, max: null },
  { value: '30+', label: '30+', min: 30, max: null },
  { value: '50+', label: '50+', min: 50, max: null },
  { value: '100+', label: '100+', min: 100, max: null },
  { value: '200+', label: '200+', min: 200, max: null },
] as const

export type ChapterCount = typeof CHAPTER_COUNTS[number]['value']

// J. SORTING
export const SORT_OPTIONS = [
  { value: 'latest_chapter', label: 'Latest Chapter', column: 'last_chapter_date', ascending: false },
  { value: 'popularity', label: 'Most Followed', column: 'total_follows', ascending: false },
  { value: 'score', label: 'Top Rated', column: 'average_rating', ascending: false },
  { value: 'newest', label: 'Newest', column: 'created_at', ascending: false },
] as const

export type SortOption = typeof SORT_OPTIONS[number]['value']

// CONTENT RATING (stored lowercase in DB)
// NOTE: 'pornographic' content is BLOCKED platform-wide due to legal/content policy
export const CONTENT_RATINGS = [
  { value: 'all', label: 'All Ratings' },
  { value: 'safe', label: 'Safe' },
  { value: 'suggestive', label: 'Suggestive' },
  { value: 'erotica', label: 'Erotica' },
] as const

export type ContentRating = typeof CONTENT_RATINGS[number]['value']

// =====================================================
// CANONICAL URL PARAMETER NAMES
// Single source of truth for all filter parameter names
// Used by: URL serialization, API parsing, buildApiParams
// =====================================================

export const FILTER_PARAMS = {
  // Text search
  query: 'q',
  
  // Multi-select filters (comma-separated)
  types: 'types',
  genres: 'genres',
  themes: 'themes',
  excludeWarnings: 'excludeWarnings',
  includeWarnings: 'includeWarnings',
  
  // Single-select filters
  status: 'status',
  rating: 'rating',
  period: 'period',
  source: 'source',
  origLang: 'origLang',
  transLang: 'transLang',
  chapters: 'chapters',
  sort: 'sort',
  
  // Date range
  dateFrom: 'dateFrom',
  dateTo: 'dateTo',
  
  // Pagination
  cursor: 'cursor',
  limit: 'limit',
  
  // Mode
  mode: 'mode',
} as const

// Deprecated parameter names mapped to their canonical names
// Used by API to support old URLs while logging deprecation warnings
export const DEPRECATED_PARAMS: Record<string, keyof typeof FILTER_PARAMS> = {
  // Old names -> canonical names
  'content_rating': 'rating',
  'contentRating': 'rating',
  'releasePeriod': 'period',
  'releaseFrom': 'dateFrom',
  'releaseTo': 'dateTo',
  'from': 'dateFrom',
  'to': 'dateTo',
  'exclude': 'excludeWarnings',
  'include': 'includeWarnings',
  'type': 'types',
  'sortBy': 'sort',
  'minChapters': 'chapters',
  'tags': 'themes',
}

// =====================================================
// FILTER STATE TYPE
// =====================================================

export interface FilterState {
  query: string
  types: string[]
  genres: string[]
  themes: string[]
  excludeContentWarnings: string[]
  includeContentWarnings: string[]
  status: string
  releasePeriod: string
  releaseDateFrom: string | null
  releaseDateTo: string | null
  source: string
  originalLanguage: string
  translatedLanguage: string
  chapterCount: string
  contentRating: string
  sort: string
  sortDirection: 'asc' | 'desc'
  mode: 'any' | 'all'
}

export const DEFAULT_FILTER_STATE: FilterState = {
  query: '',
  types: [],
  genres: [],
  themes: [],
  excludeContentWarnings: [],
  includeContentWarnings: [],
  status: 'all',
  releasePeriod: 'all',
  releaseDateFrom: null,
  releaseDateTo: null,
  source: 'all',
  originalLanguage: 'all',
  translatedLanguage: 'all',
  chapterCount: '0',
  contentRating: 'all',
  sort: 'latest_chapter',
  sortDirection: 'desc',
  mode: 'all',
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

export function getChapterCountRange(value: string): { min: number; max: number | null } {
  const option = CHAPTER_COUNTS.find(c => c.value === value)
  return option ? { min: option.min, max: option.max } : { min: 0, max: null }
}

export function getSortConfig(value: string): { column: string; ascending: boolean } {
  const option = SORT_OPTIONS.find(s => s.value === value)
  return option 
    ? { column: option.column, ascending: option.ascending }
    : { column: 'created_at', ascending: false }
}

export function getReleaseDateRange(period: string, customFrom?: string | null, customTo?: string | null): { from: Date | null; to: Date | null } {
  const now = new Date()
  
  switch (period) {
    case 'this_month': {
      const from = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from, to: now }
    }
    case 'last_month': {
      const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const to = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from, to }
    }
    case 'this_year': {
      const from = new Date(now.getFullYear(), 0, 1)
      return { from, to: now }
    }
    case 'custom': {
      return {
        from: customFrom ? new Date(customFrom) : null,
        to: customTo ? new Date(customTo) : null,
      }
    }
    default:
      return { from: null, to: null }
  }
}

/**
 * Get canonical param value, checking both canonical and deprecated names
 * Logs deprecation warning if deprecated param is used
 */
export function getCanonicalParam(
  searchParams: URLSearchParams, 
  canonicalName: keyof typeof FILTER_PARAMS,
  logDeprecation = false
): string | null {
  const paramName = FILTER_PARAMS[canonicalName]
  
  // First try canonical name
  const canonicalValue = searchParams.get(paramName)
  if (canonicalValue !== null) {
    return canonicalValue
  }
  
  // Then try deprecated names
  for (const [deprecated, canonical] of Object.entries(DEPRECATED_PARAMS)) {
    if (canonical === canonicalName) {
      const deprecatedValue = searchParams.get(deprecated)
      if (deprecatedValue !== null) {
        if (logDeprecation) {
          console.warn(`[API] Deprecated param '${deprecated}' used. Use '${paramName}' instead.`)
        }
        return deprecatedValue
      }
    }
  }
  
  return null
}

/**
 * Serialize filter state to URL params using canonical param names
 */
export function serializeFilters(filters: Partial<FilterState>): URLSearchParams {
  const params = new URLSearchParams()
  const P = FILTER_PARAMS
  
  if (filters.query) params.set(P.query, filters.query)
  if (filters.types?.length) params.set(P.types, filters.types.join(','))
  if (filters.genres?.length) params.set(P.genres, filters.genres.join(','))
  if (filters.themes?.length) params.set(P.themes, filters.themes.join(','))
  if (filters.excludeContentWarnings?.length) params.set(P.excludeWarnings, filters.excludeContentWarnings.join(','))
  if (filters.includeContentWarnings?.length) params.set(P.includeWarnings, filters.includeContentWarnings.join(','))
  if (filters.status && filters.status !== 'all') params.set(P.status, filters.status)
  if (filters.releasePeriod && filters.releasePeriod !== 'all') params.set(P.period, filters.releasePeriod)
  if (filters.releaseDateFrom) params.set(P.dateFrom, filters.releaseDateFrom)
  if (filters.releaseDateTo) params.set(P.dateTo, filters.releaseDateTo)
  if (filters.source && filters.source !== 'all') params.set(P.source, filters.source)
  if (filters.originalLanguage && filters.originalLanguage !== 'all') params.set(P.origLang, filters.originalLanguage)
  if (filters.translatedLanguage && filters.translatedLanguage !== 'all') params.set(P.transLang, filters.translatedLanguage)
  if (filters.chapterCount && filters.chapterCount !== '0') params.set(P.chapters, filters.chapterCount)
  if (filters.contentRating && filters.contentRating !== 'all') params.set(P.rating, filters.contentRating)
  if (filters.sort && filters.sort !== 'latest_chapter') params.set(P.sort, filters.sort)
  
  return params
}

/**
 * Deserialize URL params to filter state
 * Supports both canonical and deprecated param names for backwards compatibility
 */
export function deserializeFilters(params: URLSearchParams): Partial<FilterState> {
  const P = FILTER_PARAMS
  
  // Helper to get value from canonical or deprecated param
  const get = (canonical: keyof typeof FILTER_PARAMS): string | null => {
    return getCanonicalParam(params, canonical, false)
  }
  
  return {
    query: get('query') || '',
    types: get('types')?.split(',').filter(Boolean) || [],
    genres: get('genres')?.split(',').filter(Boolean) || [],
    themes: get('themes')?.split(',').filter(Boolean) || [],
    excludeContentWarnings: get('excludeWarnings')?.split(',').filter(Boolean) || [],
    includeContentWarnings: get('includeWarnings')?.split(',').filter(Boolean) || [],
    status: get('status') || 'all',
    releasePeriod: get('period') || 'all',
    releaseDateFrom: get('dateFrom') || null,
    releaseDateTo: get('dateTo') || null,
    source: get('source') || 'all',
    originalLanguage: get('origLang') || 'all',
    translatedLanguage: get('transLang') || 'all',
    chapterCount: get('chapters') || '0',
    contentRating: get('rating') || 'all',
    sort: get('sort') || 'latest_chapter',
  }
}

/**
 * Build API query params from filter state using canonical param names
 * Used by client-side code to build API requests
 */
export function buildApiParams(filters: Partial<FilterState>): URLSearchParams {
  // Use same serialization as URL - they should be identical
  return serializeFilters(filters)
}

// Count active filters
export function countActiveFilters(filters: Partial<FilterState>): number {
  let count = 0
  
  if (filters.query) count++
  if (filters.types?.length) count += filters.types.length
  if (filters.genres?.length) count += filters.genres.length
  if (filters.themes?.length) count += filters.themes.length
  if (filters.excludeContentWarnings?.length) count += filters.excludeContentWarnings.length
  if (filters.includeContentWarnings?.length) count += filters.includeContentWarnings.length
  if (filters.status && filters.status !== 'all') count++
  if (filters.releasePeriod && filters.releasePeriod !== 'all') count++
  if (filters.source && filters.source !== 'all') count++
  if (filters.originalLanguage && filters.originalLanguage !== 'all') count++
  if (filters.translatedLanguage && filters.translatedLanguage !== 'all') count++
  if (filters.chapterCount && filters.chapterCount !== '0') count++
  if (filters.contentRating && filters.contentRating !== 'all') count++
  
  return count
}

// Count active filters EXCLUDING query (for filter chips display)
export function countActiveNonQueryFilters(filters: Partial<FilterState>): number {
  let count = 0
  
  if (filters.types?.length) count += filters.types.length
  if (filters.genres?.length) count += filters.genres.length
  if (filters.themes?.length) count += filters.themes.length
  if (filters.excludeContentWarnings?.length) count += filters.excludeContentWarnings.length
  if (filters.includeContentWarnings?.length) count += filters.includeContentWarnings.length
  if (filters.status && filters.status !== 'all') count++
  if (filters.releasePeriod && filters.releasePeriod !== 'all') count++
  if (filters.source && filters.source !== 'all') count++
  if (filters.originalLanguage && filters.originalLanguage !== 'all') count++
  if (filters.translatedLanguage && filters.translatedLanguage !== 'all') count++
  if (filters.chapterCount && filters.chapterCount !== '0') count++
  if (filters.contentRating && filters.contentRating !== 'all') count++
  
  return count
}

// Check if any filters (excluding query) are active
export function hasActiveNonQueryFilters(filters: Partial<FilterState>): boolean {
  return (
    (filters.types?.length ?? 0) > 0 ||
    (filters.genres?.length ?? 0) > 0 ||
    (filters.themes?.length ?? 0) > 0 ||
    (filters.excludeContentWarnings?.length ?? 0) > 0 ||
    (filters.includeContentWarnings?.length ?? 0) > 0 ||
    (filters.status !== undefined && filters.status !== 'all') ||
    (filters.releasePeriod !== undefined && filters.releasePeriod !== 'all') ||
    (filters.source !== undefined && filters.source !== 'all') ||
    (filters.originalLanguage !== undefined && filters.originalLanguage !== 'all') ||
    (filters.translatedLanguage !== undefined && filters.translatedLanguage !== 'all') ||
    (filters.chapterCount !== undefined && filters.chapterCount !== '0') ||
    (filters.contentRating !== undefined && filters.contentRating !== 'all')
  )
}
