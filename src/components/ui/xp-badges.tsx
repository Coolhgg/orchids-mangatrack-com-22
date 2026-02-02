"use client"

import { cn } from "@/lib/utils"
import { Snowflake, Leaf, Sun, CloudSun } from "lucide-react"

type SeasonKey = 'winter' | 'spring' | 'summer' | 'fall'

interface LevelBadgeProps {
  level: number
  size?: 'sm' | 'md' | 'lg' | 'xl'
  showLabel?: boolean
  className?: string
}

interface SeasonBadgeProps {
  seasonKey: SeasonKey
  seasonName: string
  year: number
  size?: 'sm' | 'md' | 'lg'
  showYear?: boolean
  className?: string
}

// Level badge colors based on level tiers
function getLevelTier(level: number): { bg: string; border: string; text: string; glow: string } {
  if (level >= 100) {
    // Legendary - Gold/Amber with glow
    return {
      bg: 'bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600',
      border: 'border-amber-300',
      text: 'text-amber-950',
      glow: 'shadow-amber-500/50 shadow-lg'
    }
  }
  if (level >= 50) {
    // Epic - Purple
    return {
      bg: 'bg-gradient-to-br from-purple-500 via-violet-600 to-purple-700',
      border: 'border-purple-400',
      text: 'text-white',
      glow: 'shadow-purple-500/30 shadow-md'
    }
  }
  if (level >= 25) {
    // Rare - Blue
    return {
      bg: 'bg-gradient-to-br from-blue-500 via-blue-600 to-blue-700',
      border: 'border-blue-400',
      text: 'text-white',
      glow: 'shadow-blue-500/20 shadow-sm'
    }
  }
  if (level >= 10) {
    // Uncommon - Green
    return {
      bg: 'bg-gradient-to-br from-emerald-500 via-green-600 to-emerald-700',
      border: 'border-emerald-400',
      text: 'text-white',
      glow: ''
    }
  }
  // Common - Gray
  return {
    bg: 'bg-gradient-to-br from-zinc-400 via-zinc-500 to-zinc-600',
    border: 'border-zinc-300',
    text: 'text-white',
    glow: ''
  }
}

const levelSizes = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-14 text-lg'
}

/**
 * Level Badge Component
 * Displays user level with tier-based styling
 */
export function LevelBadge({ level, size = 'md', showLabel = false, className }: LevelBadgeProps) {
  const tier = getLevelTier(level)
  
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div 
        className={cn(
          "rounded-full flex items-center justify-center font-bold border-2",
          levelSizes[size],
          tier.bg,
          tier.border,
          tier.text,
          tier.glow
        )}
      >
        {level}
      </div>
      {showLabel && (
        <span className="text-sm font-medium text-muted-foreground">
          Level {level}
        </span>
      )}
    </div>
  )
}

// Season styling
const SEASON_STYLES: Record<SeasonKey, { 
  icon: typeof Snowflake
  color: string 
  bg: string
  border: string
}> = {
  winter: { 
    icon: Snowflake, 
    color: 'text-blue-400', 
    bg: 'bg-blue-50 dark:bg-blue-900/20',
    border: 'border-blue-200 dark:border-blue-800'
  },
  spring: { 
    icon: Leaf, 
    color: 'text-pink-400', 
    bg: 'bg-pink-50 dark:bg-pink-900/20',
    border: 'border-pink-200 dark:border-pink-800'
  },
  summer: { 
    icon: Sun, 
    color: 'text-orange-400', 
    bg: 'bg-orange-50 dark:bg-orange-900/20',
    border: 'border-orange-200 dark:border-orange-800'
  },
  fall: { 
    icon: CloudSun, 
    color: 'text-amber-500', 
    bg: 'bg-amber-50 dark:bg-amber-900/20',
    border: 'border-amber-200 dark:border-amber-800'
  },
}

const seasonSizes = {
  sm: 'px-2 py-1 text-xs gap-1.5',
  md: 'px-3 py-1.5 text-sm gap-2',
  lg: 'px-4 py-2 text-base gap-2.5'
}

const seasonIconSizes = {
  sm: 'size-3',
  md: 'size-4',
  lg: 'size-5'
}

/**
 * Season Badge Component
 * Displays current anime season with themed styling
 */
export function SeasonBadge({ 
  seasonKey, 
  seasonName, 
  year, 
  size = 'md', 
  showYear = true,
  className 
}: SeasonBadgeProps) {
  const style = SEASON_STYLES[seasonKey]
  const Icon = style.icon
  
  return (
    <div 
      className={cn(
        "inline-flex items-center rounded-full border font-medium",
        seasonSizes[size],
        style.bg,
        style.border,
        className
      )}
    >
      <Icon className={cn(seasonIconSizes[size], style.color)} />
      <span className={style.color}>
        {seasonName}{showYear && ` ${year}`}
      </span>
    </div>
  )
}

/**
 * Rank Badge Component
 * Shows user's seasonal rank position
 */
interface RankBadgeProps {
  rank: number
  totalParticipants: number
  percentile: number
  className?: string
}

export function RankBadge({ rank, totalParticipants, percentile, className }: RankBadgeProps) {
  // Determine rank tier styling
  const getRankStyle = () => {
    if (rank === 1) return 'bg-yellow-500 text-yellow-950 border-yellow-400'
    if (rank === 2) return 'bg-zinc-400 text-white border-zinc-300'
    if (rank === 3) return 'bg-amber-600 text-white border-amber-500'
    if (percentile <= 10) return 'bg-purple-500 text-white border-purple-400'
    if (percentile <= 25) return 'bg-blue-500 text-white border-blue-400'
    return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
  }

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className={cn(
        "px-2.5 py-1 rounded-full text-sm font-bold border",
        getRankStyle()
      )}>
        #{rank}
      </div>
      <span className="text-xs text-muted-foreground">
        of {totalParticipants.toLocaleString()}
      </span>
    </div>
  )
}
