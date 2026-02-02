/**
 * READ-TIME VALIDATION (SOFT)
 * 
 * A non-blocking sanity check to ensure chapters aren't marked read unrealistically fast.
 * 
 * RULES (LOCKED):
 * 1. NEVER block marking as read - this is a SOFT validation only
 * 2. If read_time < minimum threshold: flag as suspicious, affect trust_score only
 * 3. NO XP removal - XP is always preserved
 * 4. Used for trust_score signals only
 * 
 * THRESHOLDS:
 * - Base minimum read time: 30 seconds for any chapter
 * - Per-page minimum: 3 seconds per page (if page count known)
 * - Formula: min_time = max(30, page_count * 3) seconds
 * 
 * PENALTIES:
 * - speed_read: -0.02 trust_score (reading impossibly fast)
 * - bulk_speed_read: -0.04 trust_score (multiple fast reads in sequence)
 */

import { redis, REDIS_KEY_PREFIX, waitForRedis } from '../redis';
import { maybeRecordViolation, VIOLATION_PENALTIES } from './trust-score';

// Threshold constants
export const MIN_READ_TIME_SECONDS = 30;        // Absolute minimum for any chapter
export const SECONDS_PER_PAGE = 3;              // Minimum 3 seconds per page
export const DEFAULT_PAGE_COUNT = 18;           // Assume ~18 pages if unknown
export const BULK_SPEED_READ_COUNT = 3;         // 3+ fast reads = bulk violation
export const BULK_SPEED_READ_WINDOW_MS = 300000; // 5 minute window

// Pattern repetition detection constants
export const PATTERN_INTERVAL_COUNT = 5;        // Need 5+ intervals to detect pattern
export const PATTERN_STD_DEV_THRESHOLD = 2.0;   // Standard deviation < 2s = bot-like
export const PATTERN_MIN_INTERVAL_MS = 5000;    // Ignore intervals < 5s (too fast to analyze)

export interface ReadTimeValidationResult {
  isSuspicious: boolean;
  reason?: string;
  expectedMinSeconds: number;
  actualSeconds: number;
  trustScoreAffected: boolean;
}

/**
 * Calculates the minimum believable read time for a chapter
 * 
 * @param pageCount - Number of pages in the chapter (optional)
 * @returns Minimum expected read time in seconds
 */
export function calculateMinimumReadTime(pageCount?: number | null): number {
  const pages = pageCount || DEFAULT_PAGE_COUNT;
  const pageBasedTime = pages * SECONDS_PER_PAGE;
  return Math.max(MIN_READ_TIME_SECONDS, pageBasedTime);
}

/**
 * Validates read time and flags suspicious activity (SOFT - never blocks)
 * 
 * RULES:
 * - Does NOT block the read operation
 * - Only affects trust_score if suspicious
 * - Returns validation result for logging
 * 
 * @param userId - User ID
 * @param chapterId - Chapter ID (for logging)
 * @param readTimeSeconds - Actual time spent reading (in seconds)
 * @param pageCount - Number of pages (optional)
 */
export async function validateReadTime(
  userId: string,
  chapterId: string,
  readTimeSeconds: number,
  pageCount?: number | null
): Promise<ReadTimeValidationResult> {
  const expectedMinSeconds = calculateMinimumReadTime(pageCount);
  
  // Not suspicious if read time meets minimum
  if (readTimeSeconds >= expectedMinSeconds) {
    return {
      isSuspicious: false,
      expectedMinSeconds,
      actualSeconds: readTimeSeconds,
      trustScoreAffected: false,
    };
  }
  
  // SUSPICIOUS: Read too fast
  // Check for bulk speed reading pattern
  const isBulkSpeedRead = await checkBulkSpeedReadPattern(userId);
  
  const violationType = isBulkSpeedRead ? 'bulk_speed_read' : 'speed_read';
  
  // Record violation (affects trust_score only, NOT XP)
  const result = await maybeRecordViolation(userId, violationType, {
    chapter_id: chapterId,
    expected_min_seconds: expectedMinSeconds,
    actual_seconds: readTimeSeconds,
    page_count: pageCount || DEFAULT_PAGE_COUNT,
    deficit_seconds: expectedMinSeconds - readTimeSeconds,
  });
  
  // Track this speed read for bulk detection
  await trackSpeedRead(userId);
  
  return {
    isSuspicious: true,
    reason: isBulkSpeedRead ? 'bulk_speed_read' : 'speed_read',
    expectedMinSeconds,
    actualSeconds: readTimeSeconds,
    trustScoreAffected: result.recorded,
  };
}

/**
 * Validates read time based on last read timestamp (when explicit read_time not provided)
 * Uses Redis to track last read time per user
 */
export async function validateReadTimeFromTimestamp(
  userId: string,
  chapterId: string,
  pageCount?: number | null
): Promise<ReadTimeValidationResult> {
  const key = `${REDIS_KEY_PREFIX}read-time:last:${userId}`;
  const now = Date.now();
  
  const redisReady = await waitForRedis(redis, 200);
  let lastReadTime: number | null = null;
  
  if (redisReady) {
    try {
      const lastReadStr = await redis.get(key);
      if (lastReadStr) {
        lastReadTime = parseInt(lastReadStr, 10);
      }
      // Update last read time
      await redis.set(key, String(now), 'EX', 3600); // 1 hour TTL
    } catch {
      // Continue without Redis - skip validation
    }
  }
  
  // If no previous read recorded, can't validate
  if (!lastReadTime) {
    const expectedMinSeconds = calculateMinimumReadTime(pageCount);
    return {
      isSuspicious: false,
      expectedMinSeconds,
      actualSeconds: expectedMinSeconds, // Assume valid
      trustScoreAffected: false,
    };
  }
  
  const elapsedSeconds = Math.floor((now - lastReadTime) / 1000);
  return validateReadTime(userId, chapterId, elapsedSeconds, pageCount);
}

/**
 * Tracks a speed read event for bulk detection
 */
async function trackSpeedRead(userId: string): Promise<void> {
  const key = `${REDIS_KEY_PREFIX}read-time:speed-reads:${userId}`;
  const redisReady = await waitForRedis(redis, 200);
  
  if (!redisReady) return;
  
  try {
    const multi = redis.multi();
    multi.incr(key);
    multi.expire(key, Math.ceil(BULK_SPEED_READ_WINDOW_MS / 1000));
    await multi.exec();
  } catch {
    // Ignore Redis errors
  }
}

/**
 * Checks if user has a bulk speed reading pattern
 * Returns true if 3+ speed reads in the last 5 minutes
 */
async function checkBulkSpeedReadPattern(userId: string): Promise<boolean> {
  const key = `${REDIS_KEY_PREFIX}read-time:speed-reads:${userId}`;
  const redisReady = await waitForRedis(redis, 200);
  
  if (!redisReady) return false;
  
  try {
    const count = await redis.get(key);
    return count !== null && parseInt(count, 10) >= BULK_SPEED_READ_COUNT;
  } catch {
    return false;
  }
}

/**
 * Gets estimated read time for a chapter (for client hints)
 */
export function getEstimatedReadTime(pageCount?: number | null): {
  minimumSeconds: number;
  averageSeconds: number;
  displayText: string;
} {
  const pages = pageCount || DEFAULT_PAGE_COUNT;
  const minimumSeconds = calculateMinimumReadTime(pages);
  const averageSeconds = pages * 8; // Average 8 seconds per page
  
  const minutes = Math.ceil(averageSeconds / 60);
  const displayText = minutes === 1 ? '~1 min' : `~${minutes} mins`;
  
  return {
    minimumSeconds,
    averageSeconds,
    displayText,
  };
}

/**
 * Tracks the interval between reads for pattern detection
 * Returns the interval in milliseconds, or null if first read
 */
export async function trackReadInterval(userId: string): Promise<number | null> {
  const timestampKey = `${REDIS_KEY_PREFIX}read-time:last-timestamp:${userId}`;
  const intervalsKey = `${REDIS_KEY_PREFIX}read-time:intervals:${userId}`;
  const now = Date.now();
  
  const redisReady = await waitForRedis(redis, 200);
  if (!redisReady) return null;
  
  try {
    const lastTimestamp = await redis.get(timestampKey);
    await redis.set(timestampKey, String(now), 'EX', 600); // 10 min TTL
    
    if (!lastTimestamp) return null;
    
    const interval = now - parseInt(lastTimestamp, 10);
    
    if (interval >= PATTERN_MIN_INTERVAL_MS) {
      await redis.lpush(intervalsKey, String(interval));
      await redis.ltrim(intervalsKey, 0, PATTERN_INTERVAL_COUNT - 1);
      await redis.expire(intervalsKey, 600);
    }
    
    return interval;
  } catch {
    return null;
  }
}

/**
 * Detects suspiciously regular intervals (bot-like behavior)
 * Returns true if the standard deviation of recent intervals is < 2 seconds
 */
export async function detectPatternRepetition(userId: string): Promise<boolean> {
  const intervalsKey = `${REDIS_KEY_PREFIX}read-time:intervals:${userId}`;
  
  const redisReady = await waitForRedis(redis, 200);
  if (!redisReady) return false;
  
  try {
    const intervals = await redis.lrange(intervalsKey, 0, -1);
    
    if (intervals.length < PATTERN_INTERVAL_COUNT) return false;
    
    const numericIntervals = intervals.map(s => parseInt(s, 10) / 1000);
    const avg = numericIntervals.reduce((a, b) => a + b, 0) / numericIntervals.length;
    const variance = numericIntervals.reduce((s, v) => s + Math.pow(v - avg, 2), 0) / numericIntervals.length;
    const stdDev = Math.sqrt(variance);
    
    return stdDev < PATTERN_STD_DEV_THRESHOLD;
  } catch {
    return false;
  }
}

/**
 * Checks for pattern repetition and records violation if detected
 * Call this after each read operation
 */
export async function checkAndRecordPatternRepetition(
  userId: string,
  chapterId: string
): Promise<{ detected: boolean; trustScoreAffected: boolean }> {
  await trackReadInterval(userId);
  
  const isPatternDetected = await detectPatternRepetition(userId);
  
  if (!isPatternDetected) {
    return { detected: false, trustScoreAffected: false };
  }
  
  const result = await maybeRecordViolation(userId, 'pattern_repetition', {
    chapter_id: chapterId,
    detection_method: 'interval_std_dev',
    threshold: PATTERN_STD_DEV_THRESHOLD,
  });
  
  return { detected: true, trustScoreAffected: result.recorded };
}
