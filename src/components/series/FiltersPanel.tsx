"use client"

import { useState, useCallback, useMemo, useEffect } from "react"
import { X, SlidersHorizontal, RotateCcw, ChevronDown, ChevronUp, Save, Bookmark, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { TriStateMultiSelect } from "@/components/ui/multi-select"
import { MultiSelectGrid } from "@/components/ui/multi-select-grid"
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
import { useMediaQuery } from "@/hooks/use-media-query"
import { createClient } from "@/lib/supabase/client"

// Accordion Section Component
interface AccordionSectionProps {
  title: string
  badge?: number
  defaultOpen?: boolean
  children: React.ReactNode
}

function AccordionSection({ title, badge, defaultOpen = false, children }: AccordionSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="border-b border-zinc-200 dark:border-zinc-800 last:border-b-0">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full py-4 text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</span>
          {badge !== undefined && badge > 0 && (
            <Badge className="h-5 px-1.5 text-[10px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
              {badge}
            </Badge>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="size-4 text-zinc-400" />
        ) : (
          <ChevronDown className="size-4 text-zinc-400" />
        )}
      </button>
      <div className={cn(
        "overflow-hidden transition-all duration-200",
        isOpen ? "max-h-[1000px] pb-4" : "max-h-0"
      )}>
        {children}
      </div>
    </div>
  )
}

// Filter Chip Component
interface FilterChipProps {
  label: string
  active?: boolean
  disabled?: boolean
  tooltip?: string
  onClick?: () => void
}

function FilterChip({ label, active = false, disabled = false, tooltip, onClick }: FilterChipProps) {
  const chip = (
    <button
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={cn(
        "px-3 py-1.5 text-xs font-medium rounded-full transition-all",
        disabled
          ? "bg-zinc-100 dark:bg-zinc-800/50 text-zinc-400 dark:text-zinc-600 cursor-not-allowed opacity-60"
          : active
            ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
            : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700"
      )}
    >
      {label}
    </button>
  )

  if (disabled && tooltip) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          {chip}
        </TooltipTrigger>
        <TooltipContent>
          <p className="text-xs">{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  return chip
}

interface FiltersPanelProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  onApply: (filters: FilterState) => void  // Now receives the new filters
  isLoading?: boolean
  totalResults?: number
}

export function FiltersPanel({
  filters,
  onFiltersChange,
  onApply,
  isLoading = false,
  totalResults,
}: FiltersPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pendingFilters, setPendingFilters] = useState<FilterState>(filters)
  const [savedPresets, setSavedPresets] = useState<any[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const isMobile = useMediaQuery("(max-width: 768px)")
  const supabase = createClient()

  useEffect(() => {
    setPendingFilters(filters)
  }, [filters])

  useEffect(() => {
    const loadPresets = async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('saved_filters')
        .select('*')
        .order('created_at', { ascending: false })
      if (data) setSavedPresets(data)
    }
    loadPresets()
  }, [supabase])

  const activeFilterCount = useMemo(() => countActiveFilters(filters), [filters])
  const pendingFilterCount = useMemo(() => countActiveFilters(pendingFilters), [pendingFilters])

  const updatePendingFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setPendingFilters(prev => ({ ...prev, [key]: value }))
  }, [])

  const handleApply = useCallback(() => {
    // Update filters state first
    onFiltersChange(pendingFilters)
    // Call onApply with the new filters (so caller can use them immediately)
    onApply(pendingFilters)
    setIsOpen(false)
  }, [pendingFilters, onFiltersChange, onApply])

  const handleReset = useCallback(() => {
    setPendingFilters(DEFAULT_FILTER_STATE)
  }, [])

  const handleSavePreset = async () => {
    const name = prompt("Enter a name for this preset:")
    if (!name) return
    setIsSaving(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error("Not authenticated")
      const { data, error } = await supabase
        .from('saved_filters')
        .insert([{ user_id: user.id, name, filter_payload: pendingFilters }])
        .select()
        .single()
      if (error) throw error
      setSavedPresets([data, ...savedPresets])
    } catch (e) {
      console.error("Failed to save preset:", e)
    } finally {
      setIsSaving(false)
    }
  }

  const handleDeletePreset = async (id: string) => {
    try {
      await supabase.from('saved_filters').delete().eq('id', id)
      setSavedPresets(savedPresets.filter(p => p.id !== id))
    } catch (e) {
      console.error("Failed to delete preset:", e)
    }
  }

  const FilterContent = () => (
    <TooltipProvider>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto px-1">
          {savedPresets.length > 0 && (
            <AccordionSection title="Saved Presets" badge={savedPresets.length}>
              <div className="grid grid-cols-1 gap-2">
                {savedPresets.map((preset) => (
                  <div key={preset.id} className="flex items-center gap-2 group">
                    <button
                      onClick={() => setPendingFilters(preset.filter_payload)}
                      className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 text-left transition-all"
                    >
                      <Bookmark className="size-3 text-zinc-400" />
                      <span className="text-xs font-medium truncate">{preset.name}</span>
                    </button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeletePreset(preset.id)}
                      className="size-8 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-400 hover:text-red-500"
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </AccordionSection>
          )}

          <AccordionSection title="Sort By" defaultOpen={true}>
            <div className="flex flex-wrap gap-2">
              {SORT_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  label={option.label}
                  active={pendingFilters.sort === option.value}
                  onClick={() => updatePendingFilter('sort', option.value)}
                />
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Type" badge={pendingFilters.types.length} defaultOpen={true}>
            <div className="flex flex-wrap gap-2">
              {SERIES_TYPES.filter(t => t.value !== 'all').map((type) => (
                <FilterChip
                  key={type.value}
                  label={type.label}
                  active={pendingFilters.types.includes(type.value)}
                  onClick={() => {
                    if (pendingFilters.types.includes(type.value)) {
                      updatePendingFilter('types', pendingFilters.types.filter(t => t !== type.value))
                    } else {
                      updatePendingFilter('types', [...pendingFilters.types, type.value])
                    }
                  }}
                />
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Genre" badge={pendingFilters.genres.length} defaultOpen={true}>
            <MultiSelectGrid
              options={GENRES}
              selected={pendingFilters.genres}
              onChange={(values) => updatePendingFilter('genres', values)}
              columns={2}
            />
          </AccordionSection>

          <AccordionSection title="Themes & Tags" badge={pendingFilters.themes.length}>
            <MultiSelectGrid
              options={THEMES}
              selected={pendingFilters.themes}
              onChange={(values) => updatePendingFilter('themes', values)}
              columns={2}
            />
          </AccordionSection>

          <AccordionSection 
            title="Content Warnings" 
            badge={pendingFilters.excludeContentWarnings.length + pendingFilters.includeContentWarnings.length}
          >
            <TriStateMultiSelect
              options={CONTENT_WARNINGS}
              included={pendingFilters.includeContentWarnings}
              excluded={pendingFilters.excludeContentWarnings}
              onIncludedChange={(values) => updatePendingFilter('includeContentWarnings', values)}
              onExcludedChange={(values) => updatePendingFilter('excludeContentWarnings', values)}
              placeholder="Filter content warnings..."
              className="w-full rounded-lg"
            />
          </AccordionSection>

          <AccordionSection title="Publication Status" badge={pendingFilters.status !== 'all' ? 1 : 0}>
            <div className="flex flex-wrap gap-2">
              {PUBLICATION_STATUS.map((status) => (
                <FilterChip
                  key={status.value}
                  label={status.label}
                  active={pendingFilters.status === status.value}
                  onClick={() => updatePendingFilter('status', status.value)}
                />
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Content Rating" badge={pendingFilters.contentRating !== 'all' ? 1 : 0}>
            <div className="flex flex-wrap gap-2">
              {CONTENT_RATINGS.map((rating) => (
                <FilterChip
                  key={rating.value}
                  label={rating.label}
                  active={pendingFilters.contentRating === rating.value}
                  onClick={() => updatePendingFilter('contentRating', rating.value)}
                />
              ))}
            </div>
          </AccordionSection>

          <AccordionSection title="Release Period" badge={pendingFilters.releasePeriod !== 'all' ? 1 : 0}>
            <div className="flex flex-wrap gap-2">
              {RELEASE_PERIODS.map((period) => (
                <FilterChip
                  key={period.value}
                  label={period.label}
                  active={pendingFilters.releasePeriod === period.value}
                  onClick={() => updatePendingFilter('releasePeriod', period.value)}
                />
              ))}
            </div>
            {pendingFilters.releasePeriod === 'custom' && (
              <div className="flex gap-2 mt-3">
                <Input
                  type="date"
                  value={pendingFilters.releaseDateFrom || ''}
                  onChange={(e) => updatePendingFilter('releaseDateFrom', e.target.value || null)}
                  className="h-9 text-xs"
                />
                <Input
                  type="date"
                  value={pendingFilters.releaseDateTo || ''}
                  onChange={(e) => updatePendingFilter('releaseDateTo', e.target.value || null)}
                  className="h-9 text-xs"
                />
              </div>
            )}
          </AccordionSection>

          <AccordionSection title="Readable On" badge={pendingFilters.source !== 'all' ? 1 : 0}>
            <div className="flex flex-wrap gap-2">
              {SOURCES.map((source) => {
                const sourceObj = source as { value: string; label: string; disabled?: boolean; tooltip?: string }
                return (
                  <FilterChip
                    key={sourceObj.value}
                    label={sourceObj.label}
                    active={pendingFilters.source === sourceObj.value}
                    disabled={sourceObj.disabled ?? false}
                    tooltip={sourceObj.tooltip}
                    onClick={() => updatePendingFilter('source', sourceObj.value)}
                  />
                )
              })}
            </div>
          </AccordionSection>

          <AccordionSection 
            title="Language" 
            badge={(pendingFilters.originalLanguage !== 'all' ? 1 : 0) + (pendingFilters.translatedLanguage !== 'all' ? 1 : 0)}
          >
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5 block">Original Language</label>
                <Select value={pendingFilters.originalLanguage} onValueChange={(v) => updatePendingFilter('originalLanguage', v)}>
                  <SelectTrigger className="h-9 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {ORIGINAL_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value} className="text-xs">{lang.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5 block">Translated To</label>
                <Select value={pendingFilters.translatedLanguage} onValueChange={(v) => updatePendingFilter('translatedLanguage', v)}>
                  <SelectTrigger className="h-9 text-xs rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TRANSLATED_LANGUAGES.map((lang) => (
                      <SelectItem key={lang.value} value={lang.value} className="text-xs">{lang.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </AccordionSection>

          <AccordionSection title="Chapter Count" badge={pendingFilters.chapterCount !== '0' ? 1 : 0}>
            <div className="flex flex-wrap gap-2">
              {CHAPTER_COUNTS.map((count) => (
                <FilterChip
                  key={count.value}
                  label={count.label}
                  active={pendingFilters.chapterCount === count.value}
                  onClick={() => updatePendingFilter('chapterCount', count.value)}
                />
              ))}
            </div>
          </AccordionSection>
        </div>

        <div className="sticky bottom-0 p-4 bg-background border-t border-zinc-200 dark:border-zinc-800 space-y-3">
          <div className="flex gap-2">
            <Button 
              onClick={handleApply}
              className="flex-1 h-11 text-sm font-semibold"
              disabled={isLoading}
            >
              {isLoading ? 'Applying...' : `Apply${totalResults !== undefined ? ` (${totalResults})` : ''}`}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={handleSavePreset}
              className="size-11 rounded-lg"
              disabled={isSaving}
            >
              <Save className="size-4" />
            </Button>
          </div>
          {pendingFilterCount > 0 && (
            <Button 
              variant="ghost"
              onClick={handleReset}
              className="w-full h-10 text-sm text-zinc-500"
            >
              <RotateCcw className="size-4 mr-2" />
              Reset All
            </Button>
          )}
        </div>
      </div>
    </TooltipProvider>
  )

  const TriggerButton = (
    <Button
      variant="outline"
      className="h-11 px-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 gap-2"
    >
      <SlidersHorizontal className="size-4" />
      <span className="hidden sm:inline">Filters</span>
      {activeFilterCount > 0 && (
        <Badge className="h-5 px-1.5 text-[10px] bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
          {activeFilterCount}
        </Badge>
      )}
    </Button>
  )

  if (isMobile) {
    return (
      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerTrigger asChild>{TriggerButton}</DrawerTrigger>
        <DrawerContent className="h-[85vh] max-h-[85vh]">
          <DrawerHeader className="border-b border-zinc-200 dark:border-zinc-800 pb-4">
            <DrawerTitle className="flex items-center justify-between">
              <span className="text-lg font-bold">Filters</span>
              <Button variant="ghost" size="icon" onClick={() => setIsOpen(false)} className="size-8"><X className="size-4" /></Button>
            </DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 overflow-hidden"><FilterContent /></div>
        </DrawerContent>
      </Drawer>
    )
  }

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>{TriggerButton}</SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md p-0 flex flex-col">
        <SheetHeader className="p-6 pb-4 border-b border-zinc-200 dark:border-zinc-800">
          <SheetTitle>Filters</SheetTitle>
        </SheetHeader>
        <div className="flex-1 overflow-hidden p-6 pt-0"><FilterContent /></div>
      </SheetContent>
    </Sheet>
  )
}
