"use client"

import { useState, useEffect, useCallback, useRef, Suspense } from "react"
import { Search, Star, Users, Loader2, Globe, AlertCircle, RefreshCcw, X, SlidersHorizontal } from "lucide-react"
import Link from "next/link"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { NSFWCover } from "@/components/ui/nsfw-cover"
import { FiltersPanel } from "@/components/series/FiltersPanel"
import { SeriesBrowseRow } from "@/components/series/SeriesBrowseRow"
import { 
  FilterState, 
  DEFAULT_FILTER_STATE,
  hasActiveNonQueryFilters,
  serializeFilters,
  deserializeFilters,
  FILTER_PARAMS,
  PUBLICATION_STATUS,
  CONTENT_RATINGS,
  CHAPTER_COUNTS,
  SOURCES,
  ORIGINAL_LANGUAGES,
  TRANSLATED_LANGUAGES,
  RELEASE_PERIODS,
} from "@/lib/constants/filters"

// =====================================================
// MANGATRACK-STYLE INTERACTION MODEL
// =====================================================
// 
// STATE OWNERSHIP:
// - searchQuery: Independent string state for search input
// - activeFilters: Committed filter state (excludes query)
// - pendingFilters: Draft state inside FiltersPanel (local)
//
// FETCH TRIGGERS:
// - Search submission (Enter key) → ALWAYS fetches with current searchQuery + activeFilters
// - Filter Apply button → Commits pendingFilters to activeFilters, then fetches
// - Clear Filters → Resets activeFilters to defaults, fetches with searchQuery intact
// - Clear Search → Clears searchQuery only, fetches with activeFilters intact
//
// URL SYNC:
// - 'q' param: searchQuery (independent)
// - Other params: activeFilters (committed filters)
// - Both update URL immediately on change
//
// KEY PRINCIPLE: Search and Filters are ORTHOGONAL
// - Search does NOT mutate filter state
// - Filters do NOT include search query
// =====================================================

interface Series {
  id: string
  title: string
  cover_url: string | null
  type: string
  status: string
  genres: string[]
  themes?: string[]
  average_rating: number | null
  total_follows: number
  updated_at: string
  last_chapter_date?: string
  content_rating: string | null
  chapter_count?: number
}

interface BrowseApiResponse {
  status: string
  results: Series[]
  total?: number
  has_more: boolean
  next_cursor: string | null
  filters_applied: Record<string, any>
}

// Filters WITHOUT query - used for activeFilters state
type FiltersWithoutQuery = Omit<FilterState, 'query'>

const DEFAULT_FILTERS_WITHOUT_QUERY: FiltersWithoutQuery = {
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

function SeriesSkeleton() {
  return (
    <div className="space-y-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="flex gap-6 p-4 rounded-3xl bg-zinc-50/50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
          <Skeleton className="w-24 sm:w-32 aspect-[3/4] rounded-2xl shrink-0" />
          <div className="flex-1 py-1 space-y-4">
            <div className="space-y-2">
              <Skeleton className="h-6 w-3/4" />
              <div className="flex gap-2">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

function FilterChipRemovable({ 
  label, 
  onRemove,
  variant = 'default'
}: { 
  label: string
  onRemove: () => void
  variant?: 'default' | 'exclude'
}) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
      variant === 'exclude' 
        ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300' 
        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
    }`}>
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 p-0.5 rounded-full hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
        aria-label={`Remove ${label} filter`}
      >
        <X className="size-3" />
      </button>
    </span>
  )
}

/**
 * Check if any filters (excluding query) are active
 */
function hasActiveFilters(filters: FiltersWithoutQuery): boolean {
  return (
    filters.types.length > 0 ||
    filters.genres.length > 0 ||
    filters.themes.length > 0 ||
    filters.excludeContentWarnings.length > 0 ||
    filters.includeContentWarnings.length > 0 ||
    filters.status !== 'all' ||
    filters.contentRating !== 'all' ||
    filters.releasePeriod !== 'all' ||
    filters.source !== 'all' ||
    filters.originalLanguage !== 'all' ||
    filters.translatedLanguage !== 'all' ||
    filters.chapterCount !== '0'
  )
}

/**
 * Count active filters (excluding query)
 */
function countFilters(filters: FiltersWithoutQuery): number {
  let count = 0
  if (filters.types.length > 0) count += filters.types.length
  if (filters.genres.length > 0) count += filters.genres.length
  if (filters.themes.length > 0) count += filters.themes.length
  if (filters.excludeContentWarnings.length > 0) count += filters.excludeContentWarnings.length
  if (filters.includeContentWarnings.length > 0) count += filters.includeContentWarnings.length
  if (filters.status !== 'all') count++
  if (filters.contentRating !== 'all') count++
  if (filters.releasePeriod !== 'all') count++
  if (filters.source !== 'all') count++
  if (filters.originalLanguage !== 'all') count++
  if (filters.translatedLanguage !== 'all') count++
  if (filters.chapterCount !== '0') count++
  return count
}

/**
 * Build API params from search query and filters (separate concerns)
 */
function buildApiParams(searchQuery: string, filters: FiltersWithoutQuery): URLSearchParams {
  const params = new URLSearchParams()
  const P = FILTER_PARAMS
  
  // Search query (independent)
  if (searchQuery) params.set(P.query, searchQuery)
  
  // Filters (committed state)
  if (filters.types.length) params.set(P.types, filters.types.join(','))
  if (filters.genres.length) params.set(P.genres, filters.genres.join(','))
  if (filters.themes.length) params.set(P.themes, filters.themes.join(','))
  if (filters.excludeContentWarnings.length) params.set(P.excludeWarnings, filters.excludeContentWarnings.join(','))
  if (filters.includeContentWarnings.length) params.set(P.includeWarnings, filters.includeContentWarnings.join(','))
  if (filters.status !== 'all') params.set(P.status, filters.status)
  if (filters.releasePeriod !== 'all') params.set(P.period, filters.releasePeriod)
  if (filters.releaseDateFrom) params.set(P.dateFrom, filters.releaseDateFrom)
  if (filters.releaseDateTo) params.set(P.dateTo, filters.releaseDateTo)
  if (filters.source !== 'all') params.set(P.source, filters.source)
  if (filters.originalLanguage !== 'all') params.set(P.origLang, filters.originalLanguage)
  if (filters.translatedLanguage !== 'all') params.set(P.transLang, filters.translatedLanguage)
  if (filters.chapterCount !== '0') params.set(P.chapters, filters.chapterCount)
  if (filters.contentRating !== 'all') params.set(P.rating, filters.contentRating)
  if (filters.sort !== 'latest_chapter') params.set(P.sort, filters.sort)
  
  return params
}

  /**
   * Deserialize URL params into search query and filters (separated)
   */
  function parseUrlParams(searchParams: URLSearchParams): { 
    searchQuery: string
    filters: FiltersWithoutQuery 
  } {
    const fullFilters = deserializeFilters(searchParams)
    
    // Extract query separately
    const searchQuery = fullFilters.query || ''
    
    // Create filters without query
    const filters: FiltersWithoutQuery = {
      types: fullFilters.types || [],
      genres: fullFilters.genres || [],
      themes: fullFilters.themes || [],
      excludeContentWarnings: fullFilters.excludeContentWarnings || [],
      includeContentWarnings: fullFilters.includeContentWarnings || [],
      status: fullFilters.status || 'all',
      releasePeriod: fullFilters.releasePeriod || 'all',
      releaseDateFrom: fullFilters.releaseDateFrom || null,
      releaseDateTo: fullFilters.releaseDateTo || null,
      source: fullFilters.source || 'all',
      originalLanguage: fullFilters.originalLanguage || 'all',
      translatedLanguage: fullFilters.translatedLanguage || 'all',
      chapterCount: fullFilters.chapterCount || '0',
      contentRating: fullFilters.contentRating || 'all',
      sort: fullFilters.sort || 'latest_chapter',
      sortDirection: fullFilters.sortDirection || 'desc',
      mode: fullFilters.mode || 'all',
    }
  
  return { searchQuery, filters }
}

const BrowsePageContent = () => {
  const router = useRouter()
  const pathname = usePathname()
  const urlSearchParams = useSearchParams()
  
  // Parse initial state from URL
  const initialState = parseUrlParams(urlSearchParams)
  
  // =====================================================
  // SEPARATED STATE (MangaTrack model)
  // =====================================================
  
  // Search query - INDEPENDENT from filters
  const [searchQuery, setSearchQuery] = useState(initialState.searchQuery)
  
  // Search input - local draft state (not synced to URL until Enter)
  const [searchInput, setSearchInput] = useState(initialState.searchQuery)
  
  // Active filters - COMMITTED filter state (excludes query)
  const [activeFilters, setActiveFilters] = useState<FiltersWithoutQuery>(initialState.filters)
  
  // Results state
  const [results, setResults] = useState<Series[]>([])
  const [fetchStatus, setFetchStatus] = useState<"idle" | "loading" | "resolving" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [totalResults, setTotalResults] = useState<number>(0)
  const [discoveryInfo, setDiscoveryInfo] = useState<{
    discovery_status: string;
    discovery_state: string;
    message: string;
  } | null>(null)
  
  // Cursor pagination
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(false)
  const [isRefetching, setIsRefetching] = useState(false)
  
  // Refs
  const abortControllerRef = useRef<AbortController | null>(null)
  const supabase = useRef(createClient())
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const initialFetchDone = useRef(false)
  const urlUpdateTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const searchDebounceRef = useRef<NodeJS.Timeout | undefined>(undefined)
  
  // Refs for latest state (avoid stale closures)
  const searchQueryRef = useRef(searchQuery)
  const activeFiltersRef = useRef(activeFilters)
  
  useEffect(() => {
    searchQueryRef.current = searchQuery
  }, [searchQuery])
  
  useEffect(() => {
    activeFiltersRef.current = activeFilters
  }, [activeFilters])

  // =====================================================
  // URL SYNC
  // =====================================================
  
  const updateUrl = useCallback((query: string, filters: FiltersWithoutQuery) => {
    if (urlUpdateTimeoutRef.current) {
      clearTimeout(urlUpdateTimeoutRef.current)
    }
    
    urlUpdateTimeoutRef.current = setTimeout(() => {
      const params = buildApiParams(query, filters)
      const queryString = params.toString()
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname
      router.replace(newUrl, { scroll: false })
    }, 100)
  }, [pathname, router])

  // =====================================================
  // FETCH LOGIC
  // =====================================================

  const performFetch = useCallback(async (
    query: string,
    filters: FiltersWithoutQuery,
    cursor: string | null = null
  ) => {
    if (abortControllerRef.current && !cursor) {
      abortControllerRef.current.abort()
    }

    if (!cursor) {
      setFetchStatus("loading")
      setResults([])
      setError(null)
      setNextCursor(null)
      abortControllerRef.current = new AbortController()
    } else {
      setIsRefetching(true)
    }

    try {
      const params = buildApiParams(query, filters)
      params.set('limit', '24')
      
      if (cursor) {
        params.set('cursor', cursor)
      }

        // Use search API if there's a query, otherwise browse API
        const endpoint = query ? '/api/series/search' : '/api/series/browse'
        const res = await fetch(`${endpoint}?${params.toString()}`, {
          signal: abortControllerRef.current?.signal,
          cache: 'no-store'  // Force fresh fetch every time - prevents browser caching
        })
      const data: BrowseApiResponse = await res.json()

      if (!res.ok) {
        setFetchStatus("error")
        setError(data.status || "Failed to fetch results")
        return
      }

        if (data.status === "resolving") {
          setFetchStatus("resolving")
        } else if (data.status === "limit_reached") {
          setFetchStatus("done") // We show results but with a limit warning
        } else {
          setFetchStatus("done")
        }

        // Set discovery info for status messages
        if ((data as any).discovery_status) {
          setDiscoveryInfo({
            discovery_status: (data as any).discovery_status,
            discovery_state: (data as any).discovery_state,
            message: (data as any).message
          })
        }

        setResults(prev => {
          const newResults = !cursor ? (data.results || []) : [...prev, ...(data.results || [])];
          // Deduplicate by ID to prevent React key errors
          const seen = new Set();
          return newResults.filter(series => {
            if (seen.has(series.id)) return false;
            seen.add(series.id);
            return true;
          });
        })
      
      if (data.total !== undefined) {
        setTotalResults(data.total)
      }
      
      setHasMore(data.has_more)
      setNextCursor(data.next_cursor)

      } catch (err) {
        // Handle all abort scenarios: string reasons, DOMException, Error with AbortError name
        if (typeof err === 'string') return
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (err instanceof Error && err.name === 'AbortError') return
        if (abortControllerRef.current?.signal.aborted) return
        
        console.error("Fetch error:", err)
        if (!cursor) {
          setFetchStatus("error")
          setError("An unexpected error occurred")
        }
      } finally {
      setIsRefetching(false)
    }
  }, [])

  // =====================================================
  // INITIAL FETCH
  // =====================================================
  
  useEffect(() => {
    if (!initialFetchDone.current) {
      initialFetchDone.current = true
      performFetch(searchQuery, activeFilters, null)
    }
  }, [])

  // =====================================================
  // REALTIME UPDATES FOR RESOLVING STATE
  // =====================================================
  
  useEffect(() => {
    let timeoutId: NodeJS.Timeout

    if (fetchStatus === "resolving") {
      const channel = supabase.current
        .channel('public:series')
        .on('broadcast', { event: 'series.available' }, () => {
          if (isRefetching) return
          clearTimeout(timeoutId)
          timeoutId = setTimeout(() => performFetch(searchQueryRef.current, activeFiltersRef.current, null), 1000)
        })
        .subscribe()

      timeoutId = setTimeout(() => {
        if (isRefetching) return
        performFetch(searchQueryRef.current, activeFiltersRef.current, null)
      }, 15000)

      return () => {
        if (timeoutId) clearTimeout(timeoutId)
        supabase.current.removeChannel(channel)
      }
    }
  }, [fetchStatus, performFetch])

  // =====================================================
  // INFINITE SCROLL
  // =====================================================
  
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && nextCursor && fetchStatus !== "loading" && !isRefetching) {
          performFetch(searchQueryRef.current, activeFiltersRef.current, nextCursor)
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current)
    }

    return () => observer.disconnect()
  }, [hasMore, nextCursor, fetchStatus, isRefetching, performFetch])

  // =====================================================
  // EVENT HANDLERS
  // =====================================================

  // SEARCH SUBMIT - Called when user presses Enter (immediate) or after debounce
  // Search is ALWAYS allowed, never blocked by filters
  // Search does NOT mutate filter state
  const handleSearchSubmit = useCallback((immediate = false) => {
    // Clear any pending debounce when submitting immediately
    if (immediate && searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = undefined
    }
    
    const trimmedQuery = searchInput.trim()
    
    // Update search query state
    setSearchQuery(trimmedQuery)
    
    // Update URL with new search query + existing filters
    updateUrl(trimmedQuery, activeFiltersRef.current)
    
    // ALWAYS fetch - cursor resets on new search
    performFetch(trimmedQuery, activeFiltersRef.current, null)
  }, [searchInput, updateUrl, performFetch])

  // DEBOUNCED SEARCH - Triggers auto-search while typing
  const handleSearchInputChange = useCallback((value: string) => {
    setSearchInput(value)
    
    // Clear previous debounce timer
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
    }
    
    // Set new debounce timer (400ms delay)
    searchDebounceRef.current = setTimeout(() => {
      const trimmedQuery = value.trim()
      
      // Update search query state
      setSearchQuery(trimmedQuery)
      
      // Update URL with new search query + existing filters
      updateUrl(trimmedQuery, activeFiltersRef.current)
      
      // Fetch with debounced query
      performFetch(trimmedQuery, activeFiltersRef.current, null)
    }, 400)
  }, [updateUrl, performFetch])

  // CLEAR SEARCH - Clears search query only, keeps filters
  const handleClearSearch = useCallback(() => {
    // Clear any pending debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = undefined
    }
    setSearchInput('')
    setSearchQuery('')
    updateUrl('', activeFiltersRef.current)
    performFetch('', activeFiltersRef.current, null)
  }, [updateUrl, performFetch])

  // FILTER APPLY - Called from FiltersPanel
  // Commits pending filters, then fetches
  const handleFiltersApply = useCallback((newFilters: FilterState) => {
    // Extract filters without query (FiltersPanel should not have query anymore)
    const filtersOnly: FiltersWithoutQuery = {
      types: newFilters.types,
      genres: newFilters.genres,
      themes: newFilters.themes,
      excludeContentWarnings: newFilters.excludeContentWarnings,
      includeContentWarnings: newFilters.includeContentWarnings,
      status: newFilters.status,
      releasePeriod: newFilters.releasePeriod,
      releaseDateFrom: newFilters.releaseDateFrom,
      releaseDateTo: newFilters.releaseDateTo,
      source: newFilters.source,
      originalLanguage: newFilters.originalLanguage,
      translatedLanguage: newFilters.translatedLanguage,
      chapterCount: newFilters.chapterCount,
      contentRating: newFilters.contentRating,
      sort: newFilters.sort,
      sortDirection: newFilters.sortDirection,
      mode: newFilters.mode,
    }
    
    // Commit filters
    setActiveFilters(filtersOnly)
    
    // Update URL with current search + new filters
    updateUrl(searchQueryRef.current, filtersOnly)
    
    // Fetch with current search + new filters
    performFetch(searchQueryRef.current, filtersOnly, null)
  }, [updateUrl, performFetch])

  // CLEAR FILTERS - One-click clear, keeps search query
  // This is the "Clear Filters" button near search bar
  const handleClearFilters = useCallback(() => {
    setActiveFilters(DEFAULT_FILTERS_WITHOUT_QUERY)
    updateUrl(searchQueryRef.current, DEFAULT_FILTERS_WITHOUT_QUERY)
    performFetch(searchQueryRef.current, DEFAULT_FILTERS_WITHOUT_QUERY, null)
  }, [updateUrl, performFetch])

  // REMOVE SINGLE FILTER - From chip removal
  const handleRemoveFilter = useCallback((
    filterKey: keyof FiltersWithoutQuery,
    value?: string
  ) => {
    const newFilters = { ...activeFiltersRef.current }
    
    if (Array.isArray(newFilters[filterKey])) {
      (newFilters[filterKey] as string[]) = (newFilters[filterKey] as string[]).filter(v => v !== value)
    } else {
      const defaultValue = DEFAULT_FILTERS_WITHOUT_QUERY[filterKey]
      ;(newFilters as any)[filterKey] = defaultValue
    }
    
    setActiveFilters(newFilters)
    updateUrl(searchQueryRef.current, newFilters)
    performFetch(searchQueryRef.current, newFilters, null)
  }, [updateUrl, performFetch])

  // RESET ALL - Clears both search and filters
  const handleResetAll = useCallback(() => {
    // Clear any pending debounce
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current)
      searchDebounceRef.current = undefined
    }
    setSearchInput('')
    setSearchQuery('')
    setActiveFilters(DEFAULT_FILTERS_WITHOUT_QUERY)
    updateUrl('', DEFAULT_FILTERS_WITHOUT_QUERY)
    performFetch('', DEFAULT_FILTERS_WITHOUT_QUERY, null)
  }, [updateUrl, performFetch])

  // =====================================================
  // HELPERS
  // =====================================================

  const getFilterLabel = useCallback((key: string, value: string): string => {
    switch (key) {
      case 'status':
        return PUBLICATION_STATUS.find(s => s.value === value)?.label || value
      case 'contentRating':
        return CONTENT_RATINGS.find(r => r.value === value)?.label || value
      case 'chapterCount':
        return `${CHAPTER_COUNTS.find(c => c.value === value)?.label || value} chapters`
      case 'source':
        return SOURCES.find(s => s.value === value)?.label || value
      case 'originalLanguage':
        return `Origin: ${ORIGINAL_LANGUAGES.find(l => l.value === value)?.label || value}`
      case 'translatedLanguage':
        return `Trans: ${TRANSLATED_LANGUAGES.find(l => l.value === value)?.label || value}`
      case 'releasePeriod':
        return RELEASE_PERIODS.find(p => p.value === value)?.label || value
      default:
        return value
    }
  }, [])

  // Build FilterState for FiltersPanel (needs query field for compatibility)
  const filtersForPanel: FilterState = {
    ...activeFilters,
    query: '', // Panel doesn't manage query
  }

  const activeFilterCount = countFilters(activeFilters)
  const hasFiltersActive = hasActiveFilters(activeFilters)

  // =====================================================
  // CLEANUP
  // =====================================================
  
  useEffect(() => {
    return () => {
      if (urlUpdateTimeoutRef.current) {
        clearTimeout(urlUpdateTimeoutRef.current)
      }
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current)
      }
    }
  }, [])

  return (
    <div className="p-6 space-y-8 max-w-[1600px] mx-auto pb-24 min-h-screen">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-4xl font-black tracking-tight uppercase italic">Browse</h1>
        <p className="text-zinc-500 text-sm font-medium uppercase tracking-widest">Discover your next favorite series</p>
      </div>

      {/* Search Bar + Clear Filters + Filters Button (Single Row) */}
      <div className="flex items-center gap-3">
        {/* Search Input */}
          <div className="relative flex-1 max-w-2xl">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
            <Input
              value={searchInput}
              onChange={(e) => handleSearchInputChange(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearchSubmit(true)}
              placeholder="Search titles, descriptions..."
              className="h-11 pl-11 pr-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 transition-all"
            />
          {searchInput && (
            <button
              onClick={handleClearSearch}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
              title="Clear search"
            >
              <X className="size-3 text-zinc-400" />
            </button>
          )}
        </div>

        {/* CLEAR FILTERS BUTTON - Always visible when filters active */}
        {hasFiltersActive && (
          <Button
            variant="outline"
            onClick={handleClearFilters}
            className="h-11 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 gap-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 hover:border-red-200 dark:hover:border-red-900"
            title="Clear all filters (keeps search)"
          >
            <X className="size-4" />
            <span className="hidden sm:inline">Clear Filters</span>
            <Badge className="h-5 px-1.5 text-[10px] bg-red-100 dark:bg-red-900/50 text-red-700 dark:text-red-300">
              {activeFilterCount}
            </Badge>
          </Button>
        )}

        {/* Filters Panel Trigger */}
        <FiltersPanel
          filters={filtersForPanel}
          onFiltersChange={() => {}} // Not used - panel manages its own pending state
          onApply={handleFiltersApply}
          isLoading={fetchStatus === "loading"}
          totalResults={totalResults}
        />
      </div>

      {/* Active Search Query Indicator */}
      {searchQuery && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-zinc-500">Searching for:</span>
          <span className="font-semibold text-zinc-900 dark:text-zinc-100">&ldquo;{searchQuery}&rdquo;</span>
          {hasFiltersActive && (
            <span className="text-zinc-400">with {activeFilterCount} filter{activeFilterCount !== 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* Active Filter Chips - OUTSIDE filter panel for visibility */}
      {hasFiltersActive && (
        <div className="flex flex-wrap items-center gap-2 animate-in fade-in slide-in-from-top-2 duration-300">
          {/* Type chips */}
          {activeFilters.types.map(type => (
            <FilterChipRemovable
              key={`type-${type}`}
              label={type}
              onRemove={() => handleRemoveFilter('types', type)}
            />
          ))}
          
          {/* Genre chips */}
          {activeFilters.genres.map(genre => (
            <FilterChipRemovable
              key={`genre-${genre}`}
              label={genre}
              onRemove={() => handleRemoveFilter('genres', genre)}
            />
          ))}
          
          {/* Theme chips */}
          {activeFilters.themes.map(theme => (
            <FilterChipRemovable
              key={`theme-${theme}`}
              label={theme}
              onRemove={() => handleRemoveFilter('themes', theme)}
            />
          ))}
          
          {/* Exclude Content Warnings chips */}
          {activeFilters.excludeContentWarnings.map(warning => (
            <FilterChipRemovable
              key={`exclude-${warning}`}
              label={`Exclude: ${warning}`}
              onRemove={() => handleRemoveFilter('excludeContentWarnings', warning)}
              variant="exclude"
            />
          ))}
          
          {/* Include Content Warnings chips */}
          {activeFilters.includeContentWarnings.map(warning => (
            <FilterChipRemovable
              key={`include-${warning}`}
              label={`Include: ${warning}`}
              onRemove={() => handleRemoveFilter('includeContentWarnings', warning)}
            />
          ))}
          
          {/* Status chip */}
          {activeFilters.status !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('status', activeFilters.status)}
              onRemove={() => handleRemoveFilter('status')}
            />
          )}
          
          {/* Content Rating chip */}
          {activeFilters.contentRating !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('contentRating', activeFilters.contentRating)}
              onRemove={() => handleRemoveFilter('contentRating')}
            />
          )}
          
          {/* Release Period chip */}
          {activeFilters.releasePeriod !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('releasePeriod', activeFilters.releasePeriod)}
              onRemove={() => handleRemoveFilter('releasePeriod')}
            />
          )}
          
          {/* Source chip */}
          {activeFilters.source !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('source', activeFilters.source)}
              onRemove={() => handleRemoveFilter('source')}
            />
          )}
          
          {/* Original Language chip */}
          {activeFilters.originalLanguage !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('originalLanguage', activeFilters.originalLanguage)}
              onRemove={() => handleRemoveFilter('originalLanguage')}
            />
          )}
          
          {/* Translated Language chip */}
          {activeFilters.translatedLanguage !== 'all' && (
            <FilterChipRemovable
              label={getFilterLabel('translatedLanguage', activeFilters.translatedLanguage)}
              onRemove={() => handleRemoveFilter('translatedLanguage')}
            />
          )}
          
          {/* Chapter Count chip */}
          {activeFilters.chapterCount !== '0' && (
            <FilterChipRemovable
              label={getFilterLabel('chapterCount', activeFilters.chapterCount)}
              onRemove={() => handleRemoveFilter('chapterCount')}
            />
          )}
        </div>
      )}

        {/* Discovery / Limit Status Messages */}
        {discoveryInfo && (
          <div className={`flex items-center gap-3 p-4 rounded-xl border animate-in fade-in slide-in-from-top-2 duration-300 ${
            discoveryInfo.discovery_status === 'limit_reached' 
              ? 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200'
              : 'bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-200'
          }`}>
            <AlertCircle className="size-4 shrink-0" />
            <p className="text-xs font-semibold uppercase tracking-tight">{discoveryInfo.message}</p>
            {discoveryInfo.discovery_status === 'limit_reached' && (
              <Button 
                variant="link" 
                className="h-auto p-0 text-xs font-bold uppercase underline"
                onClick={() => router.push('/settings/billing')}
              >
                Upgrade for more
              </Button>
            )}
          </div>
        )}

        {/* Resolving State Banner */}
        {fetchStatus === "resolving" && (
        <div className="flex items-center gap-4 p-5 rounded-2xl bg-zinc-900 text-white border border-zinc-800 shadow-2xl animate-in fade-in slide-in-from-top-4 duration-500">
          <div className="relative shrink-0">
            <Globe className="size-6 text-zinc-400" />
            <div className="absolute -top-0.5 -right-0.5 size-2.5 bg-zinc-100 rounded-full animate-ping" />
          </div>
          <div className="flex-1">
            <p className="font-black text-sm uppercase italic tracking-wider">Searching External Sources</p>
            <p className="text-zinc-400 text-xs font-medium uppercase tracking-tight">
              {results.length > 0 
                ? `Showing ${results.length} local series. Fetching more from MangaDex...`
                : "Checking MangaDex database. Results appearing shortly."
              }
            </p>
          </div>
          <RefreshCcw className="size-5 text-zinc-500 animate-spin shrink-0" />
        </div>
      )}

      {/* Error State */}
      {fetchStatus === "error" && (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <AlertCircle className="size-12 text-red-500" />
          <div className="space-y-2">
            <h3 className="text-xl font-bold">Failed to load series</h3>
            <p className="text-zinc-500 max-w-sm mx-auto">{error}</p>
          </div>
          <button 
            onClick={() => performFetch(searchQuery, activeFilters, null)}
            className="bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900 px-8 py-3 rounded-full text-sm font-black uppercase italic tracking-widest hover:scale-105 transition-transform"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Results count */}
      {fetchStatus === "done" && totalResults > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-zinc-500">
            Showing <span className="font-semibold text-zinc-900 dark:text-zinc-100">{results.length}</span> of{' '}
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">{totalResults}</span> results
          </p>
        </div>
      )}

      {/* Results List */}
      {results.length > 0 ? (
        <div className="space-y-4">
          {results.map((series) => (
            <SeriesBrowseRow key={series.id} series={series} />
          ))}
        </div>
      ) : fetchStatus === "done" ? (
        <div className="flex flex-col items-center justify-center py-32 text-center space-y-6">
          <div className="size-24 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <Search className="size-12" />
          </div>
          <div className="space-y-2">
            <h3 className="text-2xl font-black uppercase italic">Nothing Found</h3>
            <p className="text-zinc-500 max-w-xs mx-auto text-sm font-medium uppercase tracking-tight">
              {searchQuery 
                ? `No series match "${searchQuery}"${hasFiltersActive ? ' with current filters' : ''}.`
                : "We couldn't find any series matching your filters."
              }
            </p>
          </div>
          {(searchQuery || hasFiltersActive) && (
            <div className="flex gap-3">
              {hasFiltersActive && (
                <button 
                  onClick={handleClearFilters}
                  className="text-sm font-semibold px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Clear Filters
                </button>
              )}
              {searchQuery && (
                <button 
                  onClick={handleClearSearch}
                  className="text-sm font-semibold px-4 py-2 rounded-full border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                >
                  Clear Search
                </button>
              )}
              <button 
                onClick={handleResetAll}
                className="text-sm font-black uppercase italic tracking-widest underline underline-offset-8"
              >
                Reset All
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* Loading skeleton */}
      {fetchStatus === "loading" && results.length === 0 && <SeriesSkeleton />}

      {/* Infinite scroll trigger */}
      <div ref={loadMoreRef} className="h-40 flex items-center justify-center">
        {isRefetching && (
          <div className="flex flex-col items-center gap-4">
            <Loader2 className="size-8 animate-spin text-zinc-400" />
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-400">Loading More</p>
          </div>
        )}
      </div>
    </div>
  )
}

function BrowsePageSkeleton() {
  return (
    <div className="p-6 space-y-8 max-w-[1600px] mx-auto pb-24">
      <div className="space-y-2">
        <Skeleton className="h-12 w-48 rounded-lg" />
        <Skeleton className="h-4 w-64 rounded-lg" />
      </div>
      <div className="flex items-center gap-3">
        <Skeleton className="h-11 flex-1 max-w-2xl rounded-xl" />
        <Skeleton className="h-11 w-28 rounded-xl" />
      </div>
      <SeriesSkeleton />
    </div>
  )
}

export default function BrowsePage() {
  return (
    <Suspense fallback={<BrowsePageSkeleton />}>
      <BrowsePageContent />
    </Suspense>
  )
}
