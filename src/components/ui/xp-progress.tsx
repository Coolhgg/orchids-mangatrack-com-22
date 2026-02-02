"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

interface XpProgressBarProps {
  /** Current XP within level (0 to xpForNext) */
  current: number
  /** XP required for next level */
  total: number
  /** Progress percentage (0-100) - takes precedence over current/total */
  progress?: number
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Show XP text label */
  showLabel?: boolean
  /** Color variant */
  variant?: 'default' | 'seasonal' | 'lifetime'
  /** Additional class names */
  className?: string
  /** Animate the progress bar fill */
  animated?: boolean
}

const sizeStyles = {
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4'
}

const variantStyles = {
  default: {
    track: 'bg-zinc-200 dark:bg-zinc-800',
    bar: 'bg-blue-500'
  },
  seasonal: {
    track: 'bg-purple-100 dark:bg-purple-900/30',
    bar: 'bg-gradient-to-r from-purple-500 to-pink-500'
  },
  lifetime: {
    track: 'bg-amber-100 dark:bg-amber-900/30',
    bar: 'bg-gradient-to-r from-amber-500 to-yellow-400'
  }
}

/**
 * XP Progress Bar Component
 * Shows progress towards next level or seasonal goal
 */
export function XpProgressBar({
  current,
  total,
  progress: progressProp,
  size = 'md',
  showLabel = false,
  variant = 'default',
  className,
  animated = true
}: XpProgressBarProps) {
  // Calculate progress percentage
  const progress = progressProp ?? (total > 0 ? Math.min(100, (current / total) * 100) : 0)
  const styles = variantStyles[variant]

  return (
    <div className={cn("w-full", className)}>
      {showLabel && (
        <div className="flex justify-between items-center mb-1.5 text-xs text-muted-foreground">
          <span>{current.toLocaleString()} XP</span>
          <span>{total.toLocaleString()} XP</span>
        </div>
      )}
      <div 
        className={cn(
          "w-full rounded-full overflow-hidden",
          sizeStyles[size],
          styles.track
        )}
      >
        <div 
          className={cn(
            "h-full rounded-full",
            styles.bar,
            animated && "transition-all duration-500 ease-out"
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}

interface SeasonCountdownProps {
  daysRemaining: number
  seasonProgress: number
  className?: string
}

/**
 * Season Countdown Component
 * Shows days remaining and progress through current season
 */
export function SeasonCountdown({ daysRemaining, seasonProgress, className }: SeasonCountdownProps) {
  // Determine urgency styling
  const getUrgencyStyle = () => {
    if (daysRemaining <= 7) return 'text-red-500 bg-red-50 dark:bg-red-900/20'
    if (daysRemaining <= 14) return 'text-amber-500 bg-amber-50 dark:bg-amber-900/20'
    return 'text-muted-foreground bg-zinc-50 dark:bg-zinc-900/50'
  }

  return (
    <div className={cn("space-y-2", className)}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Season Progress</span>
        <span className={cn(
          "text-sm font-bold px-2 py-0.5 rounded-full",
          getUrgencyStyle()
        )}>
          {daysRemaining} days left
        </span>
      </div>
      <div className="w-full h-2 rounded-full bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
        <div 
          className="h-full rounded-full bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500 transition-all duration-500"
          style={{ width: `${seasonProgress}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground uppercase tracking-wider">
        <span>Season Start</span>
        <span>Season End</span>
      </div>
    </div>
  )
}

interface XpStatProps {
  label: string
  value: number | string
  sublabel?: string
  icon?: React.ReactNode
  variant?: 'default' | 'highlight'
  className?: string
}

/**
 * XP Stat Display Component
 * Shows a single XP stat with label
 */
export function XpStat({ label, value, sublabel, icon, variant = 'default', className }: XpStatProps) {
  return (
    <div className={cn(
      "flex flex-col",
      variant === 'highlight' && "bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-900/20 dark:to-purple-900/20 rounded-xl p-3",
      className
    )}>
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-0.5">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cn(
        "font-bold",
        variant === 'highlight' ? "text-2xl" : "text-lg"
      )}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </div>
      {sublabel && (
        <div className="text-xs text-muted-foreground mt-0.5">{sublabel}</div>
      )}
    </div>
  )
}
