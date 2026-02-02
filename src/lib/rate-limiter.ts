import { redis, REDIS_KEY_PREFIX } from './redis';
import { NEGATIVE_CACHE_CONFIG } from './job-config';

export interface SourceRateConfig {
  requestsPerSecond: number;
  burstSize: number;
  cooldownMs: number;
}

const DEFAULT_SOURCE_LIMITS: Record<string, SourceRateConfig> = {
  mangadex: {
    requestsPerSecond: 5,
    burstSize: 10,
    cooldownMs: 200,
  },
  mangapark: {
    requestsPerSecond: 0.5,
    burstSize: 2,
    cooldownMs: 2000,
  },
  mangasee: {
    requestsPerSecond: 0.3,
    burstSize: 1,
    cooldownMs: 3000,
  },
  bato: {
    requestsPerSecond: 0.5,
    burstSize: 2,
    cooldownMs: 2000,
  },
  manganato: {
    requestsPerSecond: 0.5,
    burstSize: 2,
    cooldownMs: 2000,
  },
  mangakakalot: {
    requestsPerSecond: 0.5,
    burstSize: 2,
    cooldownMs: 2000,
  },
  hiperdex: {
    requestsPerSecond: 0.2,
    burstSize: 1,
    cooldownMs: 5000,
  },
};

const DEFAULT_LIMIT: SourceRateConfig = {
  requestsPerSecond: 0.5,
  burstSize: 1,
  cooldownMs: 2000,
};

export function getSourceRateConfig(sourceName: string): SourceRateConfig {
  const normalized = sourceName.toLowerCase();
  
  const envKey = `RATE_LIMIT_${normalized.toUpperCase()}`;
  const envValue = process.env[envKey];
  
  if (envValue) {
    const parts = envValue.split(',').map(p => parseInt(p.trim(), 10));
    if (parts.length === 3 && parts.every(p => !isNaN(p) && p > 0)) {
      return {
        requestsPerSecond: parts[0],
        burstSize: parts[1],
        cooldownMs: parts[2],
      };
    }
    console.warn(`[RateLimiter] Invalid env override for ${envKey}: ${envValue}, using defaults`);
  }
  
  return DEFAULT_SOURCE_LIMITS[normalized] || DEFAULT_LIMIT;
}

interface NegativeCacheEntry {
  emptyCount: number;
  lastEmptyAt: number;
}

export class NegativeResultCache {
  private readonly keyPrefix: string;

  constructor() {
    this.keyPrefix = `${REDIS_KEY_PREFIX}negative:`;
  }

  async shouldSkip(seriesSourceId: string): Promise<boolean> {
    const key = `${this.keyPrefix}${seriesSourceId}`;
    const cached = await redis.get(key);
    
    if (!cached) return false;
    
    try {
      const data = JSON.parse(cached) as NegativeCacheEntry;
      return data.emptyCount >= NEGATIVE_CACHE_CONFIG.THRESHOLD;
    } catch {
      return false;
    }
  }

  async recordResult(seriesSourceId: string, isEmpty: boolean): Promise<void> {
    const key = `${this.keyPrefix}${seriesSourceId}`;
    
    if (!isEmpty) {
      await redis.del(key);
      return;
    }

    const existing = await redis.get(key);
    let data: NegativeCacheEntry;
    
    if (existing) {
      try {
        data = JSON.parse(existing) as NegativeCacheEntry;
        data.emptyCount++;
        data.lastEmptyAt = Date.now();
      } catch {
        data = { emptyCount: 1, lastEmptyAt: Date.now() };
      }
    } else {
      data = { emptyCount: 1, lastEmptyAt: Date.now() };
    }
    
    await redis.set(key, JSON.stringify(data), 'PX', NEGATIVE_CACHE_CONFIG.TTL_MS);
  }

  async getStatus(seriesSourceId: string): Promise<NegativeCacheEntry | null> {
    const key = `${this.keyPrefix}${seriesSourceId}`;
    const cached = await redis.get(key);
    
    if (!cached) return null;
    
    try {
      return JSON.parse(cached) as NegativeCacheEntry;
    } catch {
      return null;
    }
  }
}

export class SourceRateLimiter {
  private readonly keyPrefix: string;
  
  constructor() {
    this.keyPrefix = `${REDIS_KEY_PREFIX}ratelimit:`;
  }
  
  async acquireToken(sourceName: string, maxWaitMs: number = 30000): Promise<boolean> {
    const normalized = sourceName.toLowerCase();
    const config = getSourceRateConfig(normalized);
    const tokensKey = `${this.keyPrefix}${normalized}:tokens`;
    const lastRefillKey = `${this.keyPrefix}${normalized}:last_refill`;
    
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.tryAcquireToken(
        tokensKey,
        lastRefillKey,
        config
      );
      
      if (result.acquired) {
        if (config.cooldownMs > 0) {
          await this.sleep(config.cooldownMs);
        }
        return true;
      }
      
      const waitTime = Math.min(result.waitMs, maxWaitMs - (Date.now() - startTime));
      if (waitTime > 0) {
        await this.sleep(waitTime);
      }
    }
    
    console.warn(`[RateLimiter] Timeout waiting for token for ${sourceName}`);
    return false;
  }
  
  async hasAvailableToken(sourceName: string): Promise<boolean> {
    const normalized = sourceName.toLowerCase();
    const config = getSourceRateConfig(normalized);
    const tokensKey = `${this.keyPrefix}${normalized}:tokens`;
    const lastRefillKey = `${this.keyPrefix}${normalized}:last_refill`;
    
    const result = await this.getTokenState(tokensKey, lastRefillKey, config);
    return result.tokens >= 1;
  }
  
  async getStatus(sourceName: string): Promise<{
    tokens: number;
    maxTokens: number;
    requestsPerSecond: number;
    lastRefillAt: Date | null;
  }> {
    const normalized = sourceName.toLowerCase();
    const config = getSourceRateConfig(normalized);
    const tokensKey = `${this.keyPrefix}${normalized}:tokens`;
    const lastRefillKey = `${this.keyPrefix}${normalized}:last_refill`;
    
    const state = await this.getTokenState(tokensKey, lastRefillKey, config);
    
    return {
      tokens: Math.floor(state.tokens),
      maxTokens: config.burstSize,
      requestsPerSecond: config.requestsPerSecond,
      lastRefillAt: state.lastRefillAt,
    };
  }
  
  private async tryAcquireToken(
    tokensKey: string,
    lastRefillKey: string,
    config: SourceRateConfig
  ): Promise<{ acquired: boolean; waitMs: number }> {
    const now = Date.now();
    
    const script = `
      local tokensKey = KEYS[1]
      local lastRefillKey = KEYS[2]
      local now = tonumber(ARGV[1])
      local rps = tonumber(ARGV[2])
      local burstSize = tonumber(ARGV[3])
      
      local tokens = tonumber(redis.call('GET', tokensKey) or burstSize)
      local lastRefill = tonumber(redis.call('GET', lastRefillKey) or now)
      
      local elapsed = (now - lastRefill) / 1000
      local refillAmount = elapsed * rps
      tokens = math.min(burstSize, tokens + refillAmount)
      
      if tokens >= 1 then
        tokens = tokens - 1
        redis.call('SET', tokensKey, tokens, 'EX', 3600)
        redis.call('SET', lastRefillKey, now, 'EX', 3600)
        return {1, 0}
      else
        local deficit = 1 - tokens
        local waitMs = math.ceil((deficit / rps) * 1000)
        redis.call('SET', tokensKey, tokens, 'EX', 3600)
        redis.call('SET', lastRefillKey, now, 'EX', 3600)
        return {0, waitMs}
      end
    `;
    
    const result = await redis.eval(
      script,
      2,
      tokensKey,
      lastRefillKey,
      now.toString(),
      config.requestsPerSecond.toString(),
      config.burstSize.toString()
    ) as [number, number];
    
    return {
      acquired: result[0] === 1,
      waitMs: result[1],
    };
  }
  
  private async getTokenState(
    tokensKey: string,
    lastRefillKey: string,
    config: SourceRateConfig
  ): Promise<{ tokens: number; lastRefillAt: Date | null }> {
    const [tokensStr, lastRefillStr] = await Promise.all([
      redis.get(tokensKey),
      redis.get(lastRefillKey),
    ]);
    
    const now = Date.now();
    let tokens = tokensStr ? parseFloat(tokensStr) : config.burstSize;
    const lastRefill = lastRefillStr ? parseInt(lastRefillStr, 10) : now;
    
    const elapsed = (now - lastRefill) / 1000;
    const refillAmount = elapsed * config.requestsPerSecond;
    tokens = Math.min(config.burstSize, tokens + refillAmount);
    
    return {
      tokens,
      lastRefillAt: lastRefillStr ? new Date(lastRefill) : null,
    };
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

const globalForRateLimiter = globalThis as unknown as { 
  sourceRateLimiter: SourceRateLimiter | undefined;
  negativeResultCache: NegativeResultCache | undefined;
};

export const sourceRateLimiter = globalForRateLimiter.sourceRateLimiter ?? new SourceRateLimiter();
export const negativeResultCache = globalForRateLimiter.negativeResultCache ?? new NegativeResultCache();

if (process.env.NODE_ENV !== 'production') {
  globalForRateLimiter.sourceRateLimiter = sourceRateLimiter;
  globalForRateLimiter.negativeResultCache = negativeResultCache;
}
