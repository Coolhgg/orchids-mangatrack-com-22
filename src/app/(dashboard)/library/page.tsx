"use client"

import { useState, useEffect, useCallback, memo, Suspense, useRef, Component, ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { Plus, Search, Grid2X2, List as ListIcon, BookOpen, Star, ArrowUpDown, AlertCircle, FileText, Loader2, Wrench, HelpCircle, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useRouter, useSearchParams } from "next/navigation"
import { useDebounce, useIntersectionObserver } from "@/hooks/use-performance"
import { toast } from "sonner"
import { NSFWCover } from "@/components/ui/nsfw-cover"
import { CSVImport } from "@/components/library/CSVImport"
import { MetadataManualFixDialog } from "@/components/series/MetadataManualFixDialog"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface LibraryEntry {
  id: string
  series_id: string
  status: string
  metadata_status: 'pending' | 'enriched' | 'unavailable' | 'failed'
  // Bug 9: Add sync_status for UX clarity
  sync_status: 'healthy' | 'degraded' | 'failed'
  needs_review: boolean
  source_url: string
  imported_title: string | null
  last_read_chapter: number | null
  user_rating: number | null
  updated_at: string
  last_sync_at: string | null
  series: {
    id: string
    title: string
    cover_url: string | null
    type: string
    status: string
    content_rating: string | null
  } | null
}

interface LibraryStats {
  all: number
  reading: number
  completed: number
  planning: number
  dropped: number
  paused: number
}

function LibrarySkeleton({ viewMode }: { viewMode: "grid" | "list" }) {
  if (viewMode === "list") {
    return (
      <div className="space-y-3">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800">
            <Skeleton className="size-16 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {[...Array(12)].map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[3/4] rounded-2xl" />
          <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

// Bug 9: Sync status indicator component
const SyncStatusIndicator = memo(function SyncStatusIndicator({ 
  syncStatus, 
  metadataStatus,
  className = "" 
}: { 
  syncStatus: 'healthy' | 'degraded' | 'failed'
  metadataStatus: 'pending' | 'enriched' | 'unavailable' | 'failed'
  className?: string
}) {
  // If both are good, show nothing (clean UI)
  if (syncStatus === 'healthy' && metadataStatus === 'enriched') {
    return null;
  }

  // Show combined status indicator
  const syncHealthy = syncStatus === 'healthy';
  const metadataHealthy = metadataStatus === 'enriched';

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div className={`flex items-center gap-1 ${className}`}>
            {/* Sync status icon */}
            {syncHealthy ? (
              <CheckCircle2 className="size-3 text-green-500" />
            ) : syncStatus === 'degraded' ? (
              <AlertTriangle className="size-3 text-amber-500" />
            ) : (
              <AlertCircle className="size-3 text-red-500" />
            )}
            {/* Metadata status icon - only show if different from sync */}
            {!metadataHealthy && metadataStatus !== 'pending' && (
              <span className="text-[10px] text-zinc-400">•</span>
            )}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-[220px]">
          <div className="space-y-1.5 text-xs">
            <div className="flex items-center gap-2">
              {syncHealthy ? (
                <CheckCircle2 className="size-3 text-green-500 shrink-0" />
              ) : syncStatus === 'degraded' ? (
                <AlertTriangle className="size-3 text-amber-500 shrink-0" />
              ) : (
                <AlertCircle className="size-3 text-red-500 shrink-0" />
              )}
              <span>
                Chapters: {syncHealthy ? 'Syncing' : syncStatus === 'degraded' ? 'Delayed' : 'Failed'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {metadataHealthy ? (
                <CheckCircle2 className="size-3 text-green-500 shrink-0" />
              ) : metadataStatus === 'pending' ? (
                <RefreshCw className="size-3 text-blue-500 shrink-0 animate-spin" />
              ) : metadataStatus === 'unavailable' ? (
                <HelpCircle className="size-3 text-zinc-400 shrink-0" />
              ) : (
                <AlertCircle className="size-3 text-red-500 shrink-0" />
              )}
              <span>
                Metadata: {
                  metadataHealthy ? 'Linked' : 
                  metadataStatus === 'pending' ? 'Searching...' :
                  metadataStatus === 'unavailable' ? 'Not found' : 'Failed'
                }
              </span>
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
});

// Memoized grid item for performance
const LibraryGridItem = memo(function LibraryGridItem({ entry, onFix }: { entry: LibraryEntry, onFix: (entry: LibraryEntry) => void }) {
  return (
    <div className="group relative space-y-3">
      <Link href={entry.series_id ? `/series/${entry.series_id}` : "#"} className={`block relative ${!entry.series_id && 'cursor-default'}`} onClick={(e) => !entry.series_id && e.preventDefault()}>
        <div className="overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all group-hover:ring-2 group-hover:ring-zinc-900 dark:group-hover:ring-zinc-50 relative shadow-sm group-hover:shadow-md">
          <NSFWCover
            src={entry.series?.cover_url}
            alt={entry.series?.title || entry.imported_title || "Series cover"}
            contentRating={entry.series?.content_rating}
            className="transition-transform duration-500 group-hover:scale-110"
            size="512"
          />
          <div className="absolute top-2 right-2 bg-zinc-900/80 backdrop-blur-md text-zinc-50 text-[10px] font-bold px-2 py-1 rounded-lg flex items-center gap-1.5">
            <span>CH {entry.last_read_chapter || 0}</span>
            {/* Bug 9: Show sync status indicator in corner */}
            <SyncStatusIndicator 
              syncStatus={entry.sync_status || 'healthy'} 
              metadataStatus={entry.metadata_status}
            />
          </div>
          {entry.needs_review && (
            <Badge variant="default" className="absolute top-2 left-2 text-[10px] bg-amber-500 hover:bg-amber-600 text-white border-none shadow-lg animate-pulse">
              Review
            </Badge>
          )}
          {entry.metadata_status === 'failed' && !entry.needs_review && (
            <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-red-900/50 text-red-100 border-red-700 backdrop-blur-sm">
              Metadata Failed
            </Badge>
          )}
          {entry.metadata_status === 'unavailable' && !entry.needs_review && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-zinc-900/50 text-zinc-300 border-zinc-600 backdrop-blur-sm cursor-help">
                    <HelpCircle className="size-2 mr-1" />
                    No Metadata
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[200px]">
                  <p className="text-xs">Metadata unavailable on MangaDex. Chapters still sync normally. Click to manually link.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {entry.metadata_status === 'pending' && !entry.needs_review && (
            <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-zinc-900/50 text-zinc-300 border-zinc-700 backdrop-blur-sm">
              <Loader2 className="size-2 mr-1 animate-spin" />
              Enriching...
            </Badge>
          )}
          
          {/* Bug 9: Show sync failure badge if sync is failing but metadata is fine */}
          {entry.sync_status === 'failed' && entry.metadata_status === 'enriched' && (
            <Badge variant="outline" className="absolute top-2 left-2 text-[10px] bg-red-900/50 text-red-100 border-red-700 backdrop-blur-sm">
              <AlertTriangle className="size-2 mr-1" />
              Sync Failed
            </Badge>
          )}
          
          {(entry.metadata_status === 'failed' || entry.metadata_status === 'unavailable' || entry.needs_review) && (
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/40 backdrop-blur-[2px] z-20">
              <Button 
                size="sm" 
                variant="secondary" 
                className="rounded-full font-black uppercase italic tracking-widest text-[10px] h-8"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onFix(entry);
                }}
              >
                {entry.metadata_status === 'unavailable' ? 'Link Metadata' : 'Fix Metadata'}
              </Button>
            </div>
          )}

          <Badge
            className={`absolute bottom-2 left-2 text-[10px] rounded-lg ${
              entry.status === "reading"
                ? "bg-green-500 hover:bg-green-600"
                : entry.status === "completed"
                  ? "bg-blue-500 hover:bg-blue-600"
                  : entry.status === "planning"
                    ? "bg-amber-500 hover:bg-amber-600"
                    : "bg-zinc-500 hover:bg-zinc-600"
            }`}
          >
            {entry.status}
          </Badge>
        </div>
      </Link>
      <div className="space-y-1 px-1">
        <h3 className="font-bold text-sm leading-tight truncate">{entry.series?.title || entry.imported_title}</h3>
        <div className="flex items-center gap-2 text-[10px] text-zinc-500 dark:text-zinc-400 font-medium">
          <span className="capitalize">{entry.series?.type || 'Unknown'}</span>
          {entry.user_rating && (
            <span className="flex items-center gap-0.5">
              <Star className="size-3 fill-yellow-500 text-yellow-500" />
              {entry.user_rating}
            </span>
          )}
        </div>
      </div>
    </div>
  )
})

// Memoized list item for performance
const LibraryListItem = memo(function LibraryListItem({ entry, onFix }: { entry: LibraryEntry, onFix: (entry: LibraryEntry) => void }) {
  return (
    <div
      className="flex items-center gap-4 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors group"
    >
      <Link href={entry.series_id ? `/series/${entry.series_id}` : "#"} className="size-16 rounded-xl overflow-hidden shrink-0 bg-zinc-100 dark:bg-zinc-800">
        <NSFWCover
          src={entry.series?.cover_url}
          alt={entry.series?.title || entry.imported_title || "Series cover"}
          contentRating={entry.series?.content_rating}
          aspectRatio="aspect-square"
          showBadge={false}
          size="256"
        />
      </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Link href={entry.series_id ? `/series/${entry.series_id}` : "#"} className="font-bold text-sm truncate group-hover:text-zinc-900 dark:group-hover:text-zinc-50">
              {entry.series?.title || entry.imported_title}
            </Link>
            {/* Bug 9: Show sync status indicator in list view */}
            <SyncStatusIndicator 
              syncStatus={entry.sync_status || 'healthy'} 
              metadataStatus={entry.metadata_status}
            />
            {entry.needs_review && (
              <Badge variant="default" className="text-[10px] bg-amber-500 text-white h-5 px-1.5 py-0">
                Review Needed
              </Badge>
            )}
            {entry.metadata_status === 'failed' && !entry.needs_review && (
              <Badge variant="outline" className="text-[10px] bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 h-5 px-1.5 py-0">
                Metadata Failed
              </Badge>
            )}
            {entry.metadata_status === 'unavailable' && !entry.needs_review && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 h-5 px-1.5 py-0 cursor-help">
                      <HelpCircle className="size-2 mr-1" />
                      No Metadata
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-[200px]">
                    <p className="text-xs">Metadata unavailable on MangaDex. Chapters still sync normally.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
            {entry.metadata_status === 'pending' && !entry.needs_review && (
              <Badge variant="outline" className="text-[10px] bg-zinc-100 dark:bg-zinc-800 text-zinc-500 border-zinc-200 dark:border-zinc-700 h-5 px-1.5 py-0">
                <Loader2 className="size-2 mr-1 animate-spin" />
                Enriching...
              </Badge>
            )}
            {/* Bug 9: Show sync failure in list view */}
            {entry.sync_status === 'failed' && entry.metadata_status === 'enriched' && (
              <Badge variant="outline" className="text-[10px] bg-red-50 dark:bg-red-950/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-900 h-5 px-1.5 py-0">
                <AlertTriangle className="size-2 mr-1" />
                Sync Failed
              </Badge>
            )}
          </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500 mt-1">
          <span className="capitalize">{entry.series?.type || 'Unknown'}</span>
          <span>Chapter {entry.last_read_chapter || 0}</span>
          {entry.user_rating && (
            <span className="flex items-center gap-0.5">
              <Star className="size-3 fill-yellow-500 text-yellow-500" />
              {entry.user_rating}
            </span>
          )}
        </div>
      </div>
      
      {(entry.metadata_status === 'failed' || entry.metadata_status === 'unavailable' || entry.needs_review) && (
        <Button 
          size="sm" 
          variant="outline" 
          className="rounded-xl font-black uppercase italic tracking-widest text-[10px] h-8 gap-2"
          onClick={() => onFix(entry)}
        >
          <Wrench className="size-3" />
          {entry.metadata_status === 'unavailable' ? 'Link' : 'Fix'}
        </Button>
      )}

      <Badge
        className={`text-[10px] rounded-full ${
          entry.status === "reading"
            ? "bg-green-500 hover:bg-green-600"
            : entry.status === "completed"
              ? "bg-blue-500 hover:bg-blue-600"
              : entry.status === "planning"
                ? "bg-amber-500 hover:bg-amber-600"
                : "bg-zinc-500 hover:bg-zinc-600"
        }`}
      >
        {entry.status}
      </Badge>
    </div>
  )
})

function LibraryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const [entries, setEntries] = useState<LibraryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid")
  const [searchQuery, setSearchQuery] = useState(searchParams.get("q") || "")
  const [filterStatus, setFilterStatus] = useState(searchParams.get("status") || "all")
    const [sortBy, setSortBy] = useState(searchParams.get("sort") || "latest_chapter")
    
    // Manual Fix state
    const [fixEntry, setFixEntry] = useState<LibraryEntry | null>(null)
    
    // Pagination and Guarding state
    const isFetching = useRef(false)
    const abortControllerRef = useRef<AbortController | null>(null)
    const offsetRef = useRef(0)
    const [offset, setOffset] = useState(0)
    const [hasMore, setHasMore] = useState(false)
    const [stats, setStats] = useState<LibraryStats>({
      all: 0,
      reading: 0,
      completed: 0,
      planning: 0,
      dropped: 0,
      paused: 0
    })

    // Debounce search query for performance
    const debouncedSearchQuery = useDebounce(searchQuery, 300)

      const fetchLibrary = useCallback(async (isInitial = true) => {
        // Cancel previous request if it's initial (filter change)
        if (isInitial && abortControllerRef.current) {
          // Provide a reason to prevent "signal is aborted without reason" console error
          abortControllerRef.current.abort("Filter changed - cancelling previous request");
        }

        if (isFetching.current && !isInitial) return;
        
        const currentOffset = isInitial ? 0 : offsetRef.current;

        if (isInitial) {
          setLoading(true);
          // Create new AbortController for initial fetch
          abortControllerRef.current = new AbortController();
        } else {
          setLoadingMore(true);
        }
        
        isFetching.current = true;
        setError(null);
        try {
          const params = new URLSearchParams();
          if (debouncedSearchQuery) params.set("q", debouncedSearchQuery);
          if (filterStatus && filterStatus !== "all") params.set("status", filterStatus);
          if (sortBy) params.set("sort", sortBy);
          params.set("limit", "100");
          params.set("offset", currentOffset.toString());

          const res = await fetch(`/api/library?${params.toString()}`, {
              signal: isInitial ? abortControllerRef.current?.signal : undefined,
              credentials: 'include',
            });

          if (res.ok) {
            const data = await res.json();

          
          setEntries(prev => {
            if (isInitial) return data.entries || []
            
            // Robust duplicate prevention
            const existingIds = new Set(prev.map(e => e.id))
            const newEntries = (data.entries || []).filter((e: LibraryEntry) => !existingIds.has(e.id))
            return [...prev, ...newEntries]
          })
          
          if (data.stats) {
            setStats(data.stats)
          }
          
          const nextHasMore = data.pagination?.hasMore || false
          setHasMore(nextHasMore)
          
          const newOffset = isInitial ? (data.entries?.length || 0) : offsetRef.current + (data.entries?.length || 0)
          offsetRef.current = newOffset
          setOffset(newOffset)
        } else if (res.status === 401) {
          setError("Please sign in to view your library")
        } else {
          setError("Failed to load library")
        }
      } catch (err) {
        // Don't show error for intentional aborts (filter changes or component unmounting)
        // When abort() is called with a string reason, the rejection value is the string itself
        if (typeof err === 'string') {
          // String abort reasons we use: "Filter changed", "Component unmounting"
          return;
        }
        if (err instanceof Error && (err.name === 'AbortError' || err.message?.includes('abort') || err.message?.includes('cancel'))) {
          // Request was intentionally cancelled, do nothing
          return;
        }
        // Also check if signal was aborted (handles DOMException cases)
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        // Final check - if signal is aborted, don't show error
        if (abortControllerRef.current?.signal.aborted) {
          return;
        }
        console.error("Failed to fetch library:", err)
        setError("Something went wrong. Please try again.")
        toast.error("Failed to load library")
      } finally {
        isFetching.current = false
        if (isInitial) setLoading(false)
        else setLoadingMore(false)
      }
    }, [debouncedSearchQuery, filterStatus, sortBy])

    useEffect(() => {
      offsetRef.current = 0
      setOffset(0)
      fetchLibrary(true)
      
      return () => {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort("Component unmounting");
          abortControllerRef.current = null;
        }
      };
    }, [debouncedSearchQuery, filterStatus, sortBy, fetchLibrary])

    // Infinite scroll observer
    const { setRef, isIntersecting } = useIntersectionObserver({
      threshold: 0.1,
      rootMargin: '200px', // Increased margin for smoother loading
    })

    useEffect(() => {
      if (isIntersecting && hasMore && !loading && !loadingMore && !isFetching.current) {
        fetchLibrary(false)
      }
    }, [isIntersecting, hasMore, loading, loadingMore, fetchLibrary])


  const handleSearch = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    const params = new URLSearchParams()
    if (searchQuery) params.set("q", searchQuery)
    if (filterStatus !== "all") params.set("status", filterStatus)
    if (sortBy !== "latest_chapter") params.set("sort", sortBy)
    router.push(`/library?${params.toString()}`)
  }, [searchQuery, filterStatus, sortBy, router])

  const handleStatusChange = useCallback((status: string) => {
    setFilterStatus(status)
    const params = new URLSearchParams()
    if (searchQuery) params.set("q", searchQuery)
    if (status !== "all") params.set("status", status)
    if (sortBy !== "latest_chapter") params.set("sort", sortBy)
    router.push(`/library?${params.toString()}`)
  }, [searchQuery, sortBy, router])

  if (error) {
    return (
      <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Library</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Manage your reading progress and updates</p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
            <AlertCircle className="size-10 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">{error}</h3>
              <Button onClick={() => fetchLibrary(true)} variant="outline" className="rounded-full">
              Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Library</h1>
          <p className="text-zinc-500 dark:text-zinc-400">Manage your reading progress and updates</p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" className="rounded-full px-6 border-zinc-200 dark:border-zinc-800">
                <FileText className="size-4 mr-2 text-zinc-500" />
                Import CSV
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md rounded-3xl">
              <DialogHeader>
                <DialogTitle>Import from CSV</DialogTitle>
                <DialogDescription>
                  Upload a CSV file to import your reading progress from other platforms.
                </DialogDescription>
              </DialogHeader>
                <CSVImport onComplete={() => fetchLibrary(true)} />
            </DialogContent>
          </Dialog>

          <Link href="/discover">
            <Button className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-full px-6">
              <Plus className="size-4 mr-2" />
              Add Series
            </Button>
          </Link>
        </div>

      </div>

      <div className="flex flex-col md:flex-row items-center justify-between gap-4 bg-zinc-50 dark:bg-zinc-900/50 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-800 shadow-sm">
        <form onSubmit={handleSearch} className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search library..."
              className="pl-10 bg-white dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 rounded-xl h-11"
            />
          </div>
          <Button type="submit" variant="secondary" className="rounded-xl h-11">
            Search
          </Button>
        </form>

        <div className="flex items-center gap-4 w-full md:w-auto overflow-x-auto pb-2 md:pb-0">
            <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl border border-zinc-200 dark:border-zinc-700">
              <Button
                variant={filterStatus === "all" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-lg text-xs h-8 px-3"
                onClick={() => handleStatusChange("all")}
              >
                All ({stats.all})
              </Button>
              <Button
                variant={filterStatus === "reading" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-lg text-xs h-8 px-3"
                onClick={() => handleStatusChange("reading")}
              >
                Reading ({stats.reading})
              </Button>
              <Button
                variant={filterStatus === "completed" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-lg text-xs h-8 px-3"
                onClick={() => handleStatusChange("completed")}
              >
                Done ({stats.completed})
              </Button>
              <Button
                variant={filterStatus === "planning" ? "secondary" : "ghost"}
                size="sm"
                className="rounded-lg text-xs h-8 px-3"
                onClick={() => handleStatusChange("planning")}
              >
                Plan ({stats.planning})
              </Button>
            </div>


            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-[140px] h-8 rounded-lg text-xs border-zinc-200 dark:border-zinc-700">
                <ArrowUpDown className="size-3 mr-1" />
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="latest_chapter">Latest Chapter</SelectItem>
                <SelectItem value="updated">Last Activity</SelectItem>
                <SelectItem value="title">Title</SelectItem>
                <SelectItem value="rating">Rating</SelectItem>
                <SelectItem value="added">Date Added</SelectItem>
              </SelectContent>
            </Select>

          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-xl border border-zinc-200 dark:border-zinc-700 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              className={`size-8 rounded-lg ${viewMode === "grid" ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500"}`}
              onClick={() => setViewMode("grid")}
            >
              <Grid2X2 className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={`size-8 rounded-lg ${viewMode === "list" ? "bg-white dark:bg-zinc-700 shadow-sm" : "text-zinc-500"}`}
              onClick={() => setViewMode("list")}
            >
              <ListIcon className="size-4" />
            </Button>
          </div>
        </div>
      </div>

      {loading ? (
        <LibrarySkeleton viewMode={viewMode} />
      ) : entries.length > 0 ? (
        <>
            {viewMode === "grid" ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
                {entries.map((entry) => (
                  <LibraryGridItem key={entry.id} entry={entry} onFix={setFixEntry} />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <LibraryListItem key={entry.id} entry={entry} onFix={setFixEntry} />
                ))}
              </div>
            )}

            <MetadataManualFixDialog 
              open={!!fixEntry} 
              onOpenChange={(open) => !open && setFixEntry(null)} 
              libraryEntryId={fixEntry?.id}
              seriesTitle={fixEntry?.series?.title || fixEntry?.imported_title || ""} 
              sourceUrl={fixEntry?.source_url} 
            />

          {/* Infinite Scroll Target */}
          <div 
            ref={setRef} 
            className="w-full py-12 flex items-center justify-center"
          >
            {loadingMore && (
              <div className="flex flex-col items-center gap-2 text-zinc-500">
                <Loader2 className="size-6 animate-spin" />
                <span className="text-sm font-medium">Loading more...</span>
              </div>
            )}
            {!hasMore && entries.length > 0 && (
              <p className="text-sm text-zinc-400 font-medium italic">
                You've reached the end of your library
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <BookOpen className="size-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">Your library is empty</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              Start by adding some manga or search for your favorite series to track them.
            </p>
          </div>
          <Link href="/discover">
            <Button className="bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 rounded-full px-8">
              Explore Series
            </Button>
          </Link>
        </div>
      )}
    </div>
  )
}

function LibraryPageSkeleton() {
  return (
    <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-5 w-64 mt-2" />
        </div>
        <Skeleton className="h-10 w-32 rounded-full" />
      </div>
      <Skeleton className="h-16 rounded-2xl" />
      <LibrarySkeleton viewMode="grid" />
    </div>
  )
}

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class LibraryErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Library page error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 space-y-8 max-w-7xl mx-auto pb-24">
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Library</h1>
            <p className="text-zinc-500 dark:text-zinc-400">Manage your reading progress and updates</p>
          </div>
          <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
            <div className="size-20 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
              <AlertCircle className="size-10 text-red-500" />
            </div>
            <div className="space-y-2">
              <h3 className="text-xl font-bold">Something went wrong</h3>
              <p className="text-zinc-500 text-sm max-w-md">
                {this.state.error?.message || 'An unexpected error occurred'}
              </p>
              <Button 
                onClick={() => this.setState({ hasError: false, error: null })} 
                variant="outline" 
                className="rounded-full mt-4"
              >
                Try again
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default function LibraryPage() {
  return (
    <LibraryErrorBoundary>
      <Suspense fallback={<LibraryPageSkeleton />}>
        <LibraryPageContent />
      </Suspense>
    </LibraryErrorBoundary>
  )
}
