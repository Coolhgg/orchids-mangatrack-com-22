"use client"

import * as React from "react"
import { Search, Check } from "lucide-react"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"

interface Option {
  label: string
  value: string
}

interface MultiSelectGridProps {
  options: readonly Option[]
  selected: string[]
  onChange: (selected: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  columns?: 2 | 3 | 4
}

export function MultiSelectGrid({
  options,
  selected,
  onChange,
  searchPlaceholder = "Search...",
  columns = 2,
}: MultiSelectGridProps) {
  const [search, setSearch] = React.useState("")

  const filteredOptions = React.useMemo(() => {
    return options.filter((option) =>
      option.label.toLowerCase().includes(search.toLowerCase())
    )
  }, [options, search])

  const toggleOption = (value: string) => {
    const next = selected.includes(value)
      ? selected.filter((s) => s !== value)
      : [...selected, value]
    onChange(next)
  }

  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-3",
    4: "grid-cols-4",
  }[columns]

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={searchPlaceholder}
          className="pl-9 h-10 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
        />
      </div>

      <div className={cn("grid gap-2", gridCols)}>
        {filteredOptions.map((option) => {
          const isActive = selected.includes(option.value)
          return (
            <button
              key={option.value}
              onClick={() => toggleOption(option.value)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-all",
                "hover:bg-zinc-100 dark:hover:bg-zinc-800",
                isActive
                  ? "bg-zinc-900 dark:bg-zinc-100 border-transparent text-white dark:text-zinc-900"
                  : "bg-transparent border-zinc-200 dark:border-zinc-800 text-zinc-600 dark:text-zinc-400"
              )}
            >
              <div className={cn(
                "size-4 rounded border flex items-center justify-center transition-colors",
                isActive 
                  ? "bg-white dark:bg-zinc-900 border-transparent" 
                  : "border-zinc-300 dark:border-zinc-700"
              )}>
                {isActive && <Check className="size-3 text-zinc-900 dark:text-zinc-100" />}
              </div>
              <span className="text-xs font-medium truncate">{option.label}</span>
            </button>
          )
        })}
      </div>

      {filteredOptions.length === 0 && (
        <div className="text-center py-6 text-sm text-zinc-500">
          No matches found
        </div>
      )}
    </div>
  )
}
