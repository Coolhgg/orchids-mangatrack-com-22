"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { 
  FilterState, 
  DEFAULT_FILTER_STATE, 
  serializeFilters, 
  deserializeFilters,
  buildApiParams as buildApiParamsFromFilters
} from "@/lib/constants/filters"

interface UseFiltersOptions {
  syncToUrl?: boolean
  debounceMs?: number
}

export function useFilters(options: UseFiltersOptions = {}) {
  const { syncToUrl = true, debounceMs = 300 } = options
  
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const isInitialized = useRef(false)
  const debounceRef = useRef<NodeJS.Timeout | undefined>(undefined)

  // Initialize from URL params or defaults
  const [filters, setFiltersInternal] = useState<FilterState>(() => {
    if (syncToUrl && typeof window !== 'undefined') {
      const urlFilters = deserializeFilters(searchParams)
      return { ...DEFAULT_FILTER_STATE, ...urlFilters }
    }
    return DEFAULT_FILTER_STATE
  })

  // Sync URL on mount
  useEffect(() => {
    if (syncToUrl && !isInitialized.current) {
      const urlFilters = deserializeFilters(searchParams)
      setFiltersInternal(prev => ({ ...prev, ...urlFilters }))
      isInitialized.current = true
    }
  }, [searchParams, syncToUrl])

  // Update URL when filters change
  const updateUrl = useCallback((newFilters: FilterState) => {
    if (!syncToUrl) return

    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      const params = serializeFilters(newFilters)
      const queryString = params.toString()
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname
      
      router.replace(newUrl, { scroll: false })
    }, debounceMs)
  }, [syncToUrl, pathname, router, debounceMs])

  // Set filters and optionally sync to URL
  const setFilters = useCallback((newFilters: FilterState | ((prev: FilterState) => FilterState)) => {
    setFiltersInternal(prev => {
      const updated = typeof newFilters === 'function' ? newFilters(prev) : newFilters
      updateUrl(updated)
      return updated
    })
  }, [updateUrl])

  // Update a single filter
  const updateFilter = useCallback(<K extends keyof FilterState>(
    key: K, 
    value: FilterState[K]
  ) => {
    setFilters(prev => ({ ...prev, [key]: value }))
  }, [setFilters])

  // Reset all filters
  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTER_STATE)
  }, [setFilters])

  // Toggle a value in an array filter
  const toggleArrayFilter = useCallback(<K extends keyof FilterState>(
    key: K, 
    value: string
  ) => {
    setFilters(prev => {
      const currentArray = prev[key] as string[]
      if (!Array.isArray(currentArray)) return prev
      
      const newArray = currentArray.includes(value)
        ? currentArray.filter(v => v !== value)
        : [...currentArray, value]
      
      return { ...prev, [key]: newArray }
    })
  }, [setFilters])

  // Check if any filters are active
  const hasActiveFilters = useCallback(() => {
    return (
      filters.query !== '' ||
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
  }, [filters])

  // Build API query params from filter state using canonical param names
  const buildApiParams = useCallback(() => {
    return buildApiParamsFromFilters(filters)
  }, [filters])

  // Cleanup
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])

  return {
    filters,
    setFilters,
    updateFilter,
    resetFilters,
    toggleArrayFilter,
    hasActiveFilters,
    buildApiParams,
  }
}
