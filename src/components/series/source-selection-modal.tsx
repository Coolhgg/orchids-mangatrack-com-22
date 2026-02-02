"use client"

import { useState, useMemo } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { ExternalLink, Globe, Star, Crown, CheckCircle2 } from "lucide-react"
import { ChapterSource, sortSourcesByPriority, isPreferredSource } from "@/lib/source-utils-shared"

interface SourceSelectionModalProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  chapterNumber: number
  sources: ChapterSource[]
  onSelect: (source: ChapterSource, alwaysUse: boolean) => void
  preferredSource?: string | null
  sourcePriorities?: string[]
  isRead?: boolean
}

export function SourceSelectionModal({
  isOpen,
  onOpenChange,
  chapterNumber,
  sources,
  onSelect,
  preferredSource,
  sourcePriorities = [],
  isRead = false,
}: SourceSelectionModalProps) {
  const [alwaysUse, setAlwaysUse] = useState(false)

  // Sort sources by user priority for display
  const sortedSources = useMemo(() => {
    return sortSourcesByPriority(sources, {
      preferredSourceSeries: preferredSource,
      preferredSourcePriorities: sourcePriorities,
    })
  }, [sources, preferredSource, sourcePriorities])

  const getSourceIcon = (sourceName: string) => {
    const name = sourceName.toLowerCase()
    if (name.includes("mangadex")) return "MD"
    if (name.includes("mangapark")) return "MP"
    if (name.includes("mangasee")) return "MS"
    if (name.includes("mangakakalot")) return "MK"
    return sourceName.slice(0, 2).toUpperCase()
  }

  const getSourceColor = (sourceName: string) => {
    const name = sourceName.toLowerCase()
    if (name.includes("mangadex")) return "bg-orange-500"
    if (name.includes("mangapark")) return "bg-green-500"
    if (name.includes("mangasee")) return "bg-blue-500"
    if (name.includes("mangakakalot")) return "bg-purple-500"
    return "bg-zinc-500"
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return "Unknown"
    const date = new Date(dateString)
    return date.toLocaleDateString()
  }

  const getPreferenceInfo = (sourceName: string) => {
    return isPreferredSource(sourceName, {
      preferredSourceSeries: preferredSource,
      preferredSourcePriorities: sourcePriorities,
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 overflow-hidden rounded-3xl border-none shadow-2xl">
        <div className="bg-zinc-900 text-white p-6 pb-4">
          <DialogHeader>
            <div className="flex items-center justify-between">
              <DialogTitle className="text-xl font-bold flex items-center gap-2">
                <Globe className="size-5 text-blue-400" />
                Select Source
              </DialogTitle>
              {isRead && (
                <Badge className="bg-green-500/20 text-green-400 border-green-500/50 hover:bg-green-500/30 flex items-center gap-1 px-2 py-0.5 rounded-full">
                  <CheckCircle2 className="size-3" />
                  READ
                </Badge>
              )}
            </div>
          </DialogHeader>
          <p className="text-zinc-400 text-sm mt-1">
            Multiple sources found for Chapter {chapterNumber}. Which one would you like to read?
          </p>
        </div>

        <div className="p-4 space-y-2 max-h-[60vh] overflow-y-auto">
          {sortedSources.map((source, index) => {
            const prefInfo = getPreferenceInfo(source.source_name)
            const isSeriesPreferred = prefInfo.type === 'series'
            const isTopPriority = prefInfo.rank === 1 && prefInfo.type === 'global'
            const hasPriorityRank = prefInfo.rank !== null && prefInfo.type === 'global'
            
            return (
              <button
                key={source.id}
                className={`w-full flex items-center justify-between p-4 rounded-2xl border transition-all text-left group ${
                  isSeriesPreferred 
                    ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 ring-1 ring-amber-500/20' 
                    : isTopPriority
                    ? 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 ring-1 ring-blue-500/20'
                    : 'bg-white dark:bg-zinc-950 border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-900'
                }`}
                onClick={() => onSelect(source, alwaysUse)}
              >
                <div className="flex items-center gap-4">
                  <div className="relative">
                    <div className={`size-10 rounded-xl ${getSourceColor(source.source_name)} text-white text-xs font-bold flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform`}>
                      {getSourceIcon(source.source_name)}
                    </div>
                    {hasPriorityRank && (
                      <div className="absolute -top-1 -right-1 size-4 bg-zinc-900 dark:bg-zinc-100 text-zinc-100 dark:text-zinc-900 text-[9px] font-bold rounded-full flex items-center justify-center">
                        {prefInfo.rank}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-sm capitalize">{source.source_name}</p>
                      {isSeriesPreferred && (
                        <span className="text-[10px] bg-amber-500 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                          <Crown className="size-2.5" />
                          Series
                        </span>
                      )}
                      {isTopPriority && !isSeriesPreferred && (
                        <span className="text-[10px] bg-blue-500 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                          <Star className="size-2.5" />
                          Top Pick
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-zinc-500 font-medium">
                      Discovered {formatDate(source.discovered_at)}
                    </p>
                  </div>
                </div>
                <div className="bg-zinc-100 dark:bg-zinc-800 p-2 rounded-full group-hover:bg-blue-500 group-hover:text-white transition-colors">
                  <ExternalLink className="size-4" />
                </div>
              </button>
            )
          })}
        </div>

        <div className="p-6 pt-2 border-t border-zinc-100 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50">
          <div className="flex items-center space-x-3 mb-4">
            <Checkbox 
              id="always-use" 
              checked={alwaysUse} 
              onCheckedChange={(checked) => setAlwaysUse(checked as boolean)}
              className="rounded-md"
            />
            <div className="grid gap-1.5 leading-none">
              <Label 
                htmlFor="always-use" 
                className="text-sm font-bold cursor-pointer"
              >
                Always use this source for this series
              </Label>
              <p className="text-[10px] text-zinc-500">
                Save as my preferred source for this series.
              </p>
            </div>
          </div>
          <Button 
            variant="outline" 
            className="w-full rounded-xl border-zinc-200 dark:border-zinc-800 font-bold"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
