"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

interface FilterGroupProps {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  badge?: number | string
  className?: string
}

export function FilterGroup({
  title,
  children,
  defaultOpen = true,
  badge,
  className,
}: FilterGroupProps) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className={cn("space-y-2", className)}
    >
      <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors group">
        <div className="flex items-center gap-2">
          <span>{title}</span>
          {badge !== undefined && badge !== 0 && (
            <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 rounded-full">
              {badge}
            </span>
          )}
        </div>
        {isOpen ? (
          <ChevronUp className="size-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
        ) : (
          <ChevronDown className="size-4 text-zinc-400 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

interface FilterSectionProps {
  children: React.ReactNode
  className?: string
}

export function FilterSection({ children, className }: FilterSectionProps) {
  return (
    <div className={cn("flex flex-wrap gap-2", className)}>
      {children}
    </div>
  )
}

interface FilterChipProps {
  label: string
  active?: boolean
  onClick?: () => void
  onRemove?: () => void
  className?: string
}

export function FilterChip({
  label,
  active = false,
  onClick,
  onRemove,
  className,
}: FilterChipProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-all",
        active
          ? "bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900"
          : "bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700",
        className
      )}
    >
      {label}
      {active && onRemove && (
        <span
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          className="ml-1 hover:text-red-300"
        >
          ×
        </span>
      )}
    </button>
  )
}

interface ActiveFiltersBarProps {
  filters: { key: string; label: string; value: string }[]
  onRemove: (key: string, value: string) => void
  onClearAll: () => void
  className?: string
}

export function ActiveFiltersBar({
  filters,
  onRemove,
  onClearAll,
  className,
}: ActiveFiltersBarProps) {
  if (filters.length === 0) return null

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2 p-3 bg-zinc-50 dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800",
        className
      )}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Active Filters:
      </span>
      {filters.map((filter, index) => (
        <FilterChip
          key={`${filter.key}-${filter.value}-${index}`}
          label={`${filter.label}: ${filter.value}`}
          active
          onRemove={() => onRemove(filter.key, filter.value)}
        />
      ))}
      <button
        onClick={onClearAll}
        className="text-[10px] font-semibold uppercase tracking-wider text-red-500 hover:text-red-600 transition-colors ml-2"
      >
        Clear All
      </button>
    </div>
  )
}
