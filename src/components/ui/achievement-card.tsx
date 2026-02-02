"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { getRarityConfig, type AchievementRarity } from "@/lib/gamification/achievement-rarity"
import type { AchievementProgress } from "@/lib/gamification/achievement-progress"
import { Star, Crown, Sparkles, Award, Medal, Lock, Check, Snowflake, Sun, Leaf, CloudSnow } from "lucide-react"
import * as Tooltip from "@radix-ui/react-tooltip"

function getRarityIcon(rarity: string | null | undefined, className: string) {
  const normalizedRarity = (rarity?.toLowerCase() || 'common') as AchievementRarity
  
  switch (normalizedRarity) {
    case 'legendary':
      return <Crown className={cn(className, "fill-current")} />
    case 'epic':
      return <Sparkles className={cn(className, "fill-current")} />
    case 'rare':
      return <Star className={cn(className, "fill-current")} />
    case 'uncommon':
      return <Award className={cn(className)} />
    case 'common':
    default:
      return <Medal className={cn(className)} />
  }
}

function getProgressBarColor(rarity: string | null | undefined): string {
  const normalizedRarity = (rarity?.toLowerCase() || 'common') as AchievementRarity
  
  const colors: Record<AchievementRarity, string> = {
    common: "bg-amber-500",
    uncommon: "bg-slate-500",
    rare: "bg-yellow-500",
    epic: "bg-purple-500",
    legendary: "bg-gradient-to-r from-yellow-400 via-amber-500 to-orange-500",
  }
  
  return colors[normalizedRarity] || colors.common
}

function getCriteriaLabel(criteriaType: string): string {
  const labels: Record<string, string> = {
    chapter_count: 'chapters read',
    completed_count: 'series completed',
    library_count: 'series in library',
    follow_count: 'users followed',
    streak_count: 'day streak',
  }
  return labels[criteriaType] || 'progress'
}

function getSeasonIcon(season: string | null) {
  if (!season) return null
  const quarter = season.match(/Q(\d)/)?.[1]
  switch (quarter) {
    case '1': return <Snowflake className="size-3" />
    case '2': return <Leaf className="size-3" />
    case '3': return <Sun className="size-3" />
    case '4': return <CloudSnow className="size-3" />
    default: return null
  }
}

function getSeasonName(season: string | null): string {
  if (!season) return ''
  const [year, q] = season.split('-')
  const names: Record<string, string> = {
    'Q1': 'Winter',
    'Q2': 'Spring', 
    'Q3': 'Summer',
    'Q4': 'Fall',
  }
  return `${names[q] || q} ${year}`
}

interface AchievementCardProps {
  progress: AchievementProgress
  size?: "sm" | "md" | "lg"
  showTooltip?: boolean
  season?: string | null
  className?: string
}

export function AchievementCard({
  progress,
  size = "md",
  showTooltip = true,
  season = null,
  className,
}: AchievementCardProps) {
  const config = getRarityConfig(progress.rarity)
  const isLocked = !progress.isUnlocked
  const hasProgress = progress.progressPercent > 0 && progress.progressPercent < 100
  const isInProgress = isLocked && hasProgress
  const isSeasonal = progress.isSeasonal || season !== null

  const sizeConfig = {
    sm: {
      container: "p-3 min-w-[100px]",
      icon: "size-10",
      iconInner: "size-5",
      title: "text-[11px]",
      tag: "text-[8px] px-1.5 py-0.5",
      progress: "h-1",
      progressText: "text-[9px]",
    },
    md: {
      container: "p-4 min-w-[120px]",
      icon: "size-14",
      iconInner: "size-7",
      title: "text-xs",
      tag: "text-[9px] px-2 py-0.5",
      progress: "h-1.5",
      progressText: "text-[10px]",
    },
    lg: {
      container: "p-5 min-w-[140px]",
      icon: "size-16",
      iconInner: "size-8",
      title: "text-sm",
      tag: "text-[10px] px-2 py-1",
      progress: "h-2",
      progressText: "text-xs",
    },
  }

  const sizes = sizeConfig[size]

  const cardContent = (
    <div
      className={cn(
        "rounded-2xl border flex flex-col items-center text-center gap-2 transition-all relative group cursor-default",
        sizes.container,
        isLocked 
          ? "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800" 
          : config.badgeBg,
        isLocked 
          ? "border-zinc-200 dark:border-zinc-800" 
          : config.badgeBorder,
        !isLocked && config.hasGlow && `shadow-lg ${config.glowColor}`,
        !isLocked && config.hasAnimation && config.animationClass,
        "hover:scale-[1.02] hover:shadow-md",
        className
      )}
    >
      {isSeasonal && (
        <div className={cn(
          "absolute -top-2 left-1/2 -translate-x-1/2 rounded-full flex items-center gap-1 font-bold",
          sizes.tag,
          progress.isUnlocked 
            ? "bg-sky-500 text-white" 
            : "bg-zinc-300 dark:bg-zinc-700 text-zinc-600 dark:text-zinc-400"
        )}>
          {getSeasonIcon(season)}
          <span>{getSeasonName(season)}</span>
        </div>
      )}

      {progress.isUnlocked && (
        <div className="absolute -top-1 -right-1 bg-green-500 text-white rounded-full p-1 shadow-sm">
          <Check className="size-3" strokeWidth={3} />
        </div>
      )}

      <div
        className={cn(
          "rounded-full flex items-center justify-center transition-transform",
          sizes.icon,
          isLocked 
            ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600" 
            : cn(config.iconBg, config.iconColor),
          isLocked && "grayscale"
        )}
      >
        {isLocked ? (
          <Lock className={sizes.iconInner} />
        ) : (
          getRarityIcon(progress.rarity, sizes.iconInner)
        )}
      </div>

      <div className="space-y-1 w-full">
        <p className={cn(
          "font-bold leading-tight line-clamp-2",
          sizes.title,
          isLocked && "text-zinc-500 dark:text-zinc-500"
        )}>
          {progress.isHidden && isLocked ? "???" : progress.name}
        </p>

        {isInProgress && (
          <div className="w-full px-1">
            <div className={cn(
              "w-full bg-zinc-300 dark:bg-zinc-700 rounded-full overflow-hidden",
              sizes.progress
            )}>
              <div
                className={cn("h-full rounded-full transition-all", getProgressBarColor(progress.rarity))}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <p className={cn("text-zinc-500 mt-0.5", sizes.progressText)}>
              {progress.progressPercent}%
            </p>
          </div>
        )}

        {!isInProgress && !progress.isUnlocked && progress.progressPercent === 0 && (
          <p className={cn("text-zinc-400 dark:text-zinc-600 italic", sizes.progressText)}>
            {progress.isHidden ? "Hidden" : "Locked"}
          </p>
        )}
      </div>
    </div>
  )

  if (!showTooltip) {
    return cardContent
  }

  return (
    <Tooltip.Provider delayDuration={200}>
      <Tooltip.Root>
        <Tooltip.Trigger asChild>
          {cardContent}
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="top"
            sideOffset={8}
            className="z-50 max-w-xs animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95"
          >
            <AchievementTooltipContent progress={progress} season={season} />
            <Tooltip.Arrow className="fill-white dark:fill-zinc-900" />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}

interface AchievementTooltipContentProps {
  progress: AchievementProgress
  season?: string | null
}

export function AchievementTooltipContent({ progress, season }: AchievementTooltipContentProps) {
  const config = getRarityConfig(progress.rarity)
  const isLocked = !progress.isUnlocked

  return (
    <div className={cn(
      "rounded-xl border p-4 shadow-xl min-w-[220px] max-w-[280px]",
      "bg-white dark:bg-zinc-900",
      "border-zinc-200 dark:border-zinc-800"
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "size-10 rounded-full flex items-center justify-center shrink-0",
          isLocked 
            ? "bg-zinc-200 dark:bg-zinc-800 text-zinc-400" 
            : cn(config.iconBg, config.iconColor)
        )}>
          {isLocked ? (
            <Lock className="size-5" />
          ) : (
            getRarityIcon(progress.rarity, "size-5")
          )}
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="font-bold text-sm truncate">
              {progress.isHidden && isLocked ? "???" : progress.name}
            </h4>
            <span className={cn(
              "text-[10px] font-bold uppercase px-1.5 py-0.5 rounded",
              config.badgeBg,
              config.textColor
            )}>
              {config.label}
            </span>
          </div>
          
          {(!progress.isHidden || !isLocked) && progress.description && (
            <p className="text-xs text-zinc-500 mt-1 line-clamp-2">
              {progress.description}
            </p>
          )}
          
          {progress.isHidden && isLocked && (
            <p className="text-xs text-zinc-400 dark:text-zinc-600 italic mt-1">
              This is a hidden achievement
            </p>
          )}
        </div>
      </div>

      <div className="mt-3 pt-3 border-t border-zinc-100 dark:border-zinc-800 space-y-2">
        {(!progress.isHidden || !isLocked) && (
          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-zinc-500">Progress</span>
              <span className={cn("font-semibold", progress.isUnlocked ? "text-green-500" : config.textColor)}>
                {progress.isUnlocked ? "Complete!" : `${progress.progressPercent}%`}
              </span>
            </div>
            <div className="h-2 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  progress.isUnlocked ? "bg-green-500" : getProgressBarColor(progress.rarity)
                )}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <p className="text-[11px] text-zinc-500 mt-1">
              {progress.currentValue} / {progress.threshold} {getCriteriaLabel(progress.criteriaType)}
            </p>
          </div>
        )}

        <div className="flex items-center justify-between">
          <span className="text-xs text-zinc-500">Reward</span>
          <span className="text-xs font-bold text-amber-600 dark:text-amber-400">
            +{progress.xpReward} XP
          </span>
        </div>

        {progress.isUnlocked && progress.unlockedAt && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Unlocked</span>
            <span className="text-xs text-zinc-600 dark:text-zinc-400">
              {new Date(progress.unlockedAt).toLocaleDateString()}
            </span>
          </div>
        )}

        {season && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-500">Season</span>
            <span className="text-xs font-medium text-sky-600 dark:text-sky-400 flex items-center gap-1">
              {getSeasonIcon(season)}
              {getSeasonName(season)}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

interface AchievementCardGridProps {
  achievements: AchievementProgress[]
  size?: "sm" | "md" | "lg"
  showTooltip?: boolean
  columns?: 2 | 3 | 4 | 5
  emptyMessage?: string
  className?: string
}

export function AchievementCardGrid({
  achievements,
  size = "md",
  showTooltip = true,
  columns = 4,
  emptyMessage = "No achievements to display",
  className,
}: AchievementCardGridProps) {
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-3 md:grid-cols-4",
    5: "grid-cols-2 sm:grid-cols-3 md:grid-cols-5",
  }

  if (achievements.length === 0) {
    return (
      <div className="col-span-full p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
        <p className="text-zinc-500 text-sm font-medium">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {achievements.map((progress) => (
        <AchievementCard
          key={progress.achievementId}
          progress={progress}
          size={size}
          showTooltip={showTooltip}
        />
      ))}
    </div>
  )
}
