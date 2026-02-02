/**
 * ANIME-STYLE SEASONAL XP SYSTEM
 * 
 * SEASON MODEL (LOCKED):
 * - Winter: Jan 1 – Mar 31 (Q1)
 * - Spring: Apr 1 – Jun 30 (Q2)
 * - Summer: Jul 1 – Sep 30 (Q3)
 * - Fall:   Oct 1 – Dec 31 (Q4)
 * 
 * RULES:
 * 1. Seasons are quarterly, aligned with anime broadcast seasons
 * 2. season_xp resets to 0 at the start of each new season
 * 3. lifetime xp (users.xp) NEVER resets
 * 4. XP gains update BOTH lifetime_xp and season_xp atomically
 * 
 * SEASON FORMAT: "YYYY-Q[1-4]" (e.g., "2026-Q1" for Winter 2026)
 * 
 * SEASONAL ACHIEVEMENTS:
 * - Achievements with is_seasonal=true can only unlock during their season
 * - Users can re-earn the same seasonal achievement each season
 * - XP awarded once per season per achievement
 */

import { TransactionClient } from '../prisma';

/**
 * Anime season definitions
 */
export type AnimeSeasonKey = 'winter' | 'spring' | 'summer' | 'fall';

export interface AnimeSeason {
  key: AnimeSeasonKey;
  quarter: 1 | 2 | 3 | 4;
  name: string;
  months: [number, number, number]; // 1-indexed months
  startMonth: number;
  endMonth: number;
}

export const ANIME_SEASONS: Record<AnimeSeasonKey, AnimeSeason> = {
  winter: {
    key: 'winter',
    quarter: 1,
    name: 'Winter',
    months: [1, 2, 3],
    startMonth: 1,
    endMonth: 3,
  },
  spring: {
    key: 'spring',
    quarter: 2,
    name: 'Spring',
    months: [4, 5, 6],
    startMonth: 4,
    endMonth: 6,
  },
  summer: {
    key: 'summer',
    quarter: 3,
    name: 'Summer',
    months: [7, 8, 9],
    startMonth: 7,
    endMonth: 9,
  },
  fall: {
    key: 'fall',
    quarter: 4,
    name: 'Fall',
    months: [10, 11, 12],
    startMonth: 10,
    endMonth: 12,
  },
};

/**
 * Get anime season from month (1-indexed)
 */
export function getSeasonFromMonth(month: number): AnimeSeason {
  if (month >= 1 && month <= 3) return ANIME_SEASONS.winter;
  if (month >= 4 && month <= 6) return ANIME_SEASONS.spring;
  if (month >= 7 && month <= 9) return ANIME_SEASONS.summer;
  return ANIME_SEASONS.fall;
}

/**
 * Returns the current season identifier in "YYYY-Q[1-4]" format
 * Example: "2026-Q1" for Winter 2026 (January-March)
 */
export function getCurrentSeason(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1; // 1-indexed
  const season = getSeasonFromMonth(month);
  return `${year}-Q${season.quarter}`;
}

/**
 * Returns detailed info about the current season
 */
export function getCurrentSeasonInfo(): {
  code: string;
  key: AnimeSeasonKey;
  name: string;
  year: number;
  quarter: number;
  displayName: string;
} {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const season = getSeasonFromMonth(month);
  
  return {
    code: `${year}-Q${season.quarter}`,
    key: season.key,
    name: season.name,
    year,
    quarter: season.quarter,
    displayName: `${season.name} ${year}`,
  };
}

/**
 * Checks if a user's current_season is outdated and needs rollover
 * @param userCurrentSeason The season stored in user's profile (can be null for new users)
 * @returns true if season_xp should be reset
 */
export function needsSeasonRollover(userCurrentSeason: string | null): boolean {
  if (!userCurrentSeason) return true; // New user, initialize
  return userCurrentSeason !== getCurrentSeason();
}

/**
 * Parses a season string into year and quarter
 * Supports both new format (YYYY-Q[1-4]) and legacy format (YYYY-MM)
 */
export function parseSeason(season: string): { year: number; quarter: number; key: AnimeSeasonKey } | null {
  // New format: YYYY-Q[1-4]
  const quarterMatch = season.match(/^(\d{4})-Q([1-4])$/);
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[2], 10) as 1 | 2 | 3 | 4;
    const key = Object.values(ANIME_SEASONS).find(s => s.quarter === quarter)!.key;
    return {
      year: parseInt(quarterMatch[1], 10),
      quarter,
      key,
    };
  }
  
  // Legacy format: YYYY-MM (convert to quarter)
  const monthMatch = season.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) {
    const year = parseInt(monthMatch[1], 10);
    const month = parseInt(monthMatch[2], 10);
    const animeSeason = getSeasonFromMonth(month);
    return {
      year,
      quarter: animeSeason.quarter,
      key: animeSeason.key,
    };
  }
  
  return null;
}

/**
 * Validates a season string format (new quarterly format)
 */
export function isValidSeason(season: string): boolean {
  // Accept both new format (YYYY-Q[1-4]) and legacy format (YYYY-MM) for backwards compatibility
  return /^\d{4}-Q[1-4]$/.test(season) || /^\d{4}-(0[1-9]|1[0-2])$/.test(season);
}

/**
 * Validates strict quarterly format only
 */
export function isValidQuarterlySeason(season: string): boolean {
  return /^\d{4}-Q[1-4]$/.test(season);
}

/**
 * Gets the display name for a season (anime-style)
 * Example: "Winter 2026", "Spring 2026"
 */
export function getSeasonDisplayName(season: string): string {
  const parsed = parseSeason(season);
  if (!parsed) return season;
  
  const seasonInfo = Object.values(ANIME_SEASONS).find(s => s.quarter === parsed.quarter);
  if (!seasonInfo) return season;
  
  return `${seasonInfo.name} ${parsed.year}`;
}

/**
 * Gets the short display name for a season
 * Example: "Winter '26", "Spring '26"
 */
export function getSeasonShortName(season: string): string {
  const parsed = parseSeason(season);
  if (!parsed) return season;
  
  const seasonInfo = Object.values(ANIME_SEASONS).find(s => s.quarter === parsed.quarter);
  if (!seasonInfo) return season;
  
  return `${seasonInfo.name} '${String(parsed.year).slice(2)}`;
}

/**
 * Gets the start and end dates for a season
 */
export function getSeasonDateRange(season: string): { start: Date; end: Date } | null {
  const parsed = parseSeason(season);
  if (!parsed) return null;
  
  const seasonInfo = Object.values(ANIME_SEASONS).find(s => s.quarter === parsed.quarter);
  if (!seasonInfo) return null;
  
  // Start: First day of first month at 00:00:00.000 UTC
  const start = new Date(Date.UTC(parsed.year, seasonInfo.startMonth - 1, 1, 0, 0, 0, 0));
  
  // End: Last day of last month at 23:59:59.999 UTC
  // Month is 0-indexed, so endMonth gives us the first day of NEXT month, then subtract 1 day
  const end = new Date(Date.UTC(parsed.year, seasonInfo.endMonth, 0, 23, 59, 59, 999));
  
  return { start, end };
}

/**
 * Gets remaining days in the current season
 */
export function getSeasonDaysRemaining(): number {
  const now = new Date();
  const currentSeason = getCurrentSeason();
  const dateRange = getSeasonDateRange(currentSeason);
  
  if (!dateRange) return 0;
  
  const msRemaining = dateRange.end.getTime() - now.getTime();
  return Math.max(0, Math.ceil(msRemaining / (1000 * 60 * 60 * 24)));
}

/**
 * Gets progress through the current season (0 to 1)
 */
export function getSeasonProgress(): number {
  const now = new Date();
  const currentSeason = getCurrentSeason();
  const dateRange = getSeasonDateRange(currentSeason);
  
  if (!dateRange) return 0;
  
  const totalMs = dateRange.end.getTime() - dateRange.start.getTime();
  const elapsedMs = now.getTime() - dateRange.start.getTime();
  
  return Math.max(0, Math.min(1, elapsedMs / totalMs));
}

/**
 * Interface for season XP update data
 */
export interface SeasonXpUpdate {
  season_xp: number;
  current_season: string;
}

/**
 * Calculates the season XP update for a user when awarding XP
 * Handles rollover automatically
 * 
 * QA FIX: Added clamping to prevent negative season_xp values
 * 
 * @param currentSeasonXp User's current season_xp (can be null)
 * @param userCurrentSeason User's current_season (can be null)
 * @param xpToAdd Amount of XP being awarded (can be negative in edge cases)
 * @returns Season XP update data
 */
export function calculateSeasonXpUpdate(
  currentSeasonXp: number | null,
  userCurrentSeason: string | null,
  xpToAdd: number
): SeasonXpUpdate {
  const activeSeason = getCurrentSeason();
  
  // If user is in a different season, reset season_xp to 0 then add
  if (needsSeasonRollover(userCurrentSeason)) {
    return {
      // QA FIX: Clamp to 0 minimum to prevent negative season XP
      season_xp: Math.max(0, xpToAdd),
      current_season: activeSeason,
    };
  }
  
  // Same season, just increment (with clamping)
  return {
    // QA FIX: Clamp to 0 minimum to prevent negative season XP
    season_xp: Math.max(0, (currentSeasonXp || 0) + xpToAdd),
    current_season: activeSeason,
  };
}

/**
 * Converts legacy monthly season code to quarterly format
 * Example: "2026-01" -> "2026-Q1", "2026-07" -> "2026-Q3"
 */
export function convertLegacySeasonCode(legacySeason: string): string {
  const monthMatch = legacySeason.match(/^(\d{4})-(\d{2})$/);
  if (!monthMatch) return legacySeason; // Already in new format or invalid
  
  const year = parseInt(monthMatch[1], 10);
  const month = parseInt(monthMatch[2], 10);
  const season = getSeasonFromMonth(month);
  
  return `${year}-Q${season.quarter}`;
}

/**
 * Gets the previous season code
 */
export function getPreviousSeason(season?: string): string {
  const currentSeason = season || getCurrentSeason();
  const parsed = parseSeason(currentSeason);
  
  if (!parsed) return currentSeason;
  
  if (parsed.quarter === 1) {
    return `${parsed.year - 1}-Q4`;
  }
  return `${parsed.year}-Q${parsed.quarter - 1}`;
}

/**
 * Gets the next season code
 */
export function getNextSeason(season?: string): string {
  const currentSeason = season || getCurrentSeason();
  const parsed = parseSeason(currentSeason);
  
  if (!parsed) return currentSeason;
  
  if (parsed.quarter === 4) {
    return `${parsed.year + 1}-Q1`;
  }
  return `${parsed.year}-Q${parsed.quarter + 1}`;
}

/**
 * Gets a list of recent seasons (for leaderboard dropdown)
 * @param count Number of seasons to return (default: 4)
 */
export function getRecentSeasons(count: number = 4): string[] {
  const seasons: string[] = [];
  let currentSeason = getCurrentSeason();
  
  for (let i = 0; i < count; i++) {
    seasons.push(currentSeason);
    currentSeason = getPreviousSeason(currentSeason);
  }
  
  return seasons;
}

/**
 * Creates or gets the active season record in the database
 * Ensures there's always an active season for achievement tracking
 */
export async function getOrCreateActiveSeason(tx: TransactionClient) {
  const seasonInfo = getCurrentSeasonInfo();
  const dateRange = getSeasonDateRange(seasonInfo.code);
  
  if (!dateRange) {
    throw new Error(`Invalid season code: ${seasonInfo.code}`);
  }

  const existing = await tx.season.findUnique({
    where: { code: seasonInfo.code }
  });

  if (existing) {
    if (!existing.is_active) {
      return tx.season.update({
        where: { id: existing.id },
        data: { is_active: true }
      });
    }
    return existing;
  }

  // Deactivate all other seasons
  await tx.season.updateMany({
    where: { is_active: true },
    data: { is_active: false }
  });

  return tx.season.create({
    data: {
      code: seasonInfo.code,
      name: seasonInfo.displayName,
      starts_at: dateRange.start,
      ends_at: dateRange.end,
      is_active: true
    }
  });
}

/**
 * Gets the currently active season from the database
 */
export async function getActiveSeason(tx: TransactionClient) {
  const now = new Date();
  return tx.season.findFirst({
    where: {
      is_active: true,
      starts_at: { lte: now },
      ends_at: { gte: now }
    }
  });
}

/**
 * Creates a seasonal achievement definition
 */
export async function createSeasonalAchievement(
  tx: TransactionClient,
  data: {
    code: string;
    name: string;
    description?: string;
    xp_reward: number;
    rarity?: string;
    criteria: { type: string; threshold: number };
    season_id?: string;
  }
) {
  return tx.achievement.create({
    data: {
      code: data.code,
      name: data.name,
      description: data.description,
      xp_reward: data.xp_reward,
      rarity: data.rarity || 'rare',
      criteria: data.criteria,
      is_seasonal: true,
      season_id: data.season_id,
    }
  });
}

/**
 * Gets a user's seasonal achievements for a specific season
 */
export async function getUserSeasonalAchievements(
  tx: TransactionClient,
  userId: string,
  seasonId: string
) {
  return tx.seasonalUserAchievement.findMany({
    where: {
      user_id: userId,
      season_id: seasonId
    },
    include: {
      achievement: true,
      season: true
    },
    orderBy: {
      unlocked_at: 'desc'
    }
  });
}

/**
 * API response helper: Get season context for API responses
 */
export function getSeasonContext() {
  const info = getCurrentSeasonInfo();
  const dateRange = getSeasonDateRange(info.code);
  
  return {
    current_season: info.code,
    season_key: info.key,
    season_name: info.name,
    season_year: info.year,
    season_display: info.displayName,
    days_remaining: getSeasonDaysRemaining(),
    progress: Math.round(getSeasonProgress() * 100),
    starts_at: dateRange?.start.toISOString(),
    ends_at: dateRange?.end.toISOString(),
  };
}
