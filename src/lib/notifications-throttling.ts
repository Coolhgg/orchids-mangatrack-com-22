import { redis, REDIS_KEY_PREFIX, isRedisConnected } from './redis';

const DEDUPE_TTL = 7 * 24 * 60 * 60; // 7 days (increased to prevent duplicate sources)
const USER_DAILY_LIMIT = 50; // Increased for safety-first
const USER_HOURLY_LIMIT = 100;
const USER_DAILY_TTL = 24 * 60 * 60; // 24 hours
const USER_HOURLY_TTL = 60 * 60; // 1 hour
const MANGA_HOURLY_TTL = 60 * 60; // 1 hour

// In-memory fallback when Redis is unavailable
const memoryDedupeCache = new Map<string, number>();
const memoryThrottleCache = new Map<string, { count: number; expiresAt: number }>();
const MEMORY_CACHE_MAX_SIZE = 10000;

function cleanupMemoryCache(): void {
  const now = Date.now();
  
  // Cleanup expired dedupe entries
  for (const [key, expiresAt] of memoryDedupeCache.entries()) {
    if (expiresAt < now) {
      memoryDedupeCache.delete(key);
    }
  }
  
  // Cleanup expired throttle entries
  for (const [key, data] of memoryThrottleCache.entries()) {
    if (data.expiresAt < now) {
      memoryThrottleCache.delete(key);
    }
  }
  
  // LRU-style eviction if still too large
  if (memoryDedupeCache.size > MEMORY_CACHE_MAX_SIZE) {
    const entries = Array.from(memoryDedupeCache.entries());
    entries.sort((a, b) => a[1] - b[1]);
    const toDelete = entries.slice(0, Math.floor(MEMORY_CACHE_MAX_SIZE / 2));
    for (const [key] of toDelete) {
      memoryDedupeCache.delete(key);
    }
  }
  
  if (memoryThrottleCache.size > MEMORY_CACHE_MAX_SIZE) {
    const entries = Array.from(memoryThrottleCache.entries());
    entries.sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    const toDelete = entries.slice(0, Math.floor(MEMORY_CACHE_MAX_SIZE / 2));
    for (const [key] of toDelete) {
      memoryThrottleCache.delete(key);
    }
  }
}

/**
 * Checks if a notification for a specific chapter of a series has already been processed.
 * Prevents multiple sources from triggering separate notifications for the same chapter.
 */
export async function shouldNotifyChapter(seriesId: string, chapterNumber: number): Promise<boolean> {
  const key = `${REDIS_KEY_PREFIX}notify:dedupe:${seriesId}:${chapterNumber}`;
  
  // Check if Redis is available
  if (!isRedisConnected()) {
    // Fallback to in-memory cache
    cleanupMemoryCache();
    const now = Date.now();
    const existingExpiry = memoryDedupeCache.get(key);
    
    if (existingExpiry && existingExpiry > now) {
      return false; // Already notified
    }
    
    memoryDedupeCache.set(key, now + (DEDUPE_TTL * 1000));
    return true;
  }
  
  try {
    const result = await redis.set(key, '1', 'EX', DEDUPE_TTL, 'NX');
    return result === 'OK';
  } catch {
    // Redis error - fallback to allowing the notification
    // Better to potentially duplicate than to block all notifications
    return true;
  }
}

/**
 * Checks if a user has exceeded their notification limits.
 * Implements:
 * 1. Max notifications per manga per user per hour (1)
 * 2. Max notifications per user per hour (100)
 * 3. Max notifications per user per day (50)
 */
export async function shouldThrottleUser(userId: string, seriesId: string, isPremium = false): Promise<{ throttle: boolean; reason?: string }> {
  const dailyKey = `throttle:user:${userId}:daily`;
  const hourlyKey = `throttle:user:${userId}:hourly`;
  const mangaKey = `throttle:user:${userId}:manga:${seriesId}`;

  // Check if Redis is available
  if (!isRedisConnected()) {
    return shouldThrottleUserMemory(userId, seriesId, isPremium);
  }

  try {
    // 1. Check Manga Hourly Limit (Only 1 notification per series per hour)
    const mangaLimit = await redis.set(mangaKey, '1', 'EX', MANGA_HOURLY_TTL, 'NX');
    if (mangaLimit !== 'OK') {
      return { throttle: true, reason: 'manga_hourly_limit' };
    }

    // 2. Check Hourly Limit (Abuse Prevention)
    const hourlyCount = await redis.incr(hourlyKey);
    if (hourlyCount === 1) {
      await redis.expire(hourlyKey, USER_HOURLY_TTL);
    }

    if (hourlyCount > USER_HOURLY_LIMIT) {
      return { throttle: true, reason: 'user_hourly_limit' };
    }

    // 3. Check Daily Limit
    const dailyCount = await redis.incr(dailyKey);
    if (dailyCount === 1) {
      await redis.expire(dailyKey, USER_DAILY_TTL);
    }

    // Premium users have higher daily limits
    const effectiveDailyLimit = isPremium ? 500 : USER_DAILY_LIMIT;

    if (dailyCount > effectiveDailyLimit) {
      return { throttle: true, reason: 'user_daily_limit' };
    }

    return { throttle: false };
  } catch {
    // Redis error - fallback to in-memory
    return shouldThrottleUserMemory(userId, seriesId, isPremium);
  }
}

function shouldThrottleUserMemory(userId: string, seriesId: string, isPremium: boolean): { throttle: boolean; reason?: string } {
  cleanupMemoryCache();
  const now = Date.now();
  
  const dailyKey = `throttle:user:${userId}:daily`;
  const hourlyKey = `throttle:user:${userId}:hourly`;
  const mangaKey = `throttle:user:${userId}:manga:${seriesId}`;
  
  // 1. Check Manga Hourly Limit
  const mangaData = memoryThrottleCache.get(mangaKey);
  if (mangaData && mangaData.expiresAt > now) {
    return { throttle: true, reason: 'manga_hourly_limit' };
  }
  memoryThrottleCache.set(mangaKey, { count: 1, expiresAt: now + (MANGA_HOURLY_TTL * 1000) });
  
  // 2. Check Hourly Limit
  const hourlyData = memoryThrottleCache.get(hourlyKey);
  let hourlyCount = 1;
  if (hourlyData && hourlyData.expiresAt > now) {
    hourlyCount = hourlyData.count + 1;
    memoryThrottleCache.set(hourlyKey, { count: hourlyCount, expiresAt: hourlyData.expiresAt });
  } else {
    memoryThrottleCache.set(hourlyKey, { count: 1, expiresAt: now + (USER_HOURLY_TTL * 1000) });
  }
  
  if (hourlyCount > USER_HOURLY_LIMIT) {
    return { throttle: true, reason: 'user_hourly_limit' };
  }
  
  // 3. Check Daily Limit
  const dailyData = memoryThrottleCache.get(dailyKey);
  let dailyCount = 1;
  if (dailyData && dailyData.expiresAt > now) {
    dailyCount = dailyData.count + 1;
    memoryThrottleCache.set(dailyKey, { count: dailyCount, expiresAt: dailyData.expiresAt });
  } else {
    memoryThrottleCache.set(dailyKey, { count: 1, expiresAt: now + (USER_DAILY_TTL * 1000) });
  }
  
  const effectiveDailyLimit = isPremium ? 500 : USER_DAILY_LIMIT;
  if (dailyCount > effectiveDailyLimit) {
    return { throttle: true, reason: 'user_daily_limit' };
  }
  
  return { throttle: false };
}
