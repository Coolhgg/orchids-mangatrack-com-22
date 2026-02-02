/**
 * ACHIEVEMENT RARITY WEIGHTING
 * 
 * Rarity affects DISPLAY ONLY, not XP math.
 * 
 * RULES (LOCKED):
 * 1. Rarity affects UI only (badge color, animation, icon)
 * 2. XP reward remains FIXED per achievement
 * 3. XP is NEVER multiplied by rarity
 * 
 * RARITY TIERS:
 * - common    → Bronze badge
 * - uncommon  → Silver badge  
 * - rare      → Gold badge
 * - epic      → Purple badge + glow
 * - legendary → Gold badge + animation + special effects
 */

export type AchievementRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

export interface RarityConfig {
  /** Display name for the rarity tier */
  label: string;
  
  /** Badge background color (Tailwind class) */
  badgeBg: string;
  
  /** Badge border color (Tailwind class) */
  badgeBorder: string;
  
  /** Icon background color (Tailwind class) */
  iconBg: string;
  
  /** Icon color (Tailwind class) */
  iconColor: string;
  
  /** Text color for rarity label (Tailwind class) */
  textColor: string;
  
  /** Whether to show glow effect */
  hasGlow: boolean;
  
  /** Whether to show pulse animation */
  hasAnimation: boolean;
  
  /** CSS animation class (if any) */
  animationClass: string;
  
  /** Glow color for special effects (Tailwind class) */
  glowColor: string;
}

/**
 * BADGE MAPPING - Rarity to visual configuration
 * 
 * UI RULES:
 * - Common: Bronze/brown tones, no effects
 * - Uncommon: Silver/gray tones, no effects
 * - Rare: Gold/yellow tones, no effects
 * - Epic: Purple tones, subtle glow
 * - Legendary: Gold + rainbow, animation + glow
 */
export const RARITY_CONFIG: Record<AchievementRarity, RarityConfig> = {
  common: {
    label: 'Common',
    badgeBg: 'bg-amber-50 dark:bg-amber-950/30',
    badgeBorder: 'border-amber-200 dark:border-amber-800/50',
    iconBg: 'bg-amber-100 dark:bg-amber-900/50',
    iconColor: 'text-amber-600 dark:text-amber-400',
    textColor: 'text-amber-600 dark:text-amber-400',
    hasGlow: false,
    hasAnimation: false,
    animationClass: '',
    glowColor: '',
  },
  
  uncommon: {
    label: 'Uncommon',
    badgeBg: 'bg-slate-50 dark:bg-slate-900/50',
    badgeBorder: 'border-slate-300 dark:border-slate-600',
    iconBg: 'bg-slate-200 dark:bg-slate-800',
    iconColor: 'text-slate-600 dark:text-slate-300',
    textColor: 'text-slate-600 dark:text-slate-400',
    hasGlow: false,
    hasAnimation: false,
    animationClass: '',
    glowColor: '',
  },
  
  rare: {
    label: 'Rare',
    badgeBg: 'bg-yellow-50 dark:bg-yellow-950/30',
    badgeBorder: 'border-yellow-300 dark:border-yellow-700',
    iconBg: 'bg-yellow-100 dark:bg-yellow-900/50',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    textColor: 'text-yellow-600 dark:text-yellow-400',
    hasGlow: false,
    hasAnimation: false,
    animationClass: '',
    glowColor: '',
  },
  
  epic: {
    label: 'Epic',
    badgeBg: 'bg-purple-50 dark:bg-purple-950/30',
    badgeBorder: 'border-purple-300 dark:border-purple-700',
    iconBg: 'bg-purple-100 dark:bg-purple-900/50',
    iconColor: 'text-purple-600 dark:text-purple-400',
    textColor: 'text-purple-600 dark:text-purple-400',
    hasGlow: true,
    hasAnimation: false,
    animationClass: '',
    glowColor: 'shadow-purple-500/25',
  },
  
  legendary: {
    label: 'Legendary',
    badgeBg: 'bg-gradient-to-br from-yellow-50 via-amber-50 to-orange-50 dark:from-yellow-950/40 dark:via-amber-950/40 dark:to-orange-950/40',
    badgeBorder: 'border-yellow-400 dark:border-yellow-600',
    iconBg: 'bg-gradient-to-br from-yellow-200 to-amber-300 dark:from-yellow-800 dark:to-amber-700',
    iconColor: 'text-yellow-700 dark:text-yellow-200',
    textColor: 'text-yellow-700 dark:text-yellow-300',
    hasGlow: true,
    hasAnimation: true,
    animationClass: 'animate-pulse',
    glowColor: 'shadow-yellow-500/40',
  },
};

/**
 * Get rarity configuration for an achievement
 * Defaults to 'common' if rarity is invalid or missing
 */
export function getRarityConfig(rarity: string | null | undefined): RarityConfig {
  const normalizedRarity = (rarity?.toLowerCase() || 'common') as AchievementRarity;
  return RARITY_CONFIG[normalizedRarity] || RARITY_CONFIG.common;
}

/**
 * Get rarity sort order (for sorting achievements by rarity)
 * Higher number = rarer
 */
export function getRaritySortOrder(rarity: string | null | undefined): number {
  const order: Record<AchievementRarity, number> = {
    common: 1,
    uncommon: 2,
    rare: 3,
    epic: 4,
    legendary: 5,
  };
  const normalizedRarity = (rarity?.toLowerCase() || 'common') as AchievementRarity;
  return order[normalizedRarity] || 1;
}

/**
 * Sort achievements by rarity (legendary first)
 */
export function sortByRarity<T extends { rarity?: string | null }>(achievements: T[]): T[] {
  return [...achievements].sort((a, b) => {
    return getRaritySortOrder(b.rarity) - getRaritySortOrder(a.rarity);
  });
}
