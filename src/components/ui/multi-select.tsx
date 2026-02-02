"use client"

import * as React from "react"
import { Check, ChevronsUpDown, X, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Badge } from "@/components/ui/badge"

interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  options: readonly MultiSelectOption[]
  selected: string[]
  onChange: (values: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  maxDisplay?: number
  showSearch?: boolean
}

export function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "Select...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  maxDisplay = 2,
  showSearch = true,
}: MultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const selectedLabels = selected
    .map((value) => options.find((opt) => opt.value === value)?.label)
    .filter(Boolean)

  const handleSelect = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value))
    } else {
      onChange([...selected, value])
    }
  }

  const handleRemove = (value: string, e: React.MouseEvent) => {
    e.stopPropagation()
    onChange(selected.filter((v) => v !== value))
  }

  const clearAll = (e: React.MouseEvent) => {
    e.stopPropagation()
    onChange([])
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 justify-between text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border-none hover:bg-zinc-200 dark:hover:bg-zinc-700",
            className
          )}
        >
          <div className="flex items-center gap-1.5 truncate">
            {selected.length === 0 ? (
              <span className="text-zinc-500">{placeholder}</span>
            ) : selected.length <= maxDisplay ? (
              selectedLabels.map((label, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 h-5 bg-zinc-200 dark:bg-zinc-700"
                >
                  {label}
                  <button
                    className="ml-1 hover:text-red-500"
                    onClick={(e) => handleRemove(selected[i], e)}
                  >
                    <X className="size-2.5" />
                  </button>
                </Badge>
              ))
            ) : (
              <Badge
                variant="secondary"
                className="text-[10px] px-1.5 py-0 h-5 bg-zinc-200 dark:bg-zinc-700"
              >
                {selected.length} selected
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1 ml-2">
            {selected.length > 0 && (
              <button
                className="hover:text-red-500 p-0.5"
                onClick={clearAll}
              >
                <X className="size-3" />
              </button>
            )}
            <ChevronsUpDown className="size-3 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          {showSearch && (
            <CommandInput placeholder={searchPlaceholder} className="h-9" />
          )}
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  onSelect={() => handleSelect(option.value)}
                  className="text-xs"
                >
                  <div
                    className={cn(
                      "mr-2 flex size-4 items-center justify-center rounded-sm border",
                      selected.includes(option.value)
                        ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900 border-zinc-900 dark:border-zinc-50"
                        : "border-zinc-300 dark:border-zinc-600"
                    )}
                  >
                    {selected.includes(option.value) && (
                      <Check className="size-3" />
                    )}
                  </div>
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

// Tri-state multi-select for content warnings (include/exclude/neutral)
interface TriStateOption {
  value: string
  label: string
  state: 'include' | 'exclude' | 'neutral'
}

interface TriStateMultiSelectProps {
  options: readonly { value: string; label: string }[]
  included: string[]
  excluded: string[]
  onIncludedChange: (values: string[]) => void
  onExcludedChange: (values: string[]) => void
  placeholder?: string
  className?: string
}

export function TriStateMultiSelect({
  options,
  included,
  excluded,
  onIncludedChange,
  onExcludedChange,
  placeholder = "Content Warnings",
  className,
}: TriStateMultiSelectProps) {
  const [open, setOpen] = React.useState(false)

  const getState = (value: string): 'include' | 'exclude' | 'neutral' => {
    if (included.includes(value)) return 'include'
    if (excluded.includes(value)) return 'exclude'
    return 'neutral'
  }

  const cycleState = (value: string) => {
    const currentState = getState(value)
    
    if (currentState === 'neutral') {
      // neutral -> exclude (most common use case for content warnings)
      onExcludedChange([...excluded, value])
    } else if (currentState === 'exclude') {
      // exclude -> include
      onExcludedChange(excluded.filter(v => v !== value))
      onIncludedChange([...included, value])
    } else {
      // include -> neutral
      onIncludedChange(included.filter(v => v !== value))
    }
  }

  const activeCount = included.length + excluded.length

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "h-9 justify-between text-xs rounded-full bg-zinc-100 dark:bg-zinc-800 border-none hover:bg-zinc-200 dark:hover:bg-zinc-700",
            className
          )}
        >
          <span className={activeCount > 0 ? "" : "text-zinc-500"}>
            {activeCount > 0 ? `${activeCount} warning${activeCount > 1 ? 's' : ''} filtered` : placeholder}
          </span>
          <ChevronsUpDown className="size-3 opacity-50 ml-2" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[250px] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search warnings..." className="h-9" />
          <CommandList>
            <CommandEmpty>No warnings found.</CommandEmpty>
            <CommandGroup className="max-h-[300px] overflow-y-auto">
              <div className="px-2 py-1.5 text-[10px] text-zinc-500 uppercase tracking-wider">
                Click to cycle: Neutral → Exclude → Include
              </div>
              {options.map((option) => {
                const state = getState(option.value)
                return (
                  <CommandItem
                    key={option.value}
                    value={option.value}
                    onSelect={() => cycleState(option.value)}
                    className="text-xs"
                  >
                    <div
                      className={cn(
                        "mr-2 flex size-4 items-center justify-center rounded-sm border text-[10px] font-bold",
                        state === 'include' && "bg-green-500 text-white border-green-500",
                        state === 'exclude' && "bg-red-500 text-white border-red-500",
                        state === 'neutral' && "border-zinc-300 dark:border-zinc-600"
                      )}
                    >
                      {state === 'include' && '+'}
                      {state === 'exclude' && '-'}
                    </div>
                    {option.label}
                    {state !== 'neutral' && (
                      <Badge 
                        className={cn(
                          "ml-auto text-[9px] px-1 py-0",
                          state === 'include' && "bg-green-100 text-green-700",
                          state === 'exclude' && "bg-red-100 text-red-700"
                        )}
                      >
                        {state === 'include' ? 'must have' : 'excluded'}
                      </Badge>
                    )}
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
