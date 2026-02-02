"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { ChevronUp, ChevronDown, Loader2, Info } from "lucide-react"
import { toast } from "sonner"

// Only show sources that have working scrapers
const SUPPORTED_SOURCES = [
  { id: "mangadex", name: "MangaDex", status: "active" as const },
]

// Planned sources - shown as "coming soon" for transparency
const PLANNED_SOURCES = [
  { id: "mangapark", name: "MangaPark", status: "planned" as const },
  { id: "mangasee", name: "MangaSee", status: "planned" as const },
  { id: "mangakakalot", name: "MangaKakalot", status: "planned" as const },
]

export function SourcePrioritySettings() {
  const [priorities, setPriorities] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchPriorities() {
      try {
        const res = await fetch("/api/users/me/source-priorities")
        if (res.ok) {
          const data = await res.json()
          const existingNames = data.priorities
            .map((p: any) => p.source_name)
            .filter((name: string) => SUPPORTED_SOURCES.some(s => s.id === name))
          
          // Only include active/supported sources
          const allSources = [...existingNames]
          SUPPORTED_SOURCES.forEach(s => {
            if (!allSources.includes(s.id)) {
              allSources.push(s.id)
            }
          })
          setPriorities(allSources)
        } else {
          // Default to supported sources
          setPriorities(SUPPORTED_SOURCES.map(s => s.id))
        }
      } catch (error) {
        console.error("Failed to fetch priorities:", error)
        setPriorities(SUPPORTED_SOURCES.map(s => s.id))
      } finally {
        setLoading(false)
      }
    }
    fetchPriorities()
  }, [])

  const moveUp = (index: number) => {
    if (index === 0) return
    const newPriorities = [...priorities]
    const temp = newPriorities[index]
    newPriorities[index] = newPriorities[index - 1]
    newPriorities[index - 1] = temp
    setPriorities(newPriorities)
  }

  const moveDown = (index: number) => {
    if (index === priorities.length - 1) return
    const newPriorities = [...priorities]
    const temp = newPriorities[index]
    newPriorities[index] = newPriorities[index + 1]
    newPriorities[index + 1] = temp
    setPriorities(newPriorities)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch("/api/users/me/source-priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourcePriorities: priorities }),
      })
      if (res.ok) {
        toast.success("Source priorities saved")
      } else {
        toast.error("Failed to save source priorities")
      }
    } catch (error) {
      toast.error("An error occurred while saving")
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h3 className="text-sm font-bold">Source Priority</h3>
        <p className="text-xs text-zinc-500">
          Set your reading preference order. The top source will be used first if available.
        </p>
      </div>

      <div className="space-y-2">
        {priorities.map((sourceId, index) => {
          const source = SUPPORTED_SOURCES.find(s => s.id === sourceId) || { name: sourceId, id: sourceId, status: 'active' as const }
          return (
            <div 
              key={sourceId}
              className="flex items-center justify-between p-3 rounded-xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800"
            >
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold text-zinc-400 w-4">{index + 1}</span>
                <span className="text-sm font-medium">{source.name}</span>
              </div>
              <div className="flex items-center gap-1">
                <Button 
                  type="button"
                  variant="ghost" 
                  size="icon" 
                  className="size-8 rounded-lg"
                  onClick={() => moveUp(index)}
                  disabled={index === 0}
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button 
                  type="button"
                  variant="ghost" 
                  size="icon" 
                  className="size-8 rounded-lg"
                  onClick={() => moveDown(index)}
                  disabled={index === priorities.length - 1}
                >
                  <ChevronDown className="size-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>

      {priorities.length > 1 && (
        <Button 
          type="button"
          onClick={handleSave} 
          disabled={saving}
          className="w-full rounded-full font-bold"
        >
          {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
          Save Priority Order
        </Button>
      )}

      {/* Show planned sources for transparency */}
      {PLANNED_SOURCES.length > 0 && (
        <div className="pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2 mb-3">
            <Info className="size-4 text-zinc-400" />
            <span className="text-xs text-zinc-500 font-medium">Coming Soon</span>
          </div>
          <div className="space-y-2">
            {PLANNED_SOURCES.map(source => (
              <div 
                key={source.id}
                className="flex items-center justify-between p-3 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 opacity-50"
              >
                <div className="flex items-center gap-3">
                  <span className="text-xs font-bold text-zinc-300 w-4">-</span>
                  <span className="text-sm font-medium text-zinc-400">{source.name}</span>
                </div>
                <span className="text-xs text-zinc-400 bg-zinc-200 dark:bg-zinc-800 px-2 py-0.5 rounded-full">
                  Planned
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
