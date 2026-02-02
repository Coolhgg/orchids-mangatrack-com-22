"use client"

import { useState, useCallback } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, AlertCircle, Loader2, X, HelpCircle, ChevronRight } from "lucide-react"
import { toast } from "sonner"
import { Progress } from "@/components/ui/progress"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ImportResultsDetail } from "./ImportResultsDetail"

interface ImportStatus {
  status: "idle" | "parsing" | "uploading" | "processing" | "completed" | "error"
  total?: number
  processed?: number
  matched?: number
  failed?: number
  message?: string
}

type Platform = "AniList" | "MyAnimeList" | "MangaDex"

export function PlatformImport({ platform, onComplete }: { platform: Platform, onComplete?: () => void }) {
  const [status, setStatus] = useState<ImportStatus>({ status: "idle" })
  const [jobId, setJobId] = useState<string | null>(null)
  const [showResults, setShowResults] = useState(false)

  const parseFile = async (file: File, platform: Platform) => {
    const text = await file.text()
    const entries: any[] = []

    if (platform === "AniList") {
      try {
        const data = JSON.parse(text)
        const lists = data.lists || []
        lists.forEach((list: any) => {
            list.entries.forEach((entry: any) => {
              if (entry.media && entry.media.title) {
                const mediaId = entry.mediaId || entry.media.id
                entries.push({
                  title: entry.media.title.romaji || entry.media.title.english || entry.media.title.native,
                  status: entry.status,
                  progress: entry.progress,
                  score: entry.score,
                  external_id: mediaId?.toString(),
                  source_url: mediaId ? `https://anilist.co/manga/${mediaId}` : undefined,
                  source_name: "anilist"
                })
              }
            })
        })
      } catch (e) {
        throw new Error("Failed to parse AniList JSON file")
      }
    } else if (platform === "MyAnimeList") {
      try {
        // Simple XML regex parsing for MAL export
        const mangaBlocks: string[] = text.match(/<manga>([\s\S]*?)<\/manga>/g) || []
          mangaBlocks.forEach((block: string) => {
            const title = block.match(/<manga_title><!\[CDATA\[(.*?)\]\]><\/manga_title>/)?.[1] || 
                          block.match(/<manga_title>(.*?)<\/manga_title>/)?.[1]
            const status = block.match(/<my_status>(.*?)<\/my_status>/)?.[1]
            const progress = parseInt(block.match(/<my_read_chapters>(.*?)<\/my_read_chapters>/)?.[1] || "0")
            const malId = block.match(/<manga_series_id>(.*?)<\/manga_series_id>/)?.[1]
            
            if (title) {
              entries.push({
                title,
                status,
                progress,
                external_id: malId,
                source_url: malId ? `https://myanimelist.net/manga/${malId}` : undefined,
                source_name: "myanimelist"
              })
            }
          })
      } catch (e) {
        throw new Error("Failed to parse MyAnimeList XML file")
      }
    }

    return entries
  }

  const pollStatus = useCallback(async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/import?id=${id}`)
        if (!res.ok) return

        const job = await res.json()
        
        setStatus(prev => ({
          ...prev,
          status: job.status === "completed" ? "completed" : "processing",
          processed: job.processed_items,
          matched: job.matched_items,
          failed: job.failed_items,
          total: job.total_items
        }))

        if (job.status === "completed") {
          clearInterval(interval)
          toast.success(`Import from ${platform} completed!`)
          if (onComplete) onComplete()
        }
      } catch (err) {
        console.error("Polling error:", err)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [platform, onComplete])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setStatus({ status: "parsing", message: `Reading ${platform} file...` })

    try {
      const entries = await parseFile(file, platform)

      if (entries.length === 0) {
        setStatus({ status: "error", message: `No valid entries found in ${platform} file.` })
        return
      }

      setStatus({ 
        status: "uploading", 
        message: `Found ${entries.length} entries. Uploading...`,
        total: entries.length 
      })

      const response = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: platform.toLowerCase(),
          entries
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to start import")
      }

      setJobId(data.job_id)
      setStatus({ status: "processing", message: "Matching series in background...", total: entries.length, processed: 0 })
      
      pollStatus(data.job_id)

    } catch (error: any) {
      console.error("Import error:", error)
      setStatus({ status: "error", message: error.message })
      toast.error(error.message)
    }
  }, [platform, pollStatus])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: platform === "AniList" ? { "application/json": [".json"] } : { "text/xml": [".xml"] },
    multiple: false,
    disabled: status.status !== "idle" && status.status !== "error" && status.status !== "completed"
  })

  const getHelpText = () => {
    if (platform === "AniList") return "Go to AniList Settings > Export to download your library as JSON."
    if (platform === "MyAnimeList") return "Go to MAL Profile > History > Export to get your XML file."
    return ""
  }

  if (showResults && jobId) {
    return <ImportResultsDetail jobId={jobId} onBack={() => setShowResults(false)} />
  }

  return (
    <div className="space-y-4">
      {status.status === "idle" || status.status === "error" || status.status === "completed" ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <label className="text-sm font-bold text-zinc-500 uppercase tracking-wider flex items-center gap-2">
              Import from {platform}
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="size-4 text-zinc-400 cursor-help" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">{getHelpText()}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </label>
          </div>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-3xl p-8 text-center transition-colors cursor-pointer ${
              isDragActive 
                ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900" 
                : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
            }`}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center gap-3">
              <div className="size-12 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
                <Upload className="size-6 text-zinc-500" />
              </div>
              <div>
                <p className="font-bold">Click or drag {platform === "AniList" ? ".json" : ".xml"} file</p>
                <p className="text-xs text-zinc-500 mt-1">{getHelpText()}</p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-3xl p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="size-10 rounded-xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center">
              <Loader2 className="size-5 text-zinc-50 dark:text-zinc-900 animate-spin" />
            </div>
            <div>
              <h3 className="font-bold text-sm">{status.message}</h3>
              <p className="text-xs text-zinc-500">
                {status.processed || 0} / {status.total || 0} items processed
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <Progress value={((status.processed || 0) / (status.total || 1)) * 100} className="h-1.5" />
            <div className="flex justify-between text-[10px] font-bold uppercase tracking-wider">
              <span className="text-green-600 flex items-center gap-1">
                <CheckCircle2 className="size-3" /> {status.matched || 0} Matched
              </span>
              <span className="text-red-500 flex items-center gap-1">
                <AlertCircle className="size-3" /> {status.failed || 0} Skipped
              </span>
            </div>
          </div>
        </div>
      )}

      {status.status === "completed" && (
        <div className="bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 rounded-2xl p-4 flex items-start gap-3">
          <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-green-900 dark:text-green-400">Import Successful</p>
            <p className="text-xs text-green-700 dark:text-green-500/80 mt-1">
              Your library has been updated with {status.matched} series from {platform}.
            </p>
            <div className="flex gap-4 mt-2">
              <Button 
                variant="link" 
                className="p-0 h-auto text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1"
                onClick={() => setShowResults(true)}
              >
                View detailed results <ChevronRight className="size-3" />
              </Button>
              <Button 
                variant="link" 
                className="p-0 h-auto text-xs font-bold text-green-700 dark:text-green-500"
                onClick={() => setStatus({ status: "idle" })}
              >
                Import another file
              </Button>
            </div>
          </div>
          <Button variant="ghost" size="icon" className="size-6 rounded-full" onClick={() => setStatus({ status: "idle" })}>
            <X className="size-4" />
          </Button>
        </div>
      )}

      {status.status === "error" && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-100 dark:border-red-900/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertCircle className="size-5 text-red-600 shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-bold text-red-900 dark:text-red-400">Import Failed</p>
            <p className="text-xs text-red-700 dark:text-red-500/80 mt-1">{status.message}</p>
          </div>
          <Button variant="ghost" size="icon" className="size-6 rounded-full" onClick={() => setStatus({ status: "idle" })}>
            <X className="size-4" />
          </Button>
        </div>
      )}
    </div>
  )
}
