import { redis, REDIS_KEY_PREFIX, waitForRedis } from './redis';

const PREMIUM_CONCURRENCY_PREFIX = `${REDIS_KEY_PREFIX}premium:concurrency:`;

/**
 * Increment concurrency count for premium users.
 * Capped at 3 active jobs by default to prevent one user from saturating workers.
 */
export async function incrementPremiumConcurrency(userId: string, limit: number = 3, ttlSeconds: number = 300): Promise<boolean> {
  const ready = await waitForRedis(redis, 500);
  if (!ready) return true;

  const key = `${PREMIUM_CONCURRENCY_PREFIX}${userId}`;
  
  try {
    const current = await redis.get(key);
    if (current && parseInt(current, 10) >= limit) {
      return false;
    }
    
    const newVal = await redis.incr(key);
    if (newVal === 1) {
      await redis.expire(key, ttlSeconds);
    }
    
    return newVal <= limit;
  } catch (err) {
    console.error('[SearchCache] incrementPremiumConcurrency error:', err);
    return true;
  }
}

/**
 * Decrement concurrency count for premium users.
 */
export async function decrementPremiumConcurrency(userId: string): Promise<number> {
  const key = `${PREMIUM_CONCURRENCY_PREFIX}${userId}`;
  try {
    const val = await redis.decr(key);
    if (val <= 0) await redis.del(key);
    return val;
  } catch (err) {
    console.error('[SearchCache] decrementPremiumConcurrency error:', err);
    return 0;
  }
}

const SEARCH_CACHE_PREFIX = `${REDIS_KEY_PREFIX}search:cache:`;
const SEARCH_PENDING_PREFIX = `${REDIS_KEY_PREFIX}search:pending:`;
const SEARCH_STATS_PREFIX = `${REDIS_KEY_PREFIX}search:stats:`;
const SEARCH_HEAT_PREFIX = `${REDIS_KEY_PREFIX}search:heat:`;
const SEARCH_DEFERRED_PREFIX = `${REDIS_KEY_PREFIX}search:deferred:`;
const SEARCH_DEFERRED_ZSET = `${REDIS_KEY_PREFIX}search:deferred_zset`;
const PREMIUM_QUOTA_PREFIX = `${REDIS_KEY_PREFIX}premium:quota:`;
const USER_QUOTA_PREFIX = `${REDIS_KEY_PREFIX}user:quota:`;
const GUEST_QUOTA_PREFIX = `${REDIS_KEY_PREFIX}guest:quota:`;
const PREMIUM_SLIDING_PREFIX = `${REDIS_KEY_PREFIX}premium:sliding:`;

/**
 * Atomic Quota Consumption via Lua Script
 * - Checks if current count >= limit
 * - If not, increments and sets TTL if it's the first hit
 * - Returns the new count, or -1 if limit reached
 */
const CONSUME_QUOTA_LUA = `
local current = redis.call("GET", KEYS[1])
if current and tonumber(current) >= tonumber(ARGV[1]) then
    return -1
end
local next = redis.call("INCR", KEYS[1])
if next == 1 then
    redis.call("EXPIRE", KEYS[1], ARGV[2])
end
return next
`;

/**
 * Sliding Window Rate Limit via Lua Script
 * - Uses a sorted set to track timestamps
 * - Returns -1 if limit reached
 */
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clear_before = now - window

redis.call("ZREMRANGEBYSCORE", key, 0, clear_before)
local count = redis.call("ZCARD", key)

if count >= limit then
    return -1
end

redis.call("ZADD", key, now, now)
redis.call("EXPIRE", key, window / 1000)
return count + 1
`;

export async function consumeSearchQuota(
  identifier: string, 
  type: 'premium' | 'user' | 'guest',
  limit: number,
  windowSeconds: number = 86400
): Promise<number> {
  const ready = await waitForRedis(redis, 500);
  if (!ready) return 1; // Fail-open to avoid breaking search if Redis is down

  const prefix = type === 'premium' ? PREMIUM_QUOTA_PREFIX : 
                 type === 'user' ? USER_QUOTA_PREFIX : 
                 GUEST_QUOTA_PREFIX;
  const key = `${prefix}${identifier}`;

  try {
    const result = await redis.eval(
      CONSUME_QUOTA_LUA,
      1,
      key,
      limit.toString(),
      windowSeconds.toString()
    );
    return typeof result === 'number' ? result : parseInt(result as string, 10);
  } catch (err) {
    console.error(`[Quota] consumeQuota error for ${type}:${identifier}:`, err);
    return 1;
  }
}

/**
 * Premium Sliding Window (Short-term bursts)
 * Capped at 5 searches per minute
 */
export async function checkPremiumSlidingWindow(userId: string): Promise<boolean> {
  const ready = await waitForRedis(redis, 500);
  if (!ready) return true;

  const key = `${PREMIUM_SLIDING_PREFIX}${userId}`;
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const limit = 5;

  try {
    const result = await redis.eval(
      SLIDING_WINDOW_LUA,
      1,
      key,
      now.toString(),
      windowMs.toString(),
      limit.toString()
    );
    return result !== -1;
  } catch (err) {
    console.error(`[Quota] checkPremiumSlidingWindow error:`, err);
    return true;
  }
}

export const SEARCH_PRIORITY = {
  CRITICAL: 1,  // Premium Direct Search
  HIGH: 5,      // Premium Deferred/Updates
  STANDARD: 10, // Free Direct Search
  LOW: 20,      // Free Deferred/Background
};

/**
 * Weights used to calculate Redis ZSET score (priority).
 * Score = Weight + Timestamp
 * Lower score = Higher priority.
 * 
 * New Policy: 
 * - Premium gets immediate eligibility (0 weight).
 * - Logged-in users get a 2-minute head start.
 * - Free users get a 10-minute head start for premium.
 * This ensures "guaranteed eventual processing" for all users without multi-hour starvation.
 */
const PREMIUM_WEIGHT = 0;
const LOGGED_IN_WEIGHT = 2 * 60 * 1000;  // 2 minute penalty
const FREE_WEIGHT = 10 * 60 * 1000;     // 10 minute penalty

export interface CachedSearchResult {
  results: any[];
  total?: number;
  has_more: boolean;
  next_cursor: string | null;
  cached_at: number;
  source: 'cache';
}

export interface SearchCacheConfig {
  ttlSeconds: number;
  maxPendingWaitMs: number;
  enableDeduplication: boolean;
}

const DEFAULT_CONFIG: SearchCacheConfig = {
  ttlSeconds: 3600,
  maxPendingWaitMs: 5000,
  enableDeduplication: true,
};

export function normalizeQuery(query: string): string {
  if (!query || typeof query !== 'string') return '';
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Build a deterministic cache key using a collision-resistant hash.
 * Uses djb2 hash algorithm with separate high/low 32-bit values to avoid overflow issues.
 */
function buildCacheKey(query: string, filters: Record<string, any>): string {
  const normalizedQuery = normalizeQuery(query);
  
  // Sort keys alphabetically for consistent hashing
  const filterHash = Object.entries(filters)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'cursor')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join('|');
  
  const keyBase = `${normalizedQuery}::${filterHash}`;
  
  // Use FNV-1a hash for better distribution and collision resistance
  // This produces two 32-bit hashes that we combine
  let h1 = 0x811c9dc5; // FNV offset basis
  let h2 = 0x1000193;  // FNV prime seed
  
  for (let i = 0; i < keyBase.length; i++) {
    const char = keyBase.charCodeAt(i);
    // FNV-1a for h1
    h1 ^= char;
    h1 = Math.imul(h1, 0x01000193);
    // Simple hash for h2 with different multiplier
    h2 = Math.imul(h2 ^ char, 0x5bd1e995);
  }
  
  // Convert to unsigned 32-bit and combine
  h1 = h1 >>> 0;
  h2 = h2 >>> 0;
  
  // Combine normalized query prefix (for debugging) with both hash parts
  const queryPrefix = normalizedQuery.slice(0, 16).replace(/[^a-z0-9]/g, '_');
  return `${queryPrefix}_${h1.toString(36)}_${h2.toString(36)}`;
}

export async function getCachedSearchResult(
  query: string,
  filters: Record<string, any>
): Promise<CachedSearchResult | null> {
  if (!query || typeof query !== 'string') return null;
  
  const ready = await waitForRedis(redis, 1000);
  if (!ready) return null;

  try {
    const cacheKey = `${SEARCH_CACHE_PREFIX}${buildCacheKey(query, filters)}`;
    const cached = await redis.get(cacheKey);
    
    if (cached) {
      await redis.hincrby(`${SEARCH_STATS_PREFIX}global`, 'hits', 1).catch((err) => {
        console.debug('[SearchCache] Stats increment failed:', err instanceof Error ? err.message : err);
      });
      try {
        const parsed = JSON.parse(cached);
        // Validate cached result structure
        if (parsed && Array.isArray(parsed.results)) {
          return parsed;
        }
        // Invalid cache entry - delete it
        await redis.del(cacheKey).catch((err) => {
          console.warn('[SearchCache] Failed to delete invalid cache entry:', err instanceof Error ? err.message : err);
        });
        return null;
      } catch (parseErr) {
        console.error('[SearchCache] JSON parse error, invalidating cache:', parseErr);
        await redis.del(cacheKey).catch((err) => {
          console.warn('[SearchCache] Failed to delete corrupt cache entry:', err instanceof Error ? err.message : err);
        });
        return null;
      }
    }
    
    await redis.hincrby(`${SEARCH_STATS_PREFIX}global`, 'misses', 1).catch((err) => {
      console.debug('[SearchCache] Stats increment failed:', err instanceof Error ? err.message : err);
    });
    return null;
  } catch (err) {
    console.error('[SearchCache] getCached error:', err);
    return null;
  }
}

export async function setCachedSearchResult(
  query: string,
  filters: Record<string, any>,
  result: Omit<CachedSearchResult, 'cached_at' | 'source'>,
  config: Partial<SearchCacheConfig> = {}
): Promise<void> {
  if (!query || typeof query !== 'string') return;
  if (!result || !Array.isArray(result.results)) return;
  
  const ready = await waitForRedis(redis, 1000);
  if (!ready) return;

  const { ttlSeconds } = { ...DEFAULT_CONFIG, ...config };

  try {
    const cacheKey = `${SEARCH_CACHE_PREFIX}${buildCacheKey(query, filters)}`;
    const cacheData: CachedSearchResult = {
      ...result,
      cached_at: Date.now(),
      source: 'cache',
    };
    
    // Limit cached results size to prevent memory issues
    const MAX_CACHED_RESULTS = 100;
    if (cacheData.results.length > MAX_CACHED_RESULTS) {
      cacheData.results = cacheData.results.slice(0, MAX_CACHED_RESULTS);
      cacheData.has_more = true;
    }
    
    await redis.setex(cacheKey, ttlSeconds, JSON.stringify(cacheData));
  } catch (err) {
    console.error('[SearchCache] setCache error:', err);
  }
}

export async function checkPendingSearch(
  query: string,
  filters: Record<string, any>
): Promise<string | null> {
  if (!query || typeof query !== 'string') return null;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return null;

  try {
    const pendingKey = `${SEARCH_PENDING_PREFIX}${buildCacheKey(query, filters)}`;
    return await redis.get(pendingKey);
  } catch (err) {
    console.error('[SearchCache] checkPending error:', err);
    return null;
  }
}

export async function markSearchPending(
  query: string,
  filters: Record<string, any>,
  requestId: string
): Promise<boolean> {
  if (!query || typeof query !== 'string') return false;
  if (!requestId) return false;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return false;

  try {
    const pendingKey = `${SEARCH_PENDING_PREFIX}${buildCacheKey(query, filters)}`;
    const result = await redis.set(pendingKey, requestId, 'EX', 30, 'NX');
    return result === 'OK';
  } catch (err) {
    console.error('[SearchCache] markPending error:', err);
    return false;
  }
}

export async function clearPendingSearch(
  query: string,
  filters: Record<string, any>
): Promise<void> {
  if (!query || typeof query !== 'string') return;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return;

  try {
    const pendingKey = `${SEARCH_PENDING_PREFIX}${buildCacheKey(query, filters)}`;
    await redis.del(pendingKey);
  } catch (err) {
    console.error('[SearchCache] clearPending error:', err);
  }
}

export async function waitForPendingSearch(
  query: string,
  filters: Record<string, any>,
  config: Partial<SearchCacheConfig> = {}
): Promise<CachedSearchResult | null> {
  if (!query || typeof query !== 'string') return null;
  
  const { maxPendingWaitMs } = { ...DEFAULT_CONFIG, ...config };
  const startTime = Date.now();
  const pollInterval = 100;

  while (Date.now() - startTime < maxPendingWaitMs) {
    const cached = await getCachedSearchResult(query, filters);
    if (cached) {
      await redis.hincrby(`${SEARCH_STATS_PREFIX}global`, 'dedup_saves', 1).catch((err) => {
        console.debug('[SearchCache] Stats increment failed:', err instanceof Error ? err.message : err);
      });
      return cached;
    }

    const stillPending = await checkPendingSearch(query, filters);
    if (!stillPending) {
      return await getCachedSearchResult(query, filters);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return null;
}

export interface ExternalSearchDedup {
  shouldProceed: boolean;
  existingJobId: string | null;
}

export async function checkExternalSearchDedup(
  query: string
): Promise<ExternalSearchDedup> {
  if (!query || typeof query !== 'string') return { shouldProceed: true, existingJobId: null };
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return { shouldProceed: true, existingJobId: null };

  try {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) return { shouldProceed: true, existingJobId: null };
    
    const dedupKey = `${REDIS_KEY_PREFIX}external:pending:${Buffer.from(normalizedQuery).toString('base64').slice(0, 32)}`;
    
    const existingJobId = await redis.get(dedupKey);
    if (existingJobId) {
      await redis.hincrby(`${SEARCH_STATS_PREFIX}global`, 'external_dedup_saves', 1).catch((err) => {
        console.debug('[SearchCache] Stats increment failed:', err instanceof Error ? err.message : err);
      });
      return { shouldProceed: false, existingJobId };
    }
    
    return { shouldProceed: true, existingJobId: null };
  } catch (err) {
    console.error('[SearchCache] checkExternalDedup error:', err);
    return { shouldProceed: true, existingJobId: null };
  }
}

export async function markExternalSearchPending(
  query: string,
  jobId: string,
  ttlSeconds: number = 60
): Promise<void> {
  if (!query || typeof query !== 'string') return;
  if (!jobId) return;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return;

  try {
    const normalizedQuery = normalizeQuery(query);
    if (!normalizedQuery) return;
    
    const dedupKey = `${REDIS_KEY_PREFIX}external:pending:${Buffer.from(normalizedQuery).toString('base64').slice(0, 32)}`;
    await redis.setex(dedupKey, ttlSeconds, jobId);
  } catch (err) {
    console.error('[SearchCache] markExternalPending error:', err);
  }
}

export async function getSearchCacheStats(): Promise<{
  hits: number;
  misses: number;
  hitRate: number;
  dedupSaves: number;
  externalDedupSaves: number;
}> {
  const ready = await waitForRedis(redis, 500);
  if (!ready) {
    return { hits: 0, misses: 0, hitRate: 0, dedupSaves: 0, externalDedupSaves: 0 };
  }

  try {
    const stats = await redis.hgetall(`${SEARCH_STATS_PREFIX}global`);
    const hits = parseInt(stats.hits || '0', 10);
    const misses = parseInt(stats.misses || '0', 10);
    const dedupSaves = parseInt(stats.dedup_saves || '0', 10);
    const externalDedupSaves = parseInt(stats.external_dedup_saves || '0', 10);
    const total = hits + misses;
    
    return {
      hits,
      misses,
      hitRate: total > 0 ? (hits / total) * 100 : 0,
      dedupSaves,
      externalDedupSaves,
    };
  } catch (err) {
    console.error('[SearchCache] getStats error:', err);
    return { hits: 0, misses: 0, hitRate: 0, dedupSaves: 0, externalDedupSaves: 0 };
  }
}

export async function invalidateSearchCache(pattern?: string): Promise<number> {
  const ready = await waitForRedis(redis, 1000);
  if (!ready) return 0;

  try {
    const searchPattern = pattern 
      ? `${SEARCH_CACHE_PREFIX}*${pattern}*`
      : `${SEARCH_CACHE_PREFIX}*`;
    
    let cursor = '0';
    let deletedCount = 0;
    const maxIterations = 100; // Prevent infinite loops
    let iterations = 0;
    
    do {
      const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', searchPattern, 'COUNT', 100);
      cursor = nextCursor;
      iterations++;
      
      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0' && iterations < maxIterations);
    
    if (iterations >= maxIterations) {
      console.warn('[SearchCache] invalidateSearchCache hit max iterations limit');
    }
    
    return deletedCount;
  } catch (err) {
    console.error('[SearchCache] invalidate error:', err);
    return 0;
  }
}

export interface QueryHeat {
  count: number;
  unique_users: number;
  first_seen: number;
  last_seen: number;
}

/**
 * Track search intent and heat for a query.
 * Normalizes query and updates counts/timestamps in Redis.
 */
export async function updateQueryHeat(query: string, userId?: string): Promise<void> {
  if (!query || typeof query !== 'string') return;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return;

  try {
    const normalized = normalizeQuery(query);
    if (!normalized) return;
    
    const hash = Buffer.from(normalized).toString('base64').slice(0, 32);
    const heatKey = `${SEARCH_HEAT_PREFIX}${hash}`;
    const usersKey = `${heatKey}:users`;
    
    const now = Date.now();
    const multi = redis.multi();
    
    multi.hincrby(heatKey, 'count', 1);
    multi.hsetnx(heatKey, 'first_seen', now.toString());
    multi.hset(heatKey, 'last_seen', now.toString());
    
    if (userId) {
      multi.sadd(usersKey, userId);
      multi.expire(usersKey, 86400);
    }
    
    multi.expire(heatKey, 86400);
    await multi.exec();
  } catch (err) {
    console.error('[SearchCache] updateQueryHeat error:', err);
  }
}

/**
 * Get current heat stats for a query.
 */
export async function getQueryHeat(query: string): Promise<QueryHeat> {
  if (!query || typeof query !== 'string') {
    return { count: 0, unique_users: 0, first_seen: 0, last_seen: 0 };
  }
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return { count: 0, unique_users: 0, first_seen: 0, last_seen: 0 };

  try {
    const normalized = normalizeQuery(query);
    if (!normalized) return { count: 0, unique_users: 0, first_seen: 0, last_seen: 0 };
    
    const hash = Buffer.from(normalized).toString('base64').slice(0, 32);
    const heatKey = `${SEARCH_HEAT_PREFIX}${hash}`;
    const usersKey = `${heatKey}:users`;
    
    const [stats, unique_users] = await Promise.all([
      redis.hgetall(heatKey),
      redis.scard(usersKey)
    ]);
    
    return {
      count: parseInt(stats.count || '0', 10),
      unique_users: unique_users || 0,
      first_seen: parseInt(stats.first_seen || '0', 10),
      last_seen: parseInt(stats.last_seen || '0', 10)
    };
  } catch (err) {
    console.error('[SearchCache] getQueryHeat error:', err);
    return { count: 0, unique_users: 0, first_seen: 0, last_seen: 0 };
  }
}

export type SkipReason = 'queue_unhealthy' | 'low_heat' | 'workers_offline' | 'user_quota_bypass' | 'guest_gated';

export interface DeferredQuery {
  query: string;
  first_skipped_at: number;
  skip_reason: SkipReason;
  retry_count: number;
  is_premium?: boolean;
  is_logged_in?: boolean;
}

/**
 * Store a query for deferred external search processing.
 */
export async function deferSearchQuery(
  query: string, 
  reason: SkipReason, 
  isPremium: boolean = false,
  isLoggedIn: boolean = false
): Promise<void> {
  if (!query || typeof query !== 'string') return;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return;

  try {
    const normalized = normalizeQuery(query);
    if (!normalized) return;
    
    const hash = Buffer.from(normalized).toString('base64').slice(0, 32);
    const deferredKey = `${SEARCH_DEFERRED_PREFIX}${hash}`;
    
    const setSize = await redis.zcard(SEARCH_DEFERRED_ZSET);
    const MAX_DEFERRED_SIZE = 10000;
    
    const existing = await redis.get(deferredKey);
    let data: DeferredQuery;

    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        data = {
          ...parsed,
          skip_reason: reason,
          is_premium: isPremium || parsed.is_premium,
          is_logged_in: isLoggedIn || parsed.is_logged_in
        };
      } catch {
        // Invalid JSON - create new entry
        data = {
          query: normalized,
          first_skipped_at: Date.now(),
          skip_reason: reason,
          retry_count: 0,
          is_premium: isPremium,
          is_logged_in: isLoggedIn
        };
      }
    } else {
      if (setSize >= MAX_DEFERRED_SIZE) {
        console.warn(`[Search Defer] Set size limit reached (${setSize}). Skipping query="${normalized}"`);
        return;
      }
      data = {
        query: normalized,
        first_skipped_at: Date.now(),
        skip_reason: reason,
        retry_count: 0,
        is_premium: isPremium,
        is_logged_in: isLoggedIn
      };
    }

    // Score = Weight + Timestamp
    let weight = FREE_WEIGHT;
    if (data.is_premium) weight = PREMIUM_WEIGHT;
    else if (data.is_logged_in) weight = LOGGED_IN_WEIGHT;
    
    const score = weight + Date.now();

    await redis.setex(deferredKey, 604800, JSON.stringify(data)); // 7 days
    await redis.zadd(SEARCH_DEFERRED_ZSET, score, hash);
    
    console.log(`[Search Defer] Enqueued query="${normalized}" reason=${reason} premium=${data.is_premium} loggedIn=${data.is_logged_in}`);
  } catch (err) {
    console.error('[SearchCache] deferSearchQuery error:', err);
  }
}

/**
 * Get a batch of deferred query hashes.
 * Implements fairness: if premium backlog is huge, still picks some free jobs.
 */
export async function getDeferredQueryHashes(limit: number = 10): Promise<string[]> {
  const ready = await waitForRedis(redis, 500);
  if (!ready) return [];

  try {
    // 1. Get potential candidates from top of ZSET
    // Increase lookahead to 1000 to ensure we find standard hashes even during premium surges
    const hashes = await redis.zrange(SEARCH_DEFERRED_ZSET, 0, 1000);
    if (!hashes || hashes.length === 0) return [];

    const validHashes: string[] = [];
    const highPriorityHashes: string[] = [];
    const standardHashes: string[] = [];

    // 2. Filter and categorize
    for (const hash of hashes) {
      const data = await getDeferredQueryData(hash);
      if (data) {
        if (data.is_premium || data.is_logged_in) highPriorityHashes.push(hash);
        else standardHashes.push(hash);
      } else {
        // Cleanup orphan
        await redis.zrem(SEARCH_DEFERRED_ZSET, hash);
      }
    }

    // 3. Priority Weighting (not exclusion): 70% Premium / 30% Free
    // This ensures premium is processed faster but free users are never starved.
    const highLimit = Math.floor(limit * 0.7);
    const standardLimit = limit - highLimit;
    
    const result = [
      ...highPriorityHashes.slice(0, highLimit),
      ...standardHashes.slice(0, standardLimit)
    ];

    // 4. Fill remaining slots if one category is empty
    if (result.length < limit) {
      const remaining = limit - result.length;
      if (highPriorityHashes.length > highLimit) {
        result.push(...highPriorityHashes.slice(highLimit, highLimit + remaining));
      } else if (standardHashes.length > standardLimit) {
        result.push(...standardHashes.slice(standardLimit, standardLimit + remaining));
      }
    }

    return result.slice(0, limit);
  } catch (err) {
    console.error('[SearchCache] getDeferredQueryHashes error:', err);
    return [];
  }
}

/**
 * Get deferred query data by hash.
 */
export async function getDeferredQueryData(hash: string): Promise<DeferredQuery | null> {
  if (!hash) return null;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return null;

  try {
    const data = await redis.get(`${SEARCH_DEFERRED_PREFIX}${hash}`);
    if (!data) return null;
    
    try {
      return JSON.parse(data);
    } catch {
      // Invalid JSON - clean up
      await redis.del(`${SEARCH_DEFERRED_PREFIX}${hash}`);
      await redis.zrem(SEARCH_DEFERRED_ZSET, hash);
      return null;
    }
  } catch (err) {
    console.error('[SearchCache] getDeferredQueryData error:', err);
    return null;
  }
}

/**
 * Remove a query from deferred processing.
 */
export async function removeDeferredSearchQuery(hash: string): Promise<void> {
  if (!hash) return;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return;

  try {
    await redis.del(`${SEARCH_DEFERRED_PREFIX}${hash}`);
    await redis.zrem(SEARCH_DEFERRED_ZSET, hash);
  } catch (err) {
    console.error('[SearchCache] removeDeferredSearchQuery error:', err);
  }
}

/**
 * Increment retry count for a deferred query.
 */
export async function incrementDeferredRetryCount(hash: string): Promise<number> {
  if (!hash) return 0;
  
  const ready = await waitForRedis(redis, 500);
  if (!ready) return 0;

  try {
    const deferredKey = `${SEARCH_DEFERRED_PREFIX}${hash}`;
    const existing = await redis.get(deferredKey);
    if (!existing) return 0;

    try {
      const data: DeferredQuery = JSON.parse(existing);
      data.retry_count += 1;
      
      await redis.set(deferredKey, JSON.stringify(data), 'KEEPTTL');
      return data.retry_count;
    } catch {
      return 0;
    }
  } catch (err) {
    console.error('[SearchCache] incrementDeferredRetryCount error:', err);
    return 0;
  }
}
