
// XP INTEGRITY FIX - January 2026
// XP_PER_CHAPTER MUST BE 1 (one) - No multipliers for bulk actions
export const XP_PER_CHAPTER = 1;
export const XP_SERIES_COMPLETED = 100;
export const XP_DAILY_STREAK_BONUS = 5;

// P1-9 FIX: Maximum XP to prevent integer overflow issues
// Using BigInt-safe max that won't overflow when multiplied by reasonable factors
export const MAX_XP = 999_999_999;
export const SAFE_XP_MULTIPLIER_MAX = 10; // Maximum multiplier to apply

/**
 * Calculates current level based on total XP
 * Formula: level = floor(sqrt(xp / 100)) + 1
 * Level 1: 0-99 XP
 * Level 2: 100-399 XP
 * Level 3: 400-899 XP
 * 
 * Includes bounds checking for safety
 */
export function calculateLevel(xp: number): number {
  // Ensure XP is non-negative and within bounds
  const safeXp = Math.max(0, Math.min(xp, MAX_XP));
  return Math.floor(Math.sqrt(safeXp / 100)) + 1;
}

/**
 * Calculates XP required for a specific level
 */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  // Cap level to prevent overflow
  const safeLevel = Math.min(level, 10000);
  return Math.pow(safeLevel - 1, 2) * 100;
}

/**
 * Calculates progress within the current level (0 to 1)
 */
export function calculateLevelProgress(xp: number): number {
  // Ensure XP is non-negative
  const safeXp = Math.max(0, xp);
  const currentLevel = calculateLevel(safeXp);
  const currentLevelXp = xpForLevel(currentLevel);
  const nextLevelXp = xpForLevel(currentLevel + 1);
  
  const xpInCurrentLevel = safeXp - currentLevelXp;
  const xpNeededForNextLevel = nextLevelXp - currentLevelXp;
  
  // Guard against division by zero
  if (xpNeededForNextLevel <= 0) return 1;
  
  return Math.min(1, xpInCurrentLevel / xpNeededForNextLevel);
}

/**
 * P1-9 FIX: Safely adds XP with overflow protection
 * Validates inputs and clamps result to MAX_XP
 */
export function addXp(currentXp: number, xpToAdd: number): number {
  // Validate inputs
  if (!Number.isFinite(currentXp) || !Number.isFinite(xpToAdd)) {
    console.warn('[XP] Invalid XP values detected:', { currentXp, xpToAdd });
    return Math.max(0, Math.min(currentXp || 0, MAX_XP));
  }
  
  // Prevent negative XP addition from going below 0
  const clampedCurrent = Math.max(0, Math.min(currentXp, MAX_XP));
  const clampedAdd = Math.max(-clampedCurrent, xpToAdd); // Allow negative but not below 0 total
  
  // Calculate new XP with overflow protection
  const newXp = clampedCurrent + clampedAdd;
  
  // Clamp to valid range
  return Math.max(0, Math.min(newXp, MAX_XP));
}

/**
 * P1-9 FIX: Safely multiplies XP with overflow protection
 * For use in bonus calculations
 */
export function multiplyXp(xp: number, multiplier: number): number {
  // Validate inputs
  if (!Number.isFinite(xp) || !Number.isFinite(multiplier)) {
    console.warn('[XP] Invalid multiplier values:', { xp, multiplier });
    return Math.max(0, Math.min(xp || 0, MAX_XP));
  }
  
  // Clamp multiplier to safe range
  const safeMultiplier = Math.max(0, Math.min(multiplier, SAFE_XP_MULTIPLIER_MAX));
  const safeXp = Math.max(0, Math.min(xp, MAX_XP));
  
  // Calculate with overflow check
  const result = safeXp * safeMultiplier;
  
  // Check for overflow (would be > MAX_SAFE_INTEGER)
  if (result > Number.MAX_SAFE_INTEGER) {
    console.warn('[XP] Overflow prevented in multiplication:', { xp, multiplier, result });
    return MAX_XP;
  }
  
  return Math.max(0, Math.min(Math.floor(result), MAX_XP));
}

/**
 * Validates XP value is within safe bounds
 */
export function isValidXp(xp: number): boolean {
  return Number.isFinite(xp) && xp >= 0 && xp <= MAX_XP;
}

/**
 * Clamps XP to valid range
 */
export function clampXp(xp: number): number {
  if (!Number.isFinite(xp)) return 0;
  return Math.max(0, Math.min(xp, MAX_XP));
}
