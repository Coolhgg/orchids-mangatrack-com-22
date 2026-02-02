"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { CheckCircle2, AlertCircle, Search, ChevronRight, ExternalLink, Loader2, Download, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import Image from "next/image"
import Link from "next/link"
import { toast } from "sonner"

/**
 * V5 AUDIT BUG FIXES:
 * - Bug 44: UI assumes series exists for every library entry
 *   - Now uses safe series access with fallback values
 * - Bug 45: UI does not debounce retry actions
 *   - Now debounces retry/download actions
 */

interface ImportItem {
  id: string
  title: string
  status: "PENDING" | "SUCCESS" | "FAILED"
  reason_code: string | null
  reason_message: string | null
  series_id: string | null
  series?: {
    id: string
    title: string
    cover_url: string | null
    status: string | null
    type: string | null
  } | null // Bug 44: Series can be null
}

interface ImportJob {
  id: string
  status: string
  total_items: number
  processed_items: number
  matched_items: number
  failed_items: number
  completed_at: string | null
}

/**
 * Bug 44 Fix: Safe series access helper
 * Returns fallback values when series is null/undefined
 */
function getSafeSeriesData(item: ImportItem): {
  title: string;
  coverUrl: string | null;
  seriesId: string | null;
  exists: boolean;
} {
  if (item.series) {
    return {
      title: item.series.title || item.title,
      coverUrl: item.series.cover_url,
      seriesId: item.series.id,
      exists: true,
    };
  }
  
  return {
    title: item.title,
    coverUrl: null,
    seriesId: item.series_id,
    exists: false,
  };
}

/**
 * Bug 45 Fix: Custom hook for debounced actions
 */
function useDebounce<T extends (...args: unknown[]) => unknown>(
  callback: T,
  delay: number = 1000
): { debouncedFn: (...args: Parameters<T>) => void; isPending: boolean } {
  const [isPending, setIsPending] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCallRef = useRef<number>(0);

  const debouncedFn = useCallback(
    (...args: Parameters<T>) => {
      const now = Date.now();
      const timeSinceLastCall = now - lastCallRef.current;
      
      // If called too soon, ignore
      if (timeSinceLastCall < delay) {
        toast.info("Please wait before trying again");
        return;
      }
      
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      setIsPending(true);
      lastCallRef.current = now;
      
      timeoutRef.current = setTimeout(() => {
        callback(...args);
        setIsPending(false);
      }, 100); // Small delay to prevent double-clicks
    },
    [callback, delay]
  );

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return { debouncedFn, isPending };
}

export function ImportResultsDetail({ jobId, onBack }: { jobId: string, onBack?: () => void }) {
  const [data, setData] = useState<{ job: ImportJob, items: ImportItem[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"all" | "SUCCESS" | "FAILED">("all")
  const [downloading, setDownloading] = useState(false)

  useEffect(() => {
    const fetchResults = async () => {
      try {
        const res = await fetch(`/api/library/import/results?jobId=${jobId}`)
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch (err) {
        console.error("Failed to fetch import results:", err)
      } finally {
        setLoading(false)
      }
    }

    fetchResults()
    
    // If job is still processing, poll it
    if (data && data.job.status !== "completed") {
      const interval = setInterval(fetchResults, 3000)
      return () => clearInterval(interval)
    }
  }, [jobId, data?.job.status])

  // Bug 45: Debounced download action
  const handleDownloadCSVInternal = useCallback(async () => {
    setDownloading(true)
    try {
      const res = await fetch(`/api/library/import/results?jobId=${jobId}&format=csv`)
      if (!res.ok) throw new Error("Failed to download")
      
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `import-results-${jobId.slice(0, 8)}-${new Date().toISOString().split('T')[0]}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      
      toast.success("Import summary downloaded!")
    } catch (error) {
      console.error("Download failed:", error)
      toast.error("Failed to download import summary")
    } finally {
      setDownloading(false)
    }
  }, [jobId]);

  const { debouncedFn: handleDownloadCSV, isPending: isDownloadPending } = useDebounce(
    handleDownloadCSVInternal,
    2000
  );

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center p-12 space-y-4">
        <Loader2 className="size-8 animate-spin text-zinc-500" />
        <p className="text-sm font-medium text-zinc-500">Loading import details...</p>
      </div>
    )
  }

  if (!data) return null

  const filteredItems = data.items.filter(item => filter === "all" || item.status === filter)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Import Summary</h2>
          <p className="text-sm text-zinc-500">Job ID: {jobId.slice(0, 8)}...</p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => handleDownloadCSV()}
            disabled={downloading || isDownloadPending}
            className="gap-2"
          >
            {downloading || isDownloadPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Download CSV
          </Button>
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack}>
              Back to Import
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-zinc-50/50 dark:bg-zinc-900/50 border-none">
          <CardContent className="p-4 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1">Total</p>
            <p className="text-2xl font-bold">{data.job.total_items}</p>
          </CardContent>
        </Card>
        <Card className="bg-green-50/50 dark:bg-green-950/20 border-none">
          <CardContent className="p-4 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-green-600 mb-1">Success</p>
            <p className="text-2xl font-bold text-green-600">{data.job.matched_items}</p>
          </CardContent>
        </Card>
        <Card className="bg-red-50/50 dark:bg-red-950/20 border-none">
          <CardContent className="p-4 pt-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-red-600 mb-1">Failed</p>
            <p className="text-2xl font-bold text-red-600">{data.job.failed_items}</p>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          <Button 
            variant={filter === "all" ? "default" : "outline"} 
            size="sm" 
            onClick={() => setFilter("all")}
            className="rounded-full"
          >
            All Items
          </Button>
          <Button 
            variant={filter === "SUCCESS" ? "default" : "outline"} 
            size="sm" 
            onClick={() => setFilter("SUCCESS")}
            className="rounded-full text-green-600"
          >
            Successful
          </Button>
          <Button 
            variant={filter === "FAILED" ? "default" : "outline"} 
            size="sm" 
            onClick={() => setFilter("FAILED")}
            className="rounded-full text-red-600"
          >
            Failed
          </Button>
        </div>

        <ScrollArea className="h-[400px] rounded-3xl border border-zinc-100 dark:border-zinc-800 p-4">
          <div className="space-y-3">
            {filteredItems.map((item) => {
              // Bug 44: Use safe series access
              const safeData = getSafeSeriesData(item);
              
              return (
                <div 
                  key={item.id} 
                  className="flex items-center gap-4 p-3 rounded-2xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors group"
                >
                  <div className="relative size-12 rounded-xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 shrink-0">
                    {safeData.coverUrl ? (
                      <Image 
                        src={safeData.coverUrl} 
                        alt={safeData.title} 
                        fill 
                        className="object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        {item.status === 'SUCCESS' ? (
                          <CheckCircle2 className="size-5 text-green-500" />
                        ) : item.status === 'FAILED' ? (
                          <AlertCircle className="size-5 text-red-500" />
                        ) : (
                          <FileText className="size-5 text-zinc-400" />
                        )}
                      </div>
                    )}
                  </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h4 className="font-bold text-sm truncate">{safeData.title}</h4>
                        {item.status === 'SUCCESS' && (
                          <Badge className={`${item.reason_code === 'MATCHED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'} hover:opacity-80 border-none text-[10px]`}>
                            {item.reason_code === 'MATCHED' ? 'Matched' : 'Imported'}
                          </Badge>
                        )}
                        {item.status === 'FAILED' && <Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none text-[10px]">Failed</Badge>}
                        {item.status === 'PENDING' && <Badge className="bg-yellow-100 text-yellow-700 hover:bg-yellow-100 border-none text-[10px]">Pending</Badge>}
                        {/* Bug 44: Show indicator when series is missing */}
                        {!safeData.exists && item.status === 'SUCCESS' && (
                          <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100 border-none text-[10px]">
                            Pending Enrichment
                          </Badge>
                        )}
                      </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">
                      {item.reason_message || "Processing entry..."}
                    </p>
                  </div>

                  {/* Bug 44: Only show link if series exists */}
                  {safeData.seriesId && safeData.exists && (
                    <Link href={`/series/${safeData.seriesId}`}>
                      <Button variant="ghost" size="icon" className="rounded-full opacity-0 group-hover:opacity-100 transition-opacity">
                        <ExternalLink className="size-4" />
                      </Button>
                    </Link>
                  )}
                </div>
              );
            })}

            {filteredItems.length === 0 && (
              <div className="flex flex-col items-center justify-center p-12 text-center">
                <p className="text-sm text-zinc-500">No items found matching this filter.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
