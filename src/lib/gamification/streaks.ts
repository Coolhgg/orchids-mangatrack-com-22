
import { isSameDay, subDays } from 'date-fns';

// Maximum streak to prevent integer overflow
const MAX_STREAK = 365 * 100; // 100 years

/**
 * Creates a UTC date from a given date (zeroing out the time component to compare just days)
 */
function toUTCDate(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/**
 * Calculates the new streak count based on current streak and last activity date
 * Includes bounds checking for safety
 * 
 * QA FIX: Use UTC consistently for streak calculations to prevent timezone-related
 * edge cases where reading at 11:59 PM in one timezone could be misinterpreted.
 */
export function calculateNewStreak(currentStreak: number, lastReadAt: Date | null): number {
  // QA FIX: Use UTC dates to avoid timezone issues
  const nowUtc = toUTCDate(new Date());
  
  // Ensure currentStreak is valid
  const safeStreak = Math.max(0, Math.min(currentStreak || 0, MAX_STREAK));
  
  if (!lastReadAt) {
    return 1;
  }

  // Validate lastReadAt is a valid date
  const lastReadDate = new Date(lastReadAt);
  if (isNaN(lastReadDate.getTime())) {
    return 1;
  }
  
  // QA FIX: Convert lastReadAt to UTC for consistent comparison
  const lastReadUtc = toUTCDate(lastReadDate);

  // If already read today (in UTC), streak remains the same
  if (isSameDay(lastReadUtc, nowUtc)) {
    return Math.max(1, safeStreak);
  }

  // If read yesterday (in UTC), increment streak
  const yesterdayUtc = subDays(nowUtc, 1);
  if (isSameDay(lastReadUtc, yesterdayUtc)) {
    return Math.min(safeStreak + 1, MAX_STREAK);
  }

  // Otherwise, streak reset to 1
  return 1;
}

/**
 * Calculates XP bonus based on current streak
 * e.g., +5 XP per day of streak, capped at 50
 */
export function calculateStreakBonus(streak: number): number {
  // Ensure streak is non-negative
  const safeStreak = Math.max(0, streak);
  return Math.min(safeStreak * 5, 50);
}
