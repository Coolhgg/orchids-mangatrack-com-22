/**
 * TRUST SCORE SYSTEM
 * 
 * A soft credibility score per user that influences leaderboard ranking.
 * 
 * RULES (LOCKED):
 * 1. trust_score ranges from 0.5 to 1.0
 * 2. Default trust_score = 1.0 (fully trusted)
 * 3. trust_score affects leaderboard ranking ONLY (effective_xp = xp * trust_score)
 * 4. trust_score must NOT reduce earned XP
 * 5. Silent enforcement - users are not notified of trust score changes
 * 6. Recovery: Trust score decays UPWARD daily (+0.02/day) - forgiveness over time
 * 
 * VIOLATION PENALTIES:
 * - rapid_reads: -0.05 (5 reads in 30 seconds)
 * - api_spam: -0.10 (rate limit exceeded)
 * - status_toggle: -0.03 (rapid status changes)
 * - repeated_same_chapter: -0.01 (same chapter marked multiple times)
 * 
 * NOTE: large_jump is NOT a violation - bulk progress (migrations, binge reading) is trusted.
 * Users importing their series from other trackers will have large chapter jumps and should
 * NOT be penalized. XP is already limited to 1 per request regardless of jump size.
 * 
 * DECAY MODEL (FORGIVENESS):
 * - trust_score += 0.02 per day
 * - Cap at 1.0
 * - Prevents permanent punishment
 * - Runs daily via scheduler
 */

import { prisma } from '../prisma';

export const TRUST_SCORE_MIN = 0.5;
export const TRUST_SCORE_MAX = 1.0;
export const TRUST_SCORE_DEFAULT = 1.0;
export const TRUST_SCORE_MIN_FOR_LEADERBOARD = 0.6;

// Violation penalties (negative values)
export const VIOLATION_PENALTIES: Record<string, number> = {
  rapid_reads: 0.05,      // 5+ reads in 30 seconds
  api_spam: 0.10,         // Rate limit exceeded
  status_toggle: 0.03,    // Rapid status changes (completed->reading->completed)
  repeated_same_chapter: 0.01, // Same chapter marked multiple times
  // Anti-bot heuristics
  speed_read: 0.02,       // Single read < 30s (suspicious but not severe)
  bulk_speed_read: 0.04,  // 3+ suspicious reads in 5 min window
  pattern_repetition: 0.08, // Suspiciously regular intervals (bot-like behavior)
  // NOTE: large_jump / massive_chapter_jump removed - bulk progress is trusted
  // (migrations, binge reading, imports from other trackers)
};

// Daily decay rate (upward recovery toward 1.0)
// Formula: trust_score += DECAY_PER_DAY, cap at 1.0
export const DECAY_PER_DAY = 0.02;

// Minimum time between violations of the same type (in ms)
export const VIOLATION_COOLDOWN_MS = 60000; // 1 minute

export type ViolationType = keyof typeof VIOLATION_PENALTIES;

/**
 * Calculates effective XP for leaderboard ranking
 * RULE: effective_xp = xp * trust_score
 */
export function calculateEffectiveXp(xp: number, trustScore: number): number {
  const clampedTrust = Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, trustScore));
  return Math.floor(xp * clampedTrust);
}

/**
 * Calculates effective season XP for seasonal leaderboard
 */
export function calculateEffectiveSeasonXp(seasonXp: number, trustScore: number): number {
  const clampedTrust = Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, trustScore));
  return Math.floor(seasonXp * clampedTrust);
}

/**
 * Applies a penalty to trust score
 * Returns the new trust score (clamped to [0.5, 1.0])
 */
export function applyPenalty(currentScore: number, penalty: number): number {
  const newScore = currentScore - penalty;
  return Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, newScore));
}

/**
 * Applies daily decay (upward recovery) to trust score
 * Formula: trust_score += 0.02, cap at 1.0
 * 
 * @param currentScore Current trust score
 * @param days Number of days to apply decay for (default 1)
 * @returns New trust score clamped to [0.5, 1.0]
 */
export function applyDecay(currentScore: number, days: number = 1): number {
  const recovery = days * DECAY_PER_DAY;
  const newScore = currentScore + recovery;
  return Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, newScore));
}

/**
 * Calculates how many days until full trust recovery
 * @param currentScore Current trust score
 * @returns Days until trust_score = 1.0
 */
export function daysUntilFullRecovery(currentScore: number): number {
  if (currentScore >= TRUST_SCORE_MAX) return 0;
  const deficit = TRUST_SCORE_MAX - currentScore;
  return Math.ceil(deficit / DECAY_PER_DAY);
}

/**
 * Records a trust violation and updates user's trust score
 * Silently reduces trust score without notifying the user
 */
export async function recordViolation(
  userId: string,
  violationType: ViolationType,
  metadata?: Record<string, any>
): Promise<{ previousScore: number; newScore: number }> {
  const penalty = VIOLATION_PENALTIES[violationType] || 0.01;
  
  // Get current user trust score
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { trust_score: true, trust_score_updated_at: true }
  });
  
  const previousScore = user?.trust_score ?? TRUST_SCORE_DEFAULT;
  const newScore = applyPenalty(previousScore, penalty);
  
  // Update user trust score and log violation in a transaction
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: {
        trust_score: newScore,
        trust_score_updated_at: new Date(),
      }
    }),
    prisma.trustViolation.create({
      data: {
        user_id: userId,
        violation_type: violationType,
        severity: penalty,
        previous_score: previousScore,
        new_score: newScore,
        metadata: metadata || {},
      }
    })
  ]);
  
  return { previousScore, newScore };
}

/**
 * Processes daily trust score decay (upward recovery) for ALL users below 1.0
 * 
 * FORMULA: trust_score += 0.02/day, cap at 1.0
 * 
 * This is UNCONDITIONAL forgiveness - no "clean activity" requirement.
 * Even users who violated today still get decay applied.
 * This prevents permanent punishment.
 * 
 * QA FIX: Uses batch updateMany instead of parallel individual updates to prevent
 * race conditions where a concurrent violation could be overwritten.
 * 
 * Should be called once daily by the scheduler.
 * 
 * @returns Number of users whose trust score was recovered
 */
export async function processDailyDecay(): Promise<{ 
  recoveredCount: number; 
  fullyRecoveredCount: number;
}> {
  // QA FIX: Use a single atomic batch update instead of parallel individual updates
  // This prevents race conditions where a concurrent violation could be overwritten
  
  // Step 1: Update all users who are below max but won't reach max after decay
  const belowMaxResult = await prisma.user.updateMany({
    where: {
      trust_score: { lt: TRUST_SCORE_MAX - DECAY_PER_DAY },
      deleted_at: null,
    },
    data: {
      trust_score: { increment: DECAY_PER_DAY },
      trust_score_updated_at: new Date(),
    },
  });
  
  // Step 2: Update all users who will reach or exceed max to exactly 1.0
  const atMaxResult = await prisma.user.updateMany({
    where: {
      trust_score: { 
        gte: TRUST_SCORE_MAX - DECAY_PER_DAY,
        lt: TRUST_SCORE_MAX,
      },
      deleted_at: null,
    },
    data: {
      trust_score: TRUST_SCORE_MAX,
      trust_score_updated_at: new Date(),
    },
  });
  
  return { 
    recoveredCount: belowMaxResult.count + atMaxResult.count, 
    fullyRecoveredCount: atMaxResult.count 
  };
}

/**
 * Gets a user's trust score status
 */
export async function getTrustStatus(userId: string): Promise<{
  trustScore: number;
  effectiveMultiplier: number;
  recentViolations: number;
  isFullyTrusted: boolean;
  daysUntilRecovery: number;
}> {
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  
  const [user, recentViolationCount] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { trust_score: true }
    }),
    prisma.trustViolation.count({
      where: {
        user_id: userId,
        created_at: { gte: oneDayAgo }
      }
    })
  ]);
  
  const trustScore = user?.trust_score ?? TRUST_SCORE_DEFAULT;
  
  return {
    trustScore,
    effectiveMultiplier: Math.max(TRUST_SCORE_MIN, Math.min(TRUST_SCORE_MAX, trustScore)),
    recentViolations: recentViolationCount,
    isFullyTrusted: trustScore >= TRUST_SCORE_MAX,
    daysUntilRecovery: daysUntilFullRecovery(trustScore),
  };
}

/**
 * Checks if a specific violation type is on cooldown for a user
 * Prevents excessive penalty stacking
 */
export async function isViolationOnCooldown(
  userId: string,
  violationType: ViolationType
): Promise<boolean> {
  const cooldownStart = new Date(Date.now() - VIOLATION_COOLDOWN_MS);
  
  const recentViolation = await prisma.trustViolation.findFirst({
    where: {
      user_id: userId,
      violation_type: violationType,
      created_at: { gte: cooldownStart }
    }
  });
  
  return !!recentViolation;
}

/**
 * Safe wrapper to record violation with cooldown check
 */
export async function maybeRecordViolation(
  userId: string,
  violationType: ViolationType,
  metadata?: Record<string, any>
): Promise<{ recorded: boolean; previousScore?: number; newScore?: number }> {
  const onCooldown = await isViolationOnCooldown(userId, violationType);
  
  if (onCooldown) {
    return { recorded: false };
  }
  
  const result = await recordViolation(userId, violationType, metadata);
  return { recorded: true, ...result };
}

// Legacy alias for backward compatibility
export const processDailyRecovery = processDailyDecay;
