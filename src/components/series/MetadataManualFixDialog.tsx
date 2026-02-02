"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { useRouter } from "next/navigation"
import { Search, Loader2, AlertCircle, CheckCircle2, Link as LinkIcon, Globe } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { NSFWCover } from "@/components/ui/nsfw-cover"
import { extractMangaDexId, isValidMangaDexId } from "@/lib/mangadex-utils"

interface MetadataManualFixDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  libraryEntryId?: string
  seriesTitle?: string
  sourceUrl?: string
}

interface SearchResult {
  id: string
  title: string
  cover_url: string | null
  mangadex_id?: string
  type: string
  status: string
  content_rating: string | null
}

export function MetadataManualFixDialog({
  open,
  onOpenChange,
  libraryEntryId,
  seriesTitle,
  sourceUrl
}: MetadataManualFixDialogProps) {
  const [query, setQuery] = useState(seriesTitle || "")
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [attaching, setAttaching] = useState<string | null>(null)
  const [validatingId, setValidatingId] = useState(false)
  const [validatedSeries, setValidatedSeries] = useState<SearchResult | null>(null)
  const router = useRouter()

  const detectedMangaDexId = useMemo(() => {
    const id = extractMangaDexId(query)
    if (!id && isValidMangaDexId(query.trim())) {
      return query.trim()
    }
    return id
  }, [query])

  const isDirectIdOrUrl = useMemo(() => {
    return !!detectedMangaDexId
  }, [detectedMangaDexId])

  // Validate direct ID and fetch its title
  useEffect(() => {
    let active = true
    if (isDirectIdOrUrl && detectedMangaDexId) {
      const validate = async () => {
        setValidatingId(true)
        setValidatedSeries(null)
        try {
          const res = await fetch(`/api/series/${detectedMangaDexId}/metadata`)
          if (res.ok && active) {
            const data = await res.json()
            if (data.metadata) {
              setValidatedSeries({
                id: data.metadata.id,
                title: data.metadata.title,
                cover_url: data.metadata.cover_url,
                mangadex_id: data.metadata.id,
                type: data.metadata.type || 'manga',
                status: data.metadata.status || 'unknown',
                content_rating: data.metadata.content_rating
              })
            }
          }
        } catch (err) {
          console.error("Validation failed:", err)
        } finally {
          if (active) setValidatingId(false)
        }
      }
      validate()
    } else {
      setValidatedSeries(null)
      setValidatingId(false)
    }
    return () => { active = false }
  }, [isDirectIdOrUrl, detectedMangaDexId])

  // Reset query when dialog opens with new title
  useEffect(() => {
    if (open && seriesTitle) {
      setQuery(seriesTitle)
      setResults([])
    }
  }, [open, seriesTitle])

  const handleSearch = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim()) return
    
    // If it's a direct ID or URL, we might want to fetch that specific one
    const mdId = extractMangaDexId(searchQuery)
    
    setLoading(true)
    try {
      const res = await fetch(`/api/series/search?q=${encodeURIComponent(searchQuery)}&limit=5`)
      const data = await res.json()
      if (res.ok) {
        setResults(data.results || [])
      }
    } catch (err) {
      console.error("Search failed:", err)
      toast.error("Failed to search MangaDex")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open && seriesTitle && results.length === 0 && !extractMangaDexId(seriesTitle)) {
      handleSearch(seriesTitle)
    }
  }, [open, seriesTitle, handleSearch, results.length])

  const handleAttach = async (targetId: string) => {
    if (!libraryEntryId && !sourceUrl) {
      toast.error("Cannot fix metadata: missing entry context")
      return
    }

    setAttaching(targetId)
    try {
      const endpoint = libraryEntryId 
        ? `/api/library/${libraryEntryId}/fix-metadata`
        : '/api/series/attach'
        
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mangadex_id: targetId,
        })
      })

      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Failed to link series')

      toast.success('Successfully linked series')
      onOpenChange(false)
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setAttaching(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 overflow-hidden border-none shadow-2xl rounded-3xl">
        <DialogHeader className="p-6 pb-0">
          <DialogTitle className="text-2xl font-black uppercase italic tracking-tight">Fix Metadata</DialogTitle>
          <DialogDescription className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Link your entry to a MangaDex series by searching or pasting a URL/ID
          </DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-6">
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch(query)}
                placeholder="Search title or paste MangaDex URL..."
                className="h-12 pl-11 pr-4 rounded-2xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 transition-all font-medium"
              />
              {loading && (
                <div className="absolute right-4 top-1/2 -translate-y-1/2">
                  <Loader2 className="size-4 animate-spin text-zinc-400" />
                </div>
              )}
            </div>

            {isDirectIdOrUrl && (
              <div className="p-4 rounded-2xl bg-zinc-900 text-white dark:bg-zinc-50 dark:text-zinc-900 flex items-center justify-between animate-in fade-in slide-in-from-top-2 border-2 border-zinc-200 dark:border-zinc-800 shadow-xl overflow-hidden relative">
                {validatingId && (
                  <div className="absolute inset-0 bg-zinc-900/50 dark:bg-zinc-50/50 backdrop-blur-sm flex items-center justify-center z-10">
                    <Loader2 className="size-4 animate-spin" />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <div className="size-10 rounded-xl bg-white/10 dark:bg-black/5 flex items-center justify-center shrink-0">
                    {validatedSeries ? (
                      <NSFWCover
                        src={validatedSeries.cover_url}
                        alt={validatedSeries.title}
                        contentRating={validatedSeries.content_rating}
                        className="object-cover rounded-lg"
                        size="256"
                        showBadge={false}
                      />
                    ) : (
                      <Globe className="size-5" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[10px] font-black uppercase italic tracking-widest opacity-70">
                      {validatedSeries ? "Series Found" : "Direct Link / ID detected"}
                    </p>
                    <p className="text-xs font-bold truncate max-w-[180px]">
                      {validatedSeries ? validatedSeries.title : detectedMangaDexId}
                    </p>
                  </div>
                </div>
                <Button 
                  size="sm" 
                  variant="secondary"
                  className="rounded-xl font-black uppercase italic tracking-widest text-[10px] h-9 px-4 hover:scale-105 transition-transform shrink-0"
                  onClick={() => handleAttach(detectedMangaDexId!)}
                  disabled={!!attaching || (validatingId && !validatedSeries)}
                >
                  {attaching === detectedMangaDexId ? (
                    <Loader2 className="size-3 animate-spin mr-2" />
                  ) : (
                    <CheckCircle2 className="size-3 mr-2" />
                  )}
                  Link This ID
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
            <p className="text-[10px] font-black uppercase italic tracking-widest text-zinc-400 px-1">Search Results</p>
            {results.length > 0 ? (
              results.map((result) => (
                <div
                  key={result.id}
                  className="group flex gap-4 p-3 rounded-2xl border border-zinc-100 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-all cursor-pointer"
                  onClick={() => !attaching && handleAttach(result.mangadex_id || result.id)}
                >
                  <div className="relative w-16 h-24 shrink-0 overflow-hidden rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                    <NSFWCover
                      src={result.cover_url}
                      alt={result.title}
                      contentRating={result.content_rating}
                      className="object-cover"
                      size="256"
                    />
                  </div>
                  <div className="flex-1 flex flex-col justify-between py-1">
                    <div className="space-y-1">
                      <h4 className="font-bold text-sm line-clamp-2 leading-tight group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors">
                        {result.title}
                      </h4>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase font-bold px-1.5 h-5 border-zinc-200 dark:border-zinc-800">
                          {result.type}
                        </Badge>
                        <Badge variant="secondary" className="text-[10px] uppercase font-bold px-1.5 h-5 bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 border-none">
                          {result.status}
                        </Badge>
                      </div>
                    </div>
                    
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="h-8 w-fit rounded-lg text-[10px] font-black uppercase tracking-widest gap-2 hover:bg-zinc-900 hover:text-white dark:hover:bg-zinc-100 dark:hover:text-zinc-900"
                      disabled={!!attaching}
                    >
                      {attaching === (result.mangadex_id || result.id) ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-3" />
                      )}
                      Link this
                    </Button>
                  </div>
                </div>
              ))
            ) : query && !loading && !detectedMangaDexId ? (
              <div className="py-12 flex flex-col items-center justify-center text-center space-y-4">
                <div className="size-16 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center">
                  <AlertCircle className="size-8 text-zinc-300" />
                </div>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">No results found for &ldquo;{query}&rdquo;</p>
              </div>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
