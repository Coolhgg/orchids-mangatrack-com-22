"use client"

import { Star, Crown, Sparkles, Award, Medal, Lock, Eye } from "lucide-react"
import { cn } from "@/lib/utils"
import { getRarityConfig, type AchievementRarity } from "@/lib/gamification/achievement-rarity"

/**
 * ACHIEVEMENT BADGE COMPONENT
 * 
 * Displays achievements with rarity-based visuals.
 * 
 * RULES (LOCKED):
 * 1. Rarity affects UI only (badge color, animation, icon)
 * 2. XP reward is displayed as-is (NEVER modified by rarity)
 * 3. XP is NEVER multiplied by rarity
 * 
 * HIDDEN ACHIEVEMENTS:
 * 1. is_hidden=true hides achievement from UI until unlocked
 * 2. Unlock reveals achievement (shown with "revealed" indicator)
 * 3. XP still granted normally
 */

export interface Achievement {
  id: string
  name: string
  description?: string | null
  rarity?: string | null
  xp_reward?: number
  code?: string
  is_hidden?: boolean | null
}

export interface UserAchievement {
  id: string
  unlocked_at: string
  achievement?: Achievement
  achievements?: Achievement // Alternative shape from some queries
}

interface AchievementBadgeProps {
  /** User achievement data (includes achievement details and unlock date) */
  userAchievement: UserAchievement
  /** Size variant */
  size?: "sm" | "md" | "lg"
  /** Whether to show the unlock date */
  showDate?: boolean
  /** Whether to show XP reward */
  showXp?: boolean
  /** Whether to show rarity label */
  showRarity?: boolean
  /** Whether to show "revealed" indicator for hidden achievements */
  showRevealed?: boolean
  /** Additional className */
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
 * Achievement Badge Component
 * 
 * Displays an achievement with rarity-based visual styling.
 * Rarity affects ONLY the visual presentation (colors, icons, animations).
 * XP values are displayed as-is and never modified.
 */
export function AchievementBadge({
  userAchievement,
  size = "md",
  showDate = true,
  showXp = false,
  showRarity = false,
  showRevealed = true,
  className,
}: AchievementBadgeProps) {
  // Support both achievement shapes from API
  const achievement = userAchievement.achievement || userAchievement.achievements
  
  if (!achievement) {
    return null
  }
  
  const config = getRarityConfig(achievement.rarity)
  const isHiddenAchievement = achievement.is_hidden === true
  
  // Size configurations
  const sizeConfig = {
    sm: {
      container: "p-3",
      icon: "size-8",
      iconInner: "size-4",
      title: "text-[10px]",
      date: "text-[8px]",
      xp: "text-[8px]",
      rarity: "text-[8px]",
      revealed: "text-[8px]",
    },
    md: {
      container: "p-4",
      icon: "size-12",
      iconInner: "size-6",
      title: "text-xs",
      date: "text-[10px]",
      xp: "text-[10px]",
      rarity: "text-[10px]",
      revealed: "text-[10px]",
    },
    lg: {
      container: "p-6",
      icon: "size-16",
      iconInner: "size-8",
      title: "text-sm",
      date: "text-xs",
      xp: "text-xs",
      rarity: "text-xs",
      revealed: "text-xs",
    },
  }
  
  const sizes = sizeConfig[size]
  
  return (
    <div
      className={cn(
        // Base styles
        "rounded-2xl border flex flex-col items-center text-center gap-2 transition-all relative",
        sizes.container,
        // Rarity-based styles
        config.badgeBg,
        config.badgeBorder,
        // Glow effect for epic/legendary
        config.hasGlow && `shadow-lg ${config.glowColor}`,
        // Animation for legendary
        config.hasAnimation && config.animationClass,
        className
      )}
    >
      {/* "Revealed" indicator for hidden achievements */}
      {showRevealed && isHiddenAchievement && (
        <div className="absolute -top-1 -right-1 bg-purple-500 text-white rounded-full p-1" title="Secret Achievement Revealed!">
          <Eye className="size-3" />
        </div>
      )}
      
      {/* Icon container */}
      <div
        className={cn(
          "rounded-full flex items-center justify-center transition-transform hover:scale-110",
          sizes.icon,
          config.iconBg,
          config.iconColor
        )}
      >
        {getRarityIcon(achievement.rarity, sizes.iconInner)}
      </div>
      
      {/* Achievement info */}
      <div className="space-y-0.5">
        <p className={cn("font-bold leading-tight", sizes.title)}>
          {achievement.name}
        </p>
        
        {showRevealed && isHiddenAchievement && (
          <p className={cn("text-purple-500 font-medium uppercase tracking-wider", sizes.revealed)}>
            Secret
          </p>
        )}
        
        {showRarity && (
          <p className={cn("font-semibold uppercase tracking-wider", sizes.rarity, config.textColor)}>
            {config.label}
          </p>
        )}
        
        {showXp && achievement.xp_reward && achievement.xp_reward > 0 && (
          <p className={cn("text-zinc-500", sizes.xp)}>
            +{achievement.xp_reward} XP
          </p>
        )}
        
        {showDate && (
          <p className={cn("text-zinc-500", sizes.date)}>
            {new Date(userAchievement.unlocked_at).toLocaleDateString()}
          </p>
        )}
      </div>
    </div>
  )
}

/**
 * Hidden Achievement Placeholder Component
 * 
 * Used to show locked hidden achievements (before unlock).
 * Shows mystery placeholder instead of actual achievement details.
 */
interface HiddenAchievementPlaceholderProps {
  size?: "sm" | "md" | "lg"
  className?: string
}

export function HiddenAchievementPlaceholder({
  size = "md",
  className,
}: HiddenAchievementPlaceholderProps) {
  const sizeConfig = {
    sm: {
      container: "p-3",
      icon: "size-8",
      iconInner: "size-4",
      title: "text-[10px]",
      hint: "text-[8px]",
    },
    md: {
      container: "p-4",
      icon: "size-12",
      iconInner: "size-6",
      title: "text-xs",
      hint: "text-[10px]",
    },
    lg: {
      container: "p-6",
      icon: "size-16",
      iconInner: "size-8",
      title: "text-sm",
      hint: "text-xs",
    },
  }
  
  const sizes = sizeConfig[size]
  
  return (
    <div
      className={cn(
        "rounded-2xl border flex flex-col items-center text-center gap-2",
        sizes.container,
        "bg-zinc-100 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800",
        "opacity-60",
        className
      )}
    >
      <div
        className={cn(
          "rounded-full flex items-center justify-center",
          sizes.icon,
          "bg-zinc-200 dark:bg-zinc-800 text-zinc-400 dark:text-zinc-600"
        )}
      >
        <Lock className={sizes.iconInner} />
      </div>
      
      <div className="space-y-0.5">
        <p className={cn("font-bold leading-tight text-zinc-400 dark:text-zinc-600", sizes.title)}>
          ???
        </p>
        <p className={cn("text-zinc-400 dark:text-zinc-600 italic", sizes.hint)}>
          Hidden achievement
        </p>
      </div>
    </div>
  )
}

/**
 * Achievement Toast Component
 * 
 * Used for displaying achievement unlock notifications.
 * Shows the achievement with full rarity styling and animation.
 */
interface AchievementToastProps {
  achievement: Achievement
  className?: string
}

export function AchievementToast({ achievement, className }: AchievementToastProps) {
  const config = getRarityConfig(achievement.rarity)
  const isHiddenAchievement = achievement.is_hidden === true
  
  return (
    <div
      className={cn(
        "flex items-center gap-3 p-4 rounded-2xl border",
        config.badgeBg,
        config.badgeBorder,
        config.hasGlow && `shadow-lg ${config.glowColor}`,
        className
      )}
    >
      <div
        className={cn(
          "size-12 rounded-full flex items-center justify-center shrink-0",
          config.iconBg,
          config.iconColor,
          config.hasAnimation && config.animationClass
        )}
      >
        {getRarityIcon(achievement.rarity, "size-6")}
      </div>
      
      <div className="flex-1 min-w-0">
        <p className="text-xs font-bold text-zinc-500 uppercase tracking-wider">
          {isHiddenAchievement ? "Secret Achievement Unlocked!" : "Achievement Unlocked!"}
        </p>
        <p className="font-bold truncate">{achievement.name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={cn("text-xs font-semibold", config.textColor)}>
            {config.label}
          </span>
          {isHiddenAchievement && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">•</span>
              <span className="text-xs text-purple-500 font-medium">Secret</span>
            </>
          )}
          {achievement.xp_reward && achievement.xp_reward > 0 && (
            <>
              <span className="text-zinc-300 dark:text-zinc-600">•</span>
              <span className="text-xs text-zinc-500">+{achievement.xp_reward} XP</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * Achievement Grid Component
 * 
 * Displays a grid of achievements sorted by rarity (legendary first).
 */
interface AchievementGridProps {
  achievements: UserAchievement[]
  size?: "sm" | "md" | "lg"
  showDate?: boolean
  showXp?: boolean
  showRarity?: boolean
  showRevealed?: boolean
  columns?: 2 | 3 | 4
  className?: string
}

export function AchievementGrid({
  achievements,
  size = "md",
  showDate = true,
  showXp = false,
  showRarity = false,
  showRevealed = true,
  columns = 4,
  className,
}: AchievementGridProps) {
  // Sort by rarity (legendary first)
  const sortedAchievements = [...achievements].sort((a, b) => {
    const aRarity = a.achievement?.rarity || a.achievements?.rarity || 'common'
    const bRarity = b.achievement?.rarity || b.achievements?.rarity || 'common'
    const order: Record<string, number> = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 }
    return (order[bRarity.toLowerCase()] || 1) - (order[aRarity.toLowerCase()] || 1)
  })
  
  const gridCols = {
    2: "grid-cols-2",
    3: "grid-cols-2 sm:grid-cols-3",
    4: "grid-cols-2 sm:grid-cols-4",
  }
  
  if (achievements.length === 0) {
    return (
      <div className="col-span-full p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
        <p className="text-zinc-500 text-sm font-medium">No achievements yet</p>
      </div>
    )
  }
  
  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {sortedAchievements.map((ua) => (
        <AchievementBadge
          key={ua.id}
          userAchievement={ua}
          size={size}
          showDate={showDate}
          showXp={showXp}
          showRarity={showRarity}
          showRevealed={showRevealed}
        />
      ))}
    </div>
  )
}
