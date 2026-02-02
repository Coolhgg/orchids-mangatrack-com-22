"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { Search, X, SlidersHorizontal, ChevronDown, ChevronUp, RotateCcw, Calendar } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { MultiSelect, TriStateMultiSelect } from "@/components/ui/multi-select"
import { FilterGroup, FilterSection, FilterChip, ActiveFiltersBar } from "@/components/ui/filter-group"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  SERIES_TYPES,
  GENRES,
  THEMES,
  CONTENT_WARNINGS,
  PUBLICATION_STATUS,
  RELEASE_PERIODS,
  SOURCES,
  ORIGINAL_LANGUAGES,
  TRANSLATED_LANGUAGES,
  CHAPTER_COUNTS,
  SORT_OPTIONS,
  CONTENT_RATINGS,
  FilterState,
  DEFAULT_FILTER_STATE,
  countActiveFilters,
} from "@/lib/constants/filters"

interface AdvancedFilterBarProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  onSearch: () => void
  isLoading?: boolean
  totalResults?: number
}

interface SavedFilter {
  id: string
  name: string
  payload: any
  is_default: boolean
}

export function AdvancedFilterBar({
  filters,
  onFiltersChange,
  onSearch,
  isLoading = false,
  totalResults,
}: AdvancedFilterBarProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [newFilterName, setNewFilterName] = useState('')

  // BUG FIX: Use useEffect instead of useMemo for side effects (data fetching)
  // useMemo is for memoizing values, not for side effects
  const fetchSavedFilters = useCallback(async () => {
    try {
      const res = await fetch('/api/users/me/filters')
      if (res.ok) {
        const data = await res.json()
        setSavedFilters(data)
      }
    } catch (e) {
      console.error("Failed to fetch saved filters", e)
    }
  }, [])

  // BUG FIX: Changed from useMemo to useEffect for data fetching
  useEffect(() => {
    fetchSavedFilters()
  }, [fetchSavedFilters])

  const saveCurrentFilter = async () => {
    // BUG FIX: Trim filter name to prevent whitespace-only names
    const trimmedName = newFilterName.trim()
    if (!trimmedName) return
    setIsSaving(true)
    try {
      const res = await fetch('/api/users/me/filters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          payload: filters,
          is_default: false
        })
      })
      if (res.ok) {
        setNewFilterName('')
        fetchSavedFilters()
      }
    } catch (e) {
      console.error("Failed to save filter", e)
    } finally {
      setIsSaving(false)
    }
  }

  const applySavedFilter = (payload: any) => {
    onFiltersChange({ ...DEFAULT_FILTER_STATE, ...payload })
  }

  const deleteSavedFilter = async (id: string) => {
    try {
      const res = await fetch(`/api/users/me/filters/${id}`, { method: 'DELETE' })
      if (res.ok) fetchSavedFilters()
    } catch (e) {
      console.error("Failed to delete filter", e)
    }
  }

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])

  const updateFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    onFiltersChange({ ...filters, [key]: value })
  }, [filters, onFiltersChange])

  const resetFilters = useCallback(() => {
    onFiltersChange(DEFAULT_FILTER_STATE)
  }, [onFiltersChange])

  const removeFilter = useCallback((key: string, value: string) => {
    const filterKey = key as keyof FilterState
    const currentValue = filters[filterKey]
    
    if (Array.isArray(currentValue)) {
      updateFilter(filterKey, currentValue.filter(v => v !== value) as any)
    } else if (typeof currentValue === 'string') {
      if (filterKey === 'status' || filterKey === 'contentRating' || filterKey === 'originalLanguage' || 
          filterKey === 'translatedLanguage' || filterKey === 'chapterCount' || filterKey === 'releasePeriod' ||
          filterKey === 'source') {
        updateFilter(filterKey, 'all' as any)
      } else if (filterKey === 'sort') {
        updateFilter(filterKey, 'newest' as any)
      } else {
        updateFilter(filterKey, '' as any)
      }
    }
  }, [filters, updateFilter])

  // Build active filters list for display
  const activeFilters = useMemo(() => {
    const result: { key: string; label: string; value: string }[] = []
    
    if (filters.query) {
      result.push({ key: 'query', label: 'Search', value: filters.query })
    }
    
    filters.types.forEach(t => {
      const label = SERIES_TYPES.find(x => x.value === t)?.label || t
      result.push({ key: 'types', label: 'Type', value: label })
    })
    
    filters.genres.forEach(g => {
      const label = GENRES.find(x => x.value === g)?.label || g
      result.push({ key: 'genres', label: 'Genre', value: label })
    })
    
    filters.themes.forEach(t => {
      const label = THEMES.find(x => x.value === t)?.label || t
      result.push({ key: 'themes', label: 'Theme', value: label })
    })
    
    filters.excludeContentWarnings.forEach(w => {
      const label = CONTENT_WARNINGS.find(x => x.value === w)?.label || w
      result.push({ key: 'excludeContentWarnings', label: 'Exclude', value: label })
    })
    
    filters.includeContentWarnings.forEach(w => {
      const label = CONTENT_WARNINGS.find(x => x.value === w)?.label || w
      result.push({ key: 'includeContentWarnings', label: 'Include', value: label })
    })
    
    if (filters.status && filters.status !== 'all') {
      const label = PUBLICATION_STATUS.find(x => x.value === filters.status)?.label || filters.status
      result.push({ key: 'status', label: 'Status', value: label })
    }
    
    if (filters.contentRating && filters.contentRating !== 'all') {
      const label = CONTENT_RATINGS.find(x => x.value === filters.contentRating)?.label || filters.contentRating
      result.push({ key: 'contentRating', label: 'Rating', value: label })
    }
    
    if (filters.originalLanguage && filters.originalLanguage !== 'all') {
      const label = ORIGINAL_LANGUAGES.find(x => x.value === filters.originalLanguage)?.label || filters.originalLanguage
      result.push({ key: 'originalLanguage', label: 'Origin', value: label })
    }
    
    if (filters.translatedLanguage && filters.translatedLanguage !== 'all') {
      const label = TRANSLATED_LANGUAGES.find(x => x.value === filters.translatedLanguage)?.label || filters.translatedLanguage
      result.push({ key: 'translatedLanguage', label: 'Translation', value: label })
    }
    
    if (filters.chapterCount && filters.chapterCount !== '0') {
      const label = CHAPTER_COUNTS.find(x => x.value === filters.chapterCount)?.label || filters.chapterCount
      result.push({ key: 'chapterCount', label: 'Chapters', value: label })
    }
    
    if (filters.releasePeriod && filters.releasePeriod !== 'all') {
      const label = RELEASE_PERIODS.find(x => x.value === filters.releasePeriod)?.label || filters.releasePeriod
      result.push({ key: 'releasePeriod', label: 'Released', value: label })
    }
    
    if (filters.source && filters.source !== 'all') {
      const label = SOURCES.find(x => x.value === filters.source)?.label || filters.source
      result.push({ key: 'source', label: 'Source', value: label })
    }
    
    return result
  }, [filters])

  // Filter panel content (shared between desktop expanded and mobile sheet)
  const FilterPanelContent = () => (
    <div className="space-y-6">
        {/* SAVED FILTERS */}
        <FilterGroup title="Saved Filters" badge={savedFilters.length} defaultOpen={savedFilters.length > 0}>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input
                placeholder="Filter name..."
                value={newFilterName}
                onChange={(e) => setNewFilterName(e.target.value)}
                className="h-9 text-xs"
                maxLength={100}
              />
              <Button 
                size="sm" 
                onClick={saveCurrentFilter} 
                disabled={isSaving || !newFilterName.trim()}
                className="h-9"
              >
                Save
              </Button>
            </div>
            
            <div className="flex flex-wrap gap-2">
              {savedFilters.map((sf) => (
                <div key={sf.id} className="group relative">
                  <FilterChip
                    label={sf.name}
                    active={false}
                    onClick={() => applySavedFilter(sf.payload)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteSavedFilter(sf.id)
                    }}
                    className="absolute -top-1 -right-1 p-0.5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="size-2" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </FilterGroup>

        {/* MODE (AND/OR) */}
        <FilterGroup title="Match Mode" badge={0} defaultOpen>
          <div className="flex p-1 bg-zinc-100 dark:bg-zinc-800 rounded-lg w-fit">
            <button
              onClick={() => updateFilter('mode', 'all')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-medium rounded-md transition-all",
                filters.mode === 'all' 
                  ? "bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50" 
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              All (AND)
            </button>
            <button
              onClick={() => updateFilter('mode', 'any')}
              className={cn(
                "px-3 py-1.5 text-[10px] font-medium rounded-md transition-all",
                filters.mode === 'any' 
                  ? "bg-white dark:bg-zinc-700 shadow-sm text-zinc-900 dark:text-zinc-50" 
                  : "text-zinc-500 hover:text-zinc-700"
              )}
            >
              Any (OR)
            </button>
          </div>
          <p className="text-[10px] text-zinc-500 mt-2 px-1">
            {filters.mode === 'all' 
              ? "Series must match ALL selected genres and tags." 
              : "Series can match ANY of the selected genres and tags."}
          </p>
        </FilterGroup>

        {/* TYPE */}

      <FilterGroup title="Type" badge={filters.types.length} defaultOpen>
        <FilterSection>
          {SERIES_TYPES.filter(t => t.value !== 'all').map((type) => (
            <FilterChip
              key={type.value}
              label={type.label}
              active={filters.types.includes(type.value)}
              onClick={() => {
                if (filters.types.includes(type.value)) {
                  updateFilter('types', filters.types.filter(t => t !== type.value))
                } else {
                  updateFilter('types', [...filters.types, type.value])
                }
              }}
              onRemove={() => updateFilter('types', filters.types.filter(t => t !== type.value))}
            />
          ))}
        </FilterSection>
      </FilterGroup>

      {/* GENRE */}
      <FilterGroup title="Genre" badge={filters.genres.length}>
        <MultiSelect
          options={GENRES}
          selected={filters.genres}
          onChange={(values) => updateFilter('genres', values)}
          placeholder="Select genres..."
          searchPlaceholder="Search genres..."
          className="w-full"
        />
      </FilterGroup>

      {/* THEMES / TAGS */}
      <FilterGroup title="Themes & Tags" badge={filters.themes.length} defaultOpen={false}>
        <MultiSelect
          options={THEMES}
          selected={filters.themes}
          onChange={(values) => updateFilter('themes', values)}
          placeholder="Select themes..."
          searchPlaceholder="Search themes..."
          className="w-full"
        />
      </FilterGroup>

      {/* CONTENT WARNINGS */}
      <FilterGroup 
        title="Content Warnings" 
        badge={filters.excludeContentWarnings.length + filters.includeContentWarnings.length}
        defaultOpen={false}
      >
        <TriStateMultiSelect
          options={CONTENT_WARNINGS}
          included={filters.includeContentWarnings}
          excluded={filters.excludeContentWarnings}
          onIncludedChange={(values) => updateFilter('includeContentWarnings', values)}
          onExcludedChange={(values) => updateFilter('excludeContentWarnings', values)}
          placeholder="Filter content warnings..."
          className="w-full"
        />
      </FilterGroup>

      {/* STATUS */}
      <FilterGroup title="Publication Status" badge={filters.status !== 'all' ? 1 : 0}>
        <FilterSection>
          {PUBLICATION_STATUS.map((status) => (
            <FilterChip
              key={status.value}
              label={status.label}
              active={filters.status === status.value}
              onClick={() => updateFilter('status', status.value)}
            />
          ))}
        </FilterSection>
      </FilterGroup>

      {/* CONTENT RATING */}
      <FilterGroup title="Content Rating" badge={filters.contentRating !== 'all' ? 1 : 0}>
        <FilterSection>
          {CONTENT_RATINGS.map((rating) => (
            <FilterChip
              key={rating.value}
              label={rating.label}
              active={filters.contentRating === rating.value}
              onClick={() => updateFilter('contentRating', rating.value)}
            />
          ))}
        </FilterSection>
      </FilterGroup>

      {/* RELEASE PERIOD */}
      <FilterGroup title="Release Period" badge={filters.releasePeriod !== 'all' ? 1 : 0} defaultOpen={false}>
        <FilterSection>
          {RELEASE_PERIODS.map((period) => (
            <FilterChip
              key={period.value}
              label={period.label}
              active={filters.releasePeriod === period.value}
              onClick={() => updateFilter('releasePeriod', period.value)}
            />
          ))}
        </FilterSection>
        {filters.releasePeriod === 'custom' && (
          <div className="flex gap-2 mt-2">
            <Input
              type="date"
              value={filters.releaseDateFrom || ''}
              onChange={(e) => updateFilter('releaseDateFrom', e.target.value || null)}
              className="h-9 text-xs"
              placeholder="From"
            />
            <Input
              type="date"
              value={filters.releaseDateTo || ''}
              onChange={(e) => updateFilter('releaseDateTo', e.target.value || null)}
              className="h-9 text-xs"
              placeholder="To"
            />
          </div>
        )}
      </FilterGroup>

      {/* SOURCE */}
      <FilterGroup title="Readable On" badge={filters.source !== 'all' ? 1 : 0} defaultOpen={false}>
        <FilterSection>
          {SOURCES.map((source) => (
            <FilterChip
              key={source.value}
              label={source.label}
              active={filters.source === source.value}
              onClick={() => updateFilter('source', source.value)}
            />
          ))}
        </FilterSection>
      </FilterGroup>

      {/* LANGUAGE */}
      <FilterGroup 
        title="Language" 
        badge={(filters.originalLanguage !== 'all' ? 1 : 0) + (filters.translatedLanguage !== 'all' ? 1 : 0)}
        defaultOpen={false}
      >
        <div className="space-y-3">
          <div>
            <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1 block">
              Original Language
            </label>
            <Select value={filters.originalLanguage} onValueChange={(v) => updateFilter('originalLanguage', v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ORIGINAL_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value} className="text-xs">
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1 block">
              Translated To
            </label>
            <Select value={filters.translatedLanguage} onValueChange={(v) => updateFilter('translatedLanguage', v)}>
              <SelectTrigger className="h-9 text-xs rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TRANSLATED_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.value} value={lang.value} className="text-xs">
                    {lang.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </FilterGroup>

      {/* CHAPTER COUNT */}
      <FilterGroup title="Chapter Count" badge={filters.chapterCount !== '0' ? 1 : 0} defaultOpen={false}>
        <FilterSection>
          {CHAPTER_COUNTS.map((count) => (
            <FilterChip
              key={count.value}
              label={count.label}
              active={filters.chapterCount === count.value}
              onClick={() => updateFilter('chapterCount', count.value)}
            />
          ))}
        </FilterSection>
      </FilterGroup>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Search and Quick Filters Row */}
      <div className="flex flex-col lg:flex-row gap-4">
        {/* Search Input */}
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <Input
            value={filters.query}
            onChange={(e) => updateFilter('query', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="Search titles, descriptions..."
            className="h-11 pl-11 pr-10 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 transition-all"
            maxLength={200}
          />
          {filters.query && (
            <button
              onClick={() => updateFilter('query', '')}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="size-3 text-zinc-400" />
            </button>
          )}
        </div>

        {/* Sort and Actions */}
        <div className="flex items-center gap-3">
          <Select value={filters.sort} onValueChange={(v) => updateFilter('sort', v)}>
            <SelectTrigger className="w-[160px] h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              {SORT_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Desktop: Expand/Collapse Button */}
          <Button
            variant="outline"
            onClick={() => setIsExpanded(!isExpanded)}
            className="hidden lg:flex h-11 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 gap-2"
          >
            <SlidersHorizontal className="size-4" />
            Filters
            {activeFilterCount > 0 && (
              <Badge className="ml-1 h-5 px-1.5 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
            {isExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
          </Button>

          {/* Mobile: Sheet Trigger */}
          <Sheet open={isMobileOpen} onOpenChange={setIsMobileOpen}>
            <SheetTrigger asChild>
              <Button
                variant="outline"
                className="lg:hidden h-11 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 gap-2"
              >
                <SlidersHorizontal className="size-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge className="ml-1 h-5 px-1.5 text-[10px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center justify-between">
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={resetFilters}
                      className="text-red-500 hover:text-red-600"
                    >
                      <RotateCcw className="size-4 mr-1" />
                      Reset
                    </Button>
                  )}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-6">
                <FilterPanelContent />
              </div>
              <div className="sticky bottom-0 mt-6 pt-4 pb-2 bg-background border-t">
                <Button 
                  onClick={() => {
                    onSearch()
                    setIsMobileOpen(false)
                  }}
                  className="w-full h-11"
                  disabled={isLoading}
                >
                  {isLoading ? 'Searching...' : `Show Results${totalResults !== undefined ? ` (${totalResults})` : ''}`}
                </Button>
              </div>
            </SheetContent>
          </Sheet>

          {/* Reset Button */}
          {activeFilterCount > 0 && (
            <Button
              variant="ghost"
              onClick={resetFilters}
              className="h-11 px-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 rounded-xl"
            >
              <RotateCcw className="size-4 mr-2" />
              Reset
            </Button>
          )}
        </div>
      </div>

      {/* Active Filters Bar */}
      <ActiveFiltersBar
        filters={activeFilters}
        onRemove={removeFilter}
        onClearAll={resetFilters}
      />

      {/* Desktop Expanded Filter Panel */}
      {isExpanded && (
        <div className="hidden lg:block p-6 bg-zinc-50 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="grid grid-cols-2 xl:grid-cols-3 gap-6">
            <FilterPanelContent />
          </div>
        </div>
      )}
    </div>
  )
}
