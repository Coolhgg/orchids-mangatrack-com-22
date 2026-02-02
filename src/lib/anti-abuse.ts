import { redis, REDIS_KEY_PREFIX, waitForRedis } from './redis';
import { maybeRecordViolation, ViolationType } from './gamification/trust-score';

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  reset: number;
}

interface BotDetectionResult {
  isBot: boolean;
  reason?: string;
  violationType?: ViolationType;
}

const ABUSE_KEY_PREFIX = `${REDIS_KEY_PREFIX}abuse:`;

class InMemoryAbuseStore {
  private static readonly MAX_COUNTERS = 10000;
  private static readonly MAX_VALUES = 5000;
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - synced with api-utils store
  
  private counters = new Map<string, { count: number; resetAt: number }>();
  private lastValues = new Map<string, { value: string; timestamp: number }>();
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private isShuttingDown = false;
  private lastCleanup = 0;

  constructor() {
    if (typeof setInterval !== 'undefined' && typeof process !== 'undefined' && !process.env.VERCEL) {
      this.cleanupInterval = setInterval(() => this.scheduledCleanup(), InMemoryAbuseStore.CLEANUP_INTERVAL_MS);
      if (this.cleanupInterval.unref) this.cleanupInterval.unref();
    }
  }

  increment(key: string, windowMs: number, maxCount: number): RateLimitResult {
    const now = Date.now();
    
    if (this.counters.size >= InMemoryAbuseStore.MAX_COUNTERS) {
      this.evictExpiredCounters(now);
      if (this.counters.size >= InMemoryAbuseStore.MAX_COUNTERS) {
        this.evictOldestCounters(Math.floor(InMemoryAbuseStore.MAX_COUNTERS * 0.1));
      }
    }
    
    const record = this.counters.get(key);
    
    if (!record || now > record.resetAt) {
      this.counters.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxCount - 1, reset: now + windowMs };
    }
    
    record.count++;
    return {
      allowed: record.count <= maxCount,
      remaining: Math.max(0, maxCount - record.count),
      reset: record.resetAt,
    };
  }

  getLastValue(key: string): { value: string; timestamp: number } | null {
    const entry = this.lastValues.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > 60000) {
      this.lastValues.delete(key);
      return null;
    }
    return entry;
  }

  setLastValue(key: string, value: string): void {
    const now = Date.now();
    
    if (this.lastValues.size >= InMemoryAbuseStore.MAX_VALUES) {
      this.evictExpiredValues(now);
      if (this.lastValues.size >= InMemoryAbuseStore.MAX_VALUES) {
        this.evictOldestValues(Math.floor(InMemoryAbuseStore.MAX_VALUES * 0.1));
      }
    }
    
    this.lastValues.set(key, { value, timestamp: now });
  }
  
  private evictExpiredCounters(now: number): void {
    for (const [key, record] of this.counters) {
      if (now > record.resetAt) {
        this.counters.delete(key);
      }
    }
  }
  
  private evictOldestCounters(count: number): void {
    const entries = Array.from(this.counters.entries())
      .sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.counters.delete(entries[i][0]);
    }
  }
  
  private evictExpiredValues(now: number): void {
    const expiryThreshold = now - 60000;
    for (const [key, entry] of this.lastValues) {
      if (entry.timestamp < expiryThreshold) {
        this.lastValues.delete(key);
      }
    }
  }
  
  private evictOldestValues(count: number): void {
    const entries = Array.from(this.lastValues.entries())
      .sort((a, b) => a[1].timestamp - b[1].timestamp);
    for (let i = 0; i < Math.min(count, entries.length); i++) {
      this.lastValues.delete(entries[i][0]);
    }
  }

  private scheduledCleanup(): void {
    if (this.isShuttingDown) return;
    const now = Date.now();
    this.lastCleanup = now;
    this.evictExpiredCounters(now);
    this.evictExpiredValues(now);
  }

  shutdown(): void {
    this.isShuttingDown = true;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.counters.clear();
    this.lastValues.clear();
  }
}

const globalForAbuse = global as unknown as { abuseStore: InMemoryAbuseStore };
const memoryStore = globalForAbuse.abuseStore || new InMemoryAbuseStore();
if (process.env.NODE_ENV !== 'production') globalForAbuse.abuseStore = memoryStore;

if (typeof process !== 'undefined' && process.on) {
  const handleShutdown = () => {
    memoryStore.shutdown();
  };
  process.on('beforeExit', handleShutdown);
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

async function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): Promise<RateLimitResult> {
  const redisReady = await waitForRedis(redis, 300);
  const fullKey = `${ABUSE_KEY_PREFIX}${key}`;
  const now = Date.now();

  if (redisReady) {
    try {
      const multi = redis.multi();
      multi.incr(fullKey);
      multi.pttl(fullKey);
      const results = await multi.exec();

      if (results && results[0] && results[0][1] !== null) {
        const count = results[0][1] as number;
        let pttl = results[1] ? (results[1][1] as number) : -1;

        if (pttl === -1 || pttl < 0) {
          await redis.pexpire(fullKey, windowMs);
          pttl = windowMs;
        }

        return {
          allowed: count <= maxRequests,
          remaining: Math.max(0, maxRequests - count),
          reset: now + pttl,
        };
      }
    } catch {
      // Fall through to memory
    }
  }

  return memoryStore.increment(key, windowMs, maxRequests);
}

async function getLastChapter(userId: string, entryId: string): Promise<number | null> {
  const key = `last-chapter:${userId}:${entryId}`;
  const redisReady = await waitForRedis(redis, 200);

  if (redisReady) {
    try {
      const val = await redis.get(`${ABUSE_KEY_PREFIX}${key}`);
      return val ? parseInt(val, 10) : null;
    } catch {
      // Fall through
    }
  }

  const entry = memoryStore.getLastValue(key);
  return entry ? parseInt(entry.value, 10) : null;
}

async function setLastChapter(userId: string, entryId: string, chapter: number): Promise<void> {
  const key = `last-chapter:${userId}:${entryId}`;
  const redisReady = await waitForRedis(redis, 200);

  if (redisReady) {
    try {
      await redis.set(`${ABUSE_KEY_PREFIX}${key}`, String(chapter), 'EX', 60);
      return;
    } catch {
      // Fall through
    }
  }

  memoryStore.setLastValue(key, String(chapter));
}

async function getLastStatus(userId: string, entryId: string): Promise<string | null> {
  const key = `last-status:${userId}:${entryId}`;
  const redisReady = await waitForRedis(redis, 200);

  if (redisReady) {
    try {
      return await redis.get(`${ABUSE_KEY_PREFIX}${key}`);
    } catch {
      // Fall through
    }
  }

  const entry = memoryStore.getLastValue(key);
  return entry?.value || null;
}

async function setLastStatus(userId: string, entryId: string, status: string): Promise<void> {
  const key = `last-status:${userId}:${entryId}`;
  const redisReady = await waitForRedis(redis, 200);

  if (redisReady) {
    try {
      await redis.set(`${ABUSE_KEY_PREFIX}${key}`, status, 'EX', 300);
      return;
    } catch {
      // Fall through
    }
  }

  memoryStore.setLastValue(key, status);
}

export const antiAbuse = {
  /**
   * Check progress rate limit and apply trust score penalty if violated
   */
  async checkProgressRateLimit(userId: string): Promise<{ allowed: boolean; hardBlock: boolean }> {
    const minuteLimit = await rateLimit(`progress:min:${userId}`, 10, 60000);
    if (!minuteLimit.allowed) {
      // TRUST SCORE: Record API spam violation
      await maybeRecordViolation(userId, 'api_spam', { 
        type: 'progress_rate_limit',
        limit: 10,
        window: '1 minute'
      });
      return { allowed: false, hardBlock: true };
    }

    const burstLimit = await rateLimit(`progress:burst:${userId}`, 3, 5000);
    if (!burstLimit.allowed) {
      // TRUST SCORE: Record rapid reads violation
      await maybeRecordViolation(userId, 'rapid_reads', {
        type: 'burst_limit',
        limit: 3,
        window: '5 seconds'
      });
      return { allowed: false, hardBlock: true };
    }

    return { allowed: true, hardBlock: false };
  },

  /**
   * Check status change rate limit and apply trust score penalty if violated
   */
  async checkStatusRateLimit(userId: string): Promise<{ allowed: boolean; hardBlock: boolean }> {
    const minuteLimit = await rateLimit(`status:min:${userId}`, 5, 60000);
    if (!minuteLimit.allowed) {
      // TRUST SCORE: Record API spam violation
      await maybeRecordViolation(userId, 'api_spam', {
        type: 'status_rate_limit',
        limit: 5,
        window: '1 minute'
      });
    }
    return { allowed: minuteLimit.allowed, hardBlock: !minuteLimit.allowed };
  },

  /**
   * Check if XP can be granted (rate limited to prevent farming)
   * QA FIX: Rate limit is now global across ALL library entries to prevent bypass
   * by updating different entries rapidly.
   * Limit: 10 XP grants per minute (allows normal binge reading but stops abuse)
   */
  async canGrantXp(userId: string): Promise<boolean> {
    // Global XP rate limit across all library entries
    const globalResult = await rateLimit(`xp:global:${userId}`, 10, 60000);
    if (!globalResult.allowed) {
      return false;
    }
    
    // Additional burst protection: max 3 XP grants in 10 seconds
    const burstResult = await rateLimit(`xp:burst:${userId}`, 3, 10000);
    return burstResult.allowed;
  },

  /**
   * Detect bot patterns in progress updates and apply trust score penalties
   * 
   * NOTE: Large chapter jumps are NOT flagged as bot behavior.
   * Users importing their series from other trackers will have large jumps (e.g., 0→98)
   * and should NOT be penalized. XP is already limited to 1 per request regardless of jump size.
   */
  async detectProgressBotPatterns(
    userId: string,
    entryId: string,
    chapterNumber: number | null | undefined,
    currentLastRead: number
  ): Promise<BotDetectionResult> {
    if (chapterNumber === null || chapterNumber === undefined) {
      return { isBot: false };
    }

    // NOTE: We intentionally DO NOT check for large chapter jumps here.
    // Bulk progress (imports, migrations, binge reading) is trusted.
    // XP is already capped at 1 per request regardless of jump size.

    // Check for repeated same chapter (actual abuse pattern)
    const lastChapter = await getLastChapter(userId, entryId);
    if (lastChapter !== null && lastChapter === chapterNumber) {
      // TRUST SCORE: Record repeated same chapter violation
      await maybeRecordViolation(userId, 'repeated_same_chapter', {
        chapter: chapterNumber,
        entryId
      });
      return { isBot: true, reason: 'repeated_same_chapter', violationType: 'repeated_same_chapter' };
    }

    await setLastChapter(userId, entryId, chapterNumber);
    return { isBot: false };
  },

  /**
   * Detect bot patterns in status changes and apply trust score penalties
   */
  async detectStatusBotPatterns(
    userId: string,
    entryId: string,
    newStatus: string
  ): Promise<BotDetectionResult> {
    const lastStatus = await getLastStatus(userId, entryId);
    
    if (lastStatus && lastStatus !== newStatus) {
      const toggleKey = `status-toggle:${userId}:${entryId}`;
      const toggleResult = await rateLimit(toggleKey, 3, 300000);
      
      if (!toggleResult.allowed) {
        // TRUST SCORE: Record status toggle violation
        await maybeRecordViolation(userId, 'status_toggle', {
          from: lastStatus,
          to: newStatus,
          entryId
        });
        return { isBot: true, reason: 'rapid_status_toggle', violationType: 'status_toggle' };
      }
    }

    await setLastStatus(userId, entryId, newStatus);
    return { isBot: false };
  },
};

export type AntiAbuse = typeof antiAbuse;
