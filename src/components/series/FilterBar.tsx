"use client"

import { Search, X, SlidersHorizontal } from "lucide-react"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Button } from "@/components/ui/button"

interface FilterBarProps {
  query: string
  setQuery: (val: string) => void
  type: string
  setType: (val: string) => void
  status: string
  setStatus: (val: string) => void
  contentRating: string
  setContentRating: (val: string) => void
  sort: string
  setSort: (val: string) => void
  onClear: () => void
}

export function FilterBar({
  query,
  setQuery,
  type,
  setType,
  status,
  setStatus,
  contentRating,
  setContentRating,
  sort,
  setSort,
  onClear
}: FilterBarProps) {
  const hasFilters = query || type !== 'all' || status !== 'all' || contentRating !== 'all' || sort !== 'newest'

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col md:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles..."
            className="h-11 pl-11 pr-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-50 transition-all"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-md transition-colors"
            >
              <X className="size-3 text-zinc-400" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Select value={sort} onValueChange={setSort}>
            <SelectTrigger className="w-[140px] h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="popular">Popular</SelectItem>
                <SelectItem value="rating">Top Rated</SelectItem>
              </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              variant="ghost"
              onClick={onClear}
              className="h-11 px-4 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50 rounded-xl"
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-400 uppercase tracking-wider mr-2">
          <SlidersHorizontal className="size-3" />
          Filters
        </div>
        
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="w-auto min-w-[100px] h-9 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border-none">
            <span className="text-zinc-500 mr-1">Type:</span>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="manga">Manga</SelectItem>
            <SelectItem value="manhwa">Manhwa</SelectItem>
            <SelectItem value="manhua">Manhua</SelectItem>
          </SelectContent>
        </Select>

        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-auto min-w-[110px] h-9 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border-none">
            <span className="text-zinc-500 mr-1">Status:</span>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="ongoing">Ongoing</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="hiatus">Hiatus</SelectItem>
          </SelectContent>
        </Select>

        <Select value={contentRating} onValueChange={setContentRating}>
          <SelectTrigger className="w-auto min-w-[120px] h-9 text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border-none">
            <span className="text-zinc-500 mr-1">Rating:</span>
            <SelectValue placeholder="All" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="safe">Safe</SelectItem>
            <SelectItem value="suggestive">Suggestive</SelectItem>
            <SelectItem value="erotica">Erotica</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
