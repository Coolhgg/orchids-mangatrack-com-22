"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { CheckCircle2, CloudDownload, Search, Bell, ArrowRight, Loader2, Plus, X, Star, HelpCircle } from "lucide-react"
import { Input } from "@/components/ui/input"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { PlatformImport } from "@/components/library/PlatformImport"

interface SearchResult {
  id: string
  title: string
  cover_url: string | null
  type: string
  average_rating: number | null
  total_follows: number
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [importing, setImporting] = useState(false)
  const [importPlatform, setImportPlatform] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedSeries, setSelectedSeries] = useState<SearchResult[]>([])
  const [addingToLibrary, setAddingToLibrary] = useState<string | null>(null)
  const router = useRouter()

    const handleImport = async (platform: string) => {
      setImportPlatform(platform)
      setImporting(true)
    }

    const onImportComplete = () => {
      setTimeout(() => {
        setImporting(false)
        setStep(2)
      }, 2000)
    }

    const searchSeries = useCallback(async () => {
    if (!searchQuery || searchQuery.length < 2) {
      setSearchResults([])
      return
    }

    setSearching(true)
    try {
      const res = await fetch(`/api/series/search?q=${encodeURIComponent(searchQuery)}&limit=8`)
      if (res.ok) {
        const data = await res.json()
        setSearchResults(data.results || [])
      }
    } catch (error) {
      console.error("Search failed:", error)
    } finally {
      setSearching(false)
    }
  }, [searchQuery])

  useEffect(() => {
    const debounce = setTimeout(() => {
      searchSeries()
    }, 300)
    return () => clearTimeout(debounce)
  }, [searchQuery, searchSeries])

  const addToLibrary = async (series: SearchResult) => {
    setAddingToLibrary(series.id)
    try {
      const res = await fetch("/api/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // BUG FIX: API expects 'seriesId' not 'series_id'
          seriesId: series.id,
          status: "planning",
        }),
      })

      if (res.ok) {
        setSelectedSeries((prev) => [...prev, series])
        toast.success(`Added "${series.title}" to your library!`)
      } else {
        const data = await res.json()
        if (data.error?.includes("already")) {
          toast.info("Already in your library")
          setSelectedSeries((prev) => [...prev, series])
        } else {
          toast.error(data.error || "Failed to add to library")
        }
      }
    } catch (_error) {
      toast.error("Failed to add to library")
    } finally {
      setAddingToLibrary(null)
    }
  }

  const removeFromSelected = (id: string) => {
    setSelectedSeries((prev) => prev.filter((s) => s.id !== id))
  }

  const isSelected = (id: string) => selectedSeries.some((s) => s.id === id)

  return (
    <div className="min-h-screen bg-white dark:bg-zinc-950 flex flex-col items-center justify-center p-6 pb-24">
      <div className="max-w-xl w-full space-y-12">
        <div className="text-center space-y-4">
          <div className="flex justify-center gap-2 mb-8">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={`h-1.5 rounded-full transition-all ${
                  step >= s ? "w-12 bg-zinc-900 dark:bg-zinc-50" : "w-6 bg-zinc-100 dark:bg-zinc-800"
                }`}
              />
            ))}
          </div>
          <h1 className="text-4xl font-black tracking-tighter">
            {step === 1 && "Import your library"}
            {step === 2 && "Add your first series"}
            {step === 3 && "Stay updated"}
          </h1>
          <p className="text-zinc-500 text-lg">
            {step === 1 && "Already tracking manga? Import your list instantly from other platforms."}
            {step === 2 && "Search for your favorite titles to start tracking them right away."}
            {step === 3 && "Enable notifications to never miss a chapter drop again."}
          </p>
        </div>

        <div className="bg-zinc-50 dark:bg-zinc-900/50 p-8 rounded-[2.5rem] border border-zinc-100 dark:border-zinc-800 shadow-xl space-y-8">
            {step === 1 && (
              <div className="space-y-6">
                {!importing ? (
                  <div className="grid grid-cols-1 gap-4">
                    <TooltipProvider>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-16 rounded-2xl border-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 justify-start px-6 gap-4 flex-1"
                          onClick={() => handleImport("AniList")}
                        >
                          <div className="size-8 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 font-bold">
                            A
                          </div>
                          <span className="font-bold flex-1 text-left">Import from AniList</span>
                          <CloudDownload className="size-5 text-zinc-400" />
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-10 rounded-xl">
                              <HelpCircle className="size-5 text-zinc-400" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p className="text-xs">Go to your AniList profile Settings &gt; Export to download your library as a JSON file, then upload it here.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-16 rounded-2xl border-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 justify-start px-6 gap-4 flex-1"
                          onClick={() => handleImport("MyAnimeList")}
                        >
                          <div className="size-8 rounded-lg bg-blue-600 flex items-center justify-center text-white font-bold">
                            M
                          </div>
                          <span className="font-bold flex-1 text-left">Import from MyAnimeList</span>
                          <CloudDownload className="size-5 text-zinc-400" />
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-10 rounded-xl">
                              <HelpCircle className="size-5 text-zinc-400" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p className="text-xs">Export your list from MAL as an XML file. Go to Profile &gt; History &gt; Export to get your file.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          className="h-16 rounded-2xl border-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 justify-start px-6 gap-4 flex-1"
                          onClick={() => handleImport("MangaDex")}
                        >
                          <div className="size-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center text-orange-600 font-bold">
                            M
                          </div>
                          <span className="font-bold flex-1 text-left">Import from MangaDex</span>
                          <CloudDownload className="size-5 text-zinc-400" />
                        </Button>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-10 rounded-xl">
                              <HelpCircle className="size-5 text-zinc-400" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[250px]">
                            <p className="text-xs">Sync your MangaDex follows directly. You'll need to provide your MangaDex credentials or an API token.</p>
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>
                    <Button variant="ghost" className="text-zinc-500 font-bold" onClick={() => setStep(2)}>
                      Skip for now
                    </Button>
                  </div>
                ) : (
                    <div className="space-y-6">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        className="px-0 h-auto font-bold text-zinc-500 hover:text-zinc-900"
                        onClick={() => {
                          setImporting(false)
                          setImportPlatform(null)
                        }}
                      >
                        <ArrowRight className="size-4 rotate-180 mr-2" />
                        Back to platforms
                      </Button>
                      <PlatformImport 
                        platform={importPlatform as "AniList" | "MyAnimeList" | "MangaDex"} 
                        onComplete={onImportComplete} 
                      />
                    </div>
                )}
              </div>
            )}

          {step === 2 && (
            <div className="space-y-6">
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-zinc-400" />
                <Input
                  placeholder="Search for series (e.g. Solo Leveling)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-14 pl-12 rounded-2xl border-2 bg-white dark:bg-zinc-950"
                />
              </div>

              {selectedSeries.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Added to Library</p>
                  <div className="flex flex-wrap gap-2">
                    {selectedSeries.map((series) => (
                      <div
                        key={series.id}
                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm font-medium"
                      >
                        <CheckCircle2 className="size-4" />
                        <span className="truncate max-w-[150px]">{series.title}</span>
                        <button onClick={() => removeFromSelected(series.id)} className="hover:text-green-900">
                          <X className="size-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {searching ? (
                <div className="space-y-3">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-xl border border-zinc-100 dark:border-zinc-800">
                      <Skeleton className="size-12 rounded-lg" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : searchResults.length > 0 ? (
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {searchResults.map((series) => (
                    <div
                      key={series.id}
                      className={`flex items-center gap-3 p-3 rounded-xl border transition-all ${
                        isSelected(series.id)
                          ? "border-green-500 bg-green-50 dark:bg-green-900/10"
                          : "border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                      }`}
                    >
                      <div className="size-12 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                        {series.cover_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={series.cover_url} className="h-full w-full object-cover" alt="" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{series.title}</p>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                          <span className="capitalize">{series.type}</span>
                          {series.average_rating && (
                            <span className="flex items-center gap-0.5">
                              <Star className="size-3 fill-yellow-500 text-yellow-500" />
                              {series.average_rating}
                            </span>
                          )}
                        </div>
                      </div>
                      {isSelected(series.id) ? (
                        <div className="size-8 rounded-full bg-green-500 flex items-center justify-center text-white">
                          <CheckCircle2 className="size-5" />
                        </div>
                      ) : (
                        <Button
                          size="icon"
                          className="size-8 rounded-full bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-900 hover:text-white dark:hover:bg-zinc-50 dark:hover:text-zinc-900"
                          onClick={() => addToLibrary(series)}
                          disabled={addingToLibrary === series.id}
                        >
                          {addingToLibrary === series.id ? (
                            <Loader2 className="size-4 animate-spin" />
                          ) : (
                            <Plus className="size-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : searchQuery.length >= 2 ? (
                <div className="text-center py-8 text-zinc-500">
                  <p>No results found for &quot;{searchQuery}&quot;</p>
                </div>
              ) : (
                <div className="text-center py-8 text-zinc-500">
                  <p>Start typing to search for series</p>
                </div>
              )}

              <Button
                className="w-full h-14 rounded-2xl bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 font-bold text-lg"
                onClick={() => setStep(3)}
              >
                Continue
                {selectedSeries.length > 0 && (
                  <span className="ml-2 text-sm opacity-70">({selectedSeries.length} added)</span>
                )}
              </Button>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-8 text-center py-6">
              <div className="size-24 rounded-[2rem] bg-orange-100 dark:bg-orange-900/30 text-orange-600 flex items-center justify-center mx-auto shadow-lg shadow-orange-200/50 dark:shadow-orange-900/20">
                <Bell className="size-12" />
              </div>
              <div className="space-y-4">
                <h3 className="text-2xl font-bold">Never miss a drop</h3>
                <p className="text-zinc-500">
                  We&apos;ll notify you as soon as new chapters are available for your tracked series.
                </p>
              </div>
              <div className="space-y-4">
                <Button
                  className="w-full h-14 rounded-2xl bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-200 font-bold text-lg"
                  onClick={() => {
                    toast.success("Notifications enabled!")
                    router.push("/library")
                  }}
                >
                  Enable Notifications
                </Button>
                <Button
                  variant="ghost"
                  className="text-zinc-500 font-bold"
                  onClick={() => router.push("/library")}
                >
                  Not now
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
