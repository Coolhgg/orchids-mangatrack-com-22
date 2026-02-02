"use client"

import { useState, useCallback, useEffect } from "react"
import { useDropzone } from "react-dropzone"
import { Button } from "@/components/ui/button"
import { Upload, CheckCircle2, AlertCircle, Loader2, X, Download, ChevronRight, AlertTriangle } from "lucide-react"
import { parseCSV } from "@/lib/sync/csv-parser"
import { toast } from "sonner"
import { Progress } from "@/components/ui/progress"
import { ImportResultsDetail } from "./ImportResultsDetail"

interface ImportStatus {
  status: "idle" | "parsing" | "uploading" | "processing" | "completed" | "error"
  total?: number
  processed?: number
  matched?: number
  failed?: number
  message?: string
  failures?: Array<{ title: string, reason: string }>
  missingProgress?: boolean
}

export function CSVImport({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<ImportStatus>({ status: "idle" })
  const [jobId, setJobId] = useState<string | null>(null)
  const [showResults, setShowResults] = useState(false)

  const pollStatus = useCallback(async (id: string) => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/library/import?id=${id}`)
        if (!res.ok) return

        const job = await res.json()
        
        if (!job) {
          clearInterval(interval)
          setStatus({ status: "error", message: "Import job not found" })
          return
        }
        
setStatus(prev => ({
            ...prev,
            status: job.status === "completed" ? "completed" : "processing",
            processed: job.processed_items,
            matched: job.matched_items,
            failed: job.failed_items,
            total: job.total_items,
            missingProgress: prev.missingProgress
          }))

        if (job.status === "completed") {
          clearInterval(interval)
          toast.success("Import completed!")
          if (onComplete) onComplete()
        }
      } catch (err) {
        console.error("Polling error:", err)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [onComplete])

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setStatus({ status: "parsing", message: "Reading CSV file..." })

try {
        const text = await file.text()
        const result = parseCSV(text, true)
        const entries = result.entries

        if (entries.length === 0) {
          setStatus({ status: "error", message: "No valid entries found in CSV. Check headers (title, status, progress)." })
          return
        }

        const missingProgress = !result.hasProgressColumn || result.totalProgressValue === 0

        setStatus({ 
          status: "uploading", 
          message: `Found ${entries.length} entries. Uploading...`,
          total: entries.length,
          missingProgress
        })

      const response = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "csv",
          entries
        })
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Failed to start import")
      }

setJobId(data.job_id)
        setStatus(prev => ({ 
          status: "processing", 
          message: "Matching series in background...", 
          total: entries.length, 
          processed: 0,
          missingProgress: prev.missingProgress
        }))
      
      pollStatus(data.job_id)

    } catch (error: any) {
      console.error("Import error:", error)
      setStatus({ status: "error", message: error.message })
      toast.error(error.message)
    }
  }, [pollStatus])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "text/csv": [".csv"] },
    multiple: false,
    disabled: status.status !== "idle" && status.status !== "error" && status.status !== "completed"
  })

  const handleDownloadFailures = () => {
    if (!status.failures || status.failures.length === 0) return

    const headers = ["Title", "Reason"]
    const csvContent = [
      headers.join(","),
      ...status.failures.map(f => `"${f.title.replace(/"/g, '""')}", "${f.reason.replace(/"/g, '""')}"`)
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)
    link.setAttribute("download", `skipped_series_${new Date().toISOString().split('T')[0]}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (showResults && jobId) {
    return <ImportResultsDetail jobId={jobId} onBack={() => setShowResults(false)} />
  }

  return (
    <div className="space-y-4">
      {status.status === "idle" || status.status === "error" || status.status === "completed" ? (
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-3xl p-12 text-center transition-colors cursor-pointer ${
            isDragActive 
              ? "border-zinc-900 bg-zinc-50 dark:border-zinc-50 dark:bg-zinc-900" 
              : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-400 dark:hover:border-zinc-600"
          }`}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-4">
            <div className="size-16 rounded-3xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
              <Upload className="size-8 text-zinc-500" />
            </div>
            <div>
              <p className="font-bold text-lg">Click or drag CSV to import</p>
              <p className="text-sm text-zinc-500 mt-1">
                Required columns: <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded">title</code>, 
                <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded ml-1">status</code>, 
                <code className="bg-zinc-100 dark:bg-zinc-800 px-1 rounded ml-1">progress</code>
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 rounded-3xl p-8 space-y-6">
          <div className="flex items-center gap-4">
            <div className="size-12 rounded-2xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center">
              <Loader2 className="size-6 text-zinc-50 dark:text-zinc-900 animate-spin" />
            </div>
            <div>
              <h3 className="font-bold">{status.message}</h3>
              <p className="text-sm text-zinc-500">
                {status.processed || 0} / {status.total || 0} items processed
              </p>
            </div>
          </div>
          
          <div className="space-y-2">
            <Progress value={((status.processed || 0) / (status.total || 1)) * 100} className="h-2" />
            <div className="flex justify-between text-xs font-medium">
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
          <div className="space-y-3">
            <div className="bg-green-50 dark:bg-green-950/20 border border-green-100 dark:border-green-900/30 rounded-2xl p-4 flex items-start gap-3">
              <CheckCircle2 className="size-5 text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-bold text-green-900 dark:text-green-400">Import Successful</p>
                <p className="text-xs text-green-700 dark:text-green-500/80 mt-1">
                  Your library has been updated with {status.matched} series. 
                  {status.failed && status.failed > 0 ? ` ${status.failed} items couldn't be matched automatically.` : ""}
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
              {status.failures && status.failures.length > 0 && (
                <div className="flex items-center gap-2">
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="rounded-xl h-8 text-[10px] font-bold gap-2"
                    onClick={handleDownloadFailures}
                  >
                    <Download className="size-3" />
                    Download {status.failures.length} skipped
                  </Button>
                </div>
              )}
              <Button variant="ghost" size="icon" className="size-6 rounded-full" onClick={() => setStatus({ status: "idle" })}>
                <X className="size-4" />
              </Button>
            </div>

            {status.missingProgress && (
              <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/30 rounded-2xl p-4 flex items-start gap-3">
                <AlertTriangle className="size-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-bold text-amber-900 dark:text-amber-400">No reading progress detected</p>
                  <p className="text-xs text-amber-700 dark:text-amber-500/80 mt-1">
                    Your CSV didn't include chapter progress data (columns like <code className="bg-amber-100 dark:bg-amber-900/30 px-1 rounded">progress</code>, <code className="bg-amber-100 dark:bg-amber-900/30 px-1 rounded">chapters_read</code>). 
                    Reading progress won't be imported, and you won't receive the migration XP bonus.
                  </p>
                </div>
              </div>
            )}
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
