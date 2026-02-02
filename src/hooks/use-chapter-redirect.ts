"use client"

import { useState, useCallback } from "react"
import { toast } from "sonner"
import { selectBestSource, ChapterSource, SeriesSourcePreference, sortSourcesByPriority } from "@/lib/source-utils-shared"
import { updatePreferredSource, updateSeriesSourcePreference } from "@/lib/actions/series-actions"
import { SyncOutbox } from "@/lib/sync/outbox"

interface RedirectState {
  isOpen: boolean
  chapterNumber: number
  sources: ChapterSource[]
  libraryEntryId?: string | null
  seriesId?: string | null
  preferredSource?: string | null
  sourcePriorities?: string[]
  isRead?: boolean
  isChecking: boolean
}

// Session-level cache for failed URLs
const failedUrls = new Set<string>()

export function useChapterRedirect() {
  const [state, setState] = useState<RedirectState>({
    isOpen: false,
    chapterNumber: 0,
    sources: [],
    sourcePriorities: [],
    isChecking: false,
  })

  const openChapter = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer")
  }, [])

  /**
   * Checks if a URL is reachable via server-side proxy.
   * Uses session cache to avoid repeated checks of known failures.
   */
  const checkUrl = useCallback(async (url: string): Promise<boolean> => {
    if (failedUrls.has(url)) return false
    
    try {
      const res = await fetch(`/api/proxy/check-url?url=${encodeURIComponent(url)}`)
      const data = await res.json()
      
      if (!data.ok) {
        failedUrls.add(url)
        return false
      }
      return true
    } catch (error) {
      // Don't block user if our check API fails
      console.warn("Availability check failed to execute:", error)
      return true
    }
  }, [])

  /**
   * Handles chapter click with source selection and fallback logic.
   */
    const handleChapterClick = useCallback(async (
      chapter: { chapter_number: number; sources: ChapterSource[]; is_read?: boolean },
      preferences: {
        seriesId?: string | null
        libraryEntryId?: string | null
        preferredSourceSeries?: string | null
        preferredSourceGlobal?: string | null
        preferredSourcePriorities?: string[]
        seriesSources?: SeriesSourcePreference[]
      }
    ) => {
      const { sources, chapter_number, is_read = false } = chapter
      
      if (!sources || sources.length === 0) {
        toast.error("No sources found for this chapter.")
        return
      }

      const availableSources = sources.filter(s => s.is_available !== false)
      if (availableSources.length === 0) {
        toast.error("No available sources found for this chapter.")
        return
      }

      // Sort all sources by priority so we know the order to try
      const sortedSources = sortSourcesByPriority(availableSources, {
        preferredSourceSeries: preferences.preferredSourceSeries,
        preferredSourcePriorities: preferences.preferredSourcePriorities,
      })

      // If we have a preference that matches, we start the fallback loop
      // Otherwise, we show the selection modal as before
      const { reason } = selectBestSource(
        availableSources,
        preferences.seriesSources || [],
        {
          preferredSourceSeries: preferences.preferredSourceSeries,
          preferredSourceGlobal: preferences.preferredSourceGlobal,
          preferredSourcePriorities: preferences.preferredSourcePriorities,
        }
      )

      const hasPreferenceMatch = reason === 'preferred_series' || reason === 'priority_list' || reason === 'preferred_global'

      if (hasPreferenceMatch || availableSources.length === 1) {
        setState(prev => ({ ...prev, isChecking: true }))
        
        // Fallback Loop: Try sources in priority order
          for (const source of sortedSources) {
            // Skip if already known to be failed in this session
            if (failedUrls.has(source.chapter_url)) continue

            const isWorking = await checkUrl(source.chapter_url)
            if (isWorking) {
              // Record read intent (Offline Sync v2.2.0)
              if (preferences.libraryEntryId) {
                SyncOutbox.enqueue('CHAPTER_READ', {
                  entryId: preferences.libraryEntryId,
                  chapterNumber: chapter_number,
                  sourceId: source.source_name
                })
              }

              openChapter(source.chapter_url)
              setState(prev => ({ ...prev, isChecking: false }))
              return
            }
            // If not working, silently continue to next source (RULE 2 & 3)
          }

        setState(prev => ({ ...prev, isChecking: false }))
        
        // If all sources failed
        toast.error("All available sources seem to be down.", {
          description: "Would you like to try the preferred source anyway?",
          action: {
            label: "Retry",
            onClick: () => {
              // Clear failures for this chapter's sources and retry the first one
              sortedSources.forEach(s => failedUrls.delete(s.chapter_url))
              openChapter(sortedSources[0].chapter_url)
            }
          }
        })
        return
      }

      // No preference match -> show source selection modal
      setState({
        isOpen: true,
        chapterNumber: chapter_number,
        sources: availableSources,
        libraryEntryId: preferences.libraryEntryId,
        seriesId: preferences.seriesId,
        preferredSource: preferences.preferredSourceSeries,
        sourcePriorities: preferences.preferredSourcePriorities || [],
        isRead: is_read,
        isChecking: false,
      })
    }, [openChapter, checkUrl])

  /**
   * Handles source selection from the modal.
   */
  const handleSourceSelect = useCallback(async (source: ChapterSource, alwaysUse: boolean) => {
    // For manual selection, we just open it (user choice override)
    // Record read intent (Offline Sync v2.2.0)
    if (state.libraryEntryId) {
      SyncOutbox.enqueue('CHAPTER_READ', {
        entryId: state.libraryEntryId,
        chapterNumber: state.chapterNumber,
        sourceId: source.source_name
      })
    }

    openChapter(source.chapter_url)
    setState(prev => ({ ...prev, isOpen: false }))

    if (alwaysUse) {
      try {
        if (state.libraryEntryId) {
          await updatePreferredSource(state.libraryEntryId, source.source_name)
        } else if (state.seriesId) {
          await updateSeriesSourcePreference(state.seriesId, source.source_name)
        }
        toast.success(`${source.source_name} saved as preferred source for this series`)
      } catch (error) {
        console.error("Failed to save preference:", error)
      }
    }
  }, [state.libraryEntryId, state.seriesId, state.chapterNumber, openChapter])

  const setOpen = useCallback((open: boolean) => {
    setState(prev => ({ ...prev, isOpen: open }))
  }, [])

  return {
    state,
    handleChapterClick,
    handleSourceSelect,
    setOpen,
  }
}
