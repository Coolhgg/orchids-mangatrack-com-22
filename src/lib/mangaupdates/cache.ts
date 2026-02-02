/**
 * MangaUpdates Cache Layer - MangaTrack
 *
 * Use official API V1 — do not scrape.
 *
 * TTL-based cache wrapper with Redis support (optional) and in-memory fallback.
 * Caching is critical to avoid hitting the MangaUpdates rate limit (~1 req/sec).
 *
 * CACHE TTL RECOMMENDATIONS:
 * - Series metadata: 24 hours (86400 seconds)
 * - Latest releases: 15-30 minutes (900-1800 seconds)
 * - Search results: 1 hour (3600 seconds)
 */

import Redis from 'ioredis';

// ============================================================================
// Configuration
// ============================================================================

const CACHE_PREFIX = 'mu:cache:';
const DEFAULT_TTL_SECONDS = 86400; // 24 hours

// ============================================================================
// In-Memory Cache (Fallback)
// ============================================================================

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryCache {
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Cleanup expired entries every 5 minutes
    this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  async get<T>(key: string): Promise<T | null> {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async has(key: string): Promise<boolean> {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) {
        this.cache.delete(key);
      }
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

// ============================================================================
// Redis Cache Wrapper
// ============================================================================

class RedisCache {
  private client: Redis;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: true,
    });

    this.client.on('error', (err) => {
      console.error('[MangaUpdates Cache] Redis error:', err.message);
    });

    this.client.on('connect', () => {
      console.log('[MangaUpdates Cache] Redis connected');
    });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const data = await this.client.get(CACHE_PREFIX + key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch (error) {
      console.error('[MangaUpdates Cache] Redis get error:', error);
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(
        CACHE_PREFIX + key,
        JSON.stringify(value),
        'EX',
        ttlSeconds
      );
    } catch (error) {
      console.error('[MangaUpdates Cache] Redis set error:', error);
    }
  }

  async delete(key: string): Promise<boolean> {
    try {
      const result = await this.client.del(CACHE_PREFIX + key);
      return result > 0;
    } catch (error) {
      console.error('[MangaUpdates Cache] Redis delete error:', error);
      return false;
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      const result = await this.client.exists(CACHE_PREFIX + key);
      return result > 0;
    } catch (error) {
      console.error('[MangaUpdates Cache] Redis exists error:', error);
      return false;
    }
  }

  async destroy(): Promise<void> {
    await this.client.quit();
  }
}

// ============================================================================
// Cache Interface
// ============================================================================

export interface CacheInterface {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  has(key: string): Promise<boolean>;
}

// ============================================================================
// MangaUpdates Cache Singleton
// ============================================================================

/**
 * MangaUpdates cache instance.
 *
 * Uses Redis if REDIS_URL environment variable is set, otherwise falls back
 * to in-memory cache.
 *
 * IMPORTANT: In-memory cache is per-process and will not persist across
 * restarts. For production, always configure REDIS_URL.
 */
class MangaUpdatesCache implements CacheInterface {
  private backend: InMemoryCache | RedisCache;
  private isRedis: boolean;

  constructor() {
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      console.log('[MangaUpdates Cache] Initializing with Redis backend');
      this.backend = new RedisCache(redisUrl);
      this.isRedis = true;
    } else {
      console.log('[MangaUpdates Cache] Initializing with in-memory backend (REDIS_URL not set)');
      this.backend = new InMemoryCache();
      this.isRedis = false;
    }
  }

  /**
   * Get a cached value by key.
   *
   * @param key - Cache key
   * @returns Cached value or null if not found/expired
   */
  async get<T>(key: string): Promise<T | null> {
    return this.backend.get<T>(key);
  }

  /**
   * Set a cached value with TTL.
   *
   * @param key - Cache key
   * @param value - Value to cache (will be JSON serialized)
   * @param ttlSeconds - Time to live in seconds (default: 24 hours)
   */
  async set<T>(key: string, value: T, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    return this.backend.set(key, value, ttlSeconds);
  }

  /**
   * Delete a cached value.
   *
   * @param key - Cache key
   * @returns true if the key was deleted, false otherwise
   */
  async delete(key: string): Promise<boolean> {
    return this.backend.delete(key);
  }

  /**
   * Check if a key exists in the cache.
   *
   * @param key - Cache key
   * @returns true if key exists and is not expired
   */
  async has(key: string): Promise<boolean> {
    return this.backend.has(key);
  }

  /**
   * Get cache backend type.
   */
  get backendType(): 'redis' | 'memory' {
    return this.isRedis ? 'redis' : 'memory';
  }
}

// ============================================================================
// Singleton Export
// ============================================================================

// Use global singleton to survive Next.js hot reloads
const globalForCache = globalThis as unknown as {
  mangaupdatesCache: MangaUpdatesCache | undefined;
};

export const mangaupdatesCache: MangaUpdatesCache =
  globalForCache.mangaupdatesCache ?? new MangaUpdatesCache();

if (process.env.NODE_ENV !== 'production') {
  globalForCache.mangaupdatesCache = mangaupdatesCache;
}

// ============================================================================
// Cache Key Generators
// ============================================================================

/**
 * Generate a cache key for series metadata.
 */
export function seriesCacheKey(seriesId: number): string {
  return `series:${seriesId}`;
}

/**
 * Generate a cache key for releases polling.
 */
export function releasesCacheKey(days: number, page: number): string {
  return `releases:days:${days}:page:${page}`;
}

/**
 * Generate a cache key for search results.
 */
export function searchCacheKey(query: string, page: number): string {
  return `search:${encodeURIComponent(query)}:page:${page}`;
}

// ============================================================================
// Cache TTL Constants
// ============================================================================

export const CACHE_TTL = {
  /** Series metadata - 24 hours */
  SERIES_METADATA: 86400,
  /** Latest releases - 15 minutes */
  RELEASES: 900,
  /** Search results - 1 hour */
  SEARCH: 3600,
} as const;
