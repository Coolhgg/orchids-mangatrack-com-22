"use client"

import { cn } from "@/lib/utils"
import { getRarityConfig, type AchievementRarity } from "@/lib/gamification/achievement-rarity"
import type { AchievementProgress } from "@/lib/gamification/achievement-progress"
import { Star, Crown, Sparkles, Award, Medal, Lock, Check } from "lucide-react"

/**
 * ACHIEVEMENT PROGRESS BAR COMPONENT
 * 
 * Displays achievement progress with:
 * - Visual progress bar
 * - Current/threshold text (e.g., "73 / 100 chapters")
 * - Rarity-based styling
 * - Unlock status indicator
 */

interface AchievementProgressBarProps {
  progress: AchievementProgress
  size?: "sm" | "md" | "lg"
  showDescription?: boolean
  showXp?: boolean
  className?: string
}

/**
 * Get the appropriate icon based on rarity
 */
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

/**
 * Format criteria type to human-readable label
 */
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

/**
 * Achievement Progress Bar Component
 * 
 * Shows progress toward an achievement with visual feedback.
 */
export function AchievementProgressBar({
  progress,
  size = "md",
  showDescription = true,
  showXp = true,
  className,
}: AchievementProgressBarProps) {
  const config = getRarityConfig(progress.rarity)
  
  const sizeConfig = {
    sm: {
      container: "p-3",
      icon: "size-8",
      iconInner: "size-4",
      title: "text-sm",
      description: "text-xs",
      progressText: "text-xs",
      barHeight: "h-1.5",
    },
    md: {
      container: "p-4",
      icon: "size-10",
      iconInner: "size-5",
      title: "text-base",
      description: "text-sm",
      progressText: "text-sm",
      barHeight: "h-2",
    },
    lg: {
      container: "p-5",
      icon: "size-12",
      iconInner: "size-6",
      title: "text-lg",
      description: "text-base",
      progressText: "text-base",
      barHeight: "h-2.5",
    },
  }
  
  const sizes = sizeConfig[size]
  
  return (
    <div
      className={cn(
        "rounded-2xl border transition-all",
        sizes.container,
        config.badgeBg,
        config.badgeBorder,
        progress.isUnlocked && "opacity-70",
        className
      )}
    >
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div
          className={cn(
            "rounded-full flex items-center justify-center shrink-0",
            sizes.icon,
            config.iconBg,
            config.iconColor
          )}
        >
          {progress.isUnlocked ? (
            <Check className={cn(sizes.iconInner, "text-green-500")} />
          ) : (
            getRarityIcon(progress.rarity, sizes.iconInner)
          )}
        </div>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Title Row */}
          <div className="flex items-center justify-between gap-2">
            <h4 className={cn("font-semibold truncate", sizes.title)}>
              {progress.name}
            </h4>
            {showXp && progress.xpReward > 0 && (
              <span className={cn("text-zinc-500 shrink-0", sizes.progressText)}>
                +{progress.xpReward} XP
              </span>
            )}
          </div>
          
          {/* Description */}
          {showDescription && progress.description && (
            <p className={cn("text-zinc-500 mt-0.5 line-clamp-1", sizes.description)}>
              {progress.description}
            </p>
          )}
          
          {/* Progress Bar */}
          <div className="mt-2">
            <div className={cn(
              "w-full bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden",
              sizes.barHeight
            )}>
              <div
                className={cn(
                  "h-full rounded-full transition-all duration-500",
                  progress.isUnlocked 
                    ? "bg-green-500" 
                    : getProgressBarColor(progress.rarity)
                )}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            
            {/* Progress Text */}
            <div className="flex items-center justify-between mt-1">
              <span className={cn("text-zinc-500", sizes.progressText)}>
                {progress.currentValue} / {progress.threshold} {getCriteriaLabel(progress.criteriaType)}
              </span>
              <span className={cn(
                "font-medium",
                sizes.progressText,
                progress.isUnlocked ? "text-green-500" : config.textColor
              )}>
                {progress.isUnlocked ? "Unlocked!" : `${progress.progressPercent}%`}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Get progress bar color based on rarity
 */
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

/**
 * Compact Progress Card for "Next Up" section
 */
interface CompactProgressCardProps {
  progress: AchievementProgress
  className?: string
}

export function CompactProgressCard({ progress, className }: CompactProgressCardProps) {
  const config = getRarityConfig(progress.rarity)
  
  return (
    <div
      className={cn(
        "rounded-xl border p-3 transition-all hover:scale-[1.02]",
        config.badgeBg,
        config.badgeBorder,
        className
      )}
    >
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "size-8 rounded-full flex items-center justify-center shrink-0",
            config.iconBg,
            config.iconColor
          )}
        >
          {getRarityIcon(progress.rarity, "size-4")}
        </div>
        
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{progress.name}</p>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className={cn(
                  "h-full rounded-full",
                  getProgressBarColor(progress.rarity)
                )}
                style={{ width: `${progress.progressPercent}%` }}
              />
            </div>
            <span className="text-xs text-zinc-500 shrink-0">
              {progress.progressPercent}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Achievement Progress List
 * 
 * Displays a list of achievement progress items
 */
interface AchievementProgressListProps {
  progressItems: AchievementProgress[]
  size?: "sm" | "md" | "lg"
  showDescription?: boolean
  showXp?: boolean
  emptyMessage?: string
  className?: string
}

export function AchievementProgressList({
  progressItems,
  size = "md",
  showDescription = true,
  showXp = true,
  emptyMessage = "No achievements to show",
  className,
}: AchievementProgressListProps) {
  if (progressItems.length === 0) {
    return (
      <div className="p-8 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
        <p className="text-zinc-500 text-sm">{emptyMessage}</p>
      </div>
    )
  }
  
  return (
    <div className={cn("space-y-3", className)}>
      {progressItems.map((progress) => (
        <AchievementProgressBar
          key={progress.achievementId}
          progress={progress}
          size={size}
          showDescription={showDescription}
          showXp={showXp}
        />
      ))}
    </div>
  )
}

/**
 * "Next Up" Achievement Section
 * 
 * Shows achievements closest to being unlocked
 */
interface NextUpAchievementsProps {
  progressItems: AchievementProgress[]
  title?: string
  className?: string
}

export function NextUpAchievements({
  progressItems,
  title = "Next Up",
  className,
}: NextUpAchievementsProps) {
  // Filter to only show in-progress (not unlocked, some progress made)
  const inProgress = progressItems.filter(p => !p.isUnlocked && p.progressPercent > 0)
  
  if (inProgress.length === 0) {
    return null
  }
  
  return (
    <div className={className}>
      <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider mb-3">
        {title}
      </h3>
      <div className="grid gap-2">
        {inProgress.slice(0, 3).map((progress) => (
          <CompactProgressCard
            key={progress.achievementId}
            progress={progress}
          />
        ))}
      </div>
    </div>
  )
}
