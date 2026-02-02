"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, RefreshCcw, Wrench, CheckCircle2, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { toast } from "sonner"
import { MetadataManualFixDialog } from "./MetadataManualFixDialog"

interface MetadataRecoveryBannerProps {
  libraryEntryId: string
  metadataStatus: 'pending' | 'enriched' | 'failed'
  needsReview: boolean
  seriesTitle?: string
  sourceUrl?: string
}

export function MetadataRecoveryBanner({
  libraryEntryId,
  metadataStatus,
  needsReview,
  seriesTitle,
  sourceUrl
}: MetadataRecoveryBannerProps) {
  const [retrying, setRetrying] = useState(false)
  const [fixDialogOpen, setFixDialogOpen] = useState(false)
  const router = useRouter()

  if (metadataStatus === 'enriched' && !needsReview) return null
  if (metadataStatus === 'pending') return null // Handled by existing badge in header usually

  const isFailed = metadataStatus === 'failed'
  const isReview = needsReview && metadataStatus === 'enriched'

  const handleRetry = async () => {
    setRetrying(true)
    try {
      const res = await fetch(`/api/library/${libraryEntryId}/retry-metadata`, {
        method: 'POST'
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message || 'Retry failed')
      
      toast.success('Metadata enrichment retried')
      router.refresh()
    } catch (err: any) {
      toast.error(err.message)
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className={`flex flex-col md:flex-row items-center justify-between gap-4 p-4 rounded-2xl border mb-8 animate-in fade-in slide-in-from-top-4 duration-500 ${
      isFailed 
        ? 'bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900/50 text-red-900 dark:text-red-200' 
        : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200'
    }`}>
      <div className="flex items-start gap-3">
        {isFailed ? (
          <AlertCircle className="size-5 mt-0.5 shrink-0" />
        ) : (
          <CheckCircle2 className="size-5 mt-0.5 shrink-0" />
        )}
        <div className="space-y-1">
          <p className="font-bold text-sm uppercase italic tracking-wider">
            {isFailed ? 'Metadata enrichment failed' : 'Metadata needs review'}
          </p>
          <p className="text-xs font-medium opacity-80 max-w-xl">
            {isFailed 
              ? `We couldn't automatically find metadata for "${seriesTitle || 'this series'}". You can try again or manually link it to a MangaDex entry.`
              : `We found a potential match, but it might be incorrect. Please verify if the information above is correct or manually fix it.`
            }
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 w-full md:w-auto">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleRetry} 
          disabled={retrying}
          className="flex-1 md:flex-none h-9 rounded-xl border-current/20 hover:bg-current/10 transition-colors gap-2"
        >
          {retrying ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCcw className="size-3.5" />}
          Retry
        </Button>
        <Button 
          variant="default" 
          size="sm" 
          onClick={() => setFixDialogOpen(true)}
          className={`flex-1 md:flex-none h-9 rounded-xl gap-2 shadow-lg ${
            isFailed ? 'bg-red-600 hover:bg-red-700 text-white' : 'bg-amber-600 hover:bg-amber-700 text-white'
          }`}
        >
          <Wrench className="size-3.5" />
          Fix metadata
        </Button>
      </div>

      <MetadataManualFixDialog
        open={fixDialogOpen}
        onOpenChange={setFixDialogOpen}
        libraryEntryId={libraryEntryId}
        seriesTitle={seriesTitle}
        sourceUrl={sourceUrl}
      />
    </div>
  )
}
