import 'dotenv/config';
import Redis, { RedisOptions } from 'ioredis';

const environment = process.env.NODE_ENV || 'development';
export const REDIS_KEY_PREFIX = `mangatrack:${environment}:`;

/**
 * Determines if Sentinel mode is enabled based on environment variables.
 * Sentinel is ONLY enabled when REDIS_SENTINEL_HOSTS is set.
 */
const isSentinelMode = !!process.env.REDIS_SENTINEL_HOSTS;

/**
 * Parse Sentinel hosts from env var.
 * Format: "host1:port1,host2:port2,host3:port3"
 */
function parseSentinelHosts(): Array<{ host: string; port: number }> {
  const hostsStr = process.env.REDIS_SENTINEL_HOSTS || '';
  if (!hostsStr) return [];
  
  return hostsStr.split(',').map(hostPort => {
    const [host, port] = hostPort.trim().split(':');
    return { host, port: parseInt(port, 10) || 26379 };
  });
}

/**
 * Build Redis connection options based on mode (single-node vs Sentinel).
 * @param url Optional explicit Redis URL. If not provided, defaults based on environment.
 */
export function buildRedisOptions(url?: string): RedisOptions {
  const baseOptions: RedisOptions = {
    maxRetriesPerRequest: null, // REQUIRED for BullMQ
    enableOfflineQueue: true,   // Allow queueing commands while connecting
    connectTimeout: isSentinelMode ? 15000 : 5000, // M4 FIX: Longer timeout for Sentinel failover
    retryStrategy: (times) => {
      if (times > 3) return null; // Stop retrying after 3 attempts to save connections
      return Math.min(times * 500, 2000);
    },
    reconnectOnError: (err) => {
      const targetErrors = ['READONLY', 'ECONNRESET', 'ETIMEDOUT'];
      return targetErrors.some(e => err.message.includes(e));
    },
  };

  if (isSentinelMode && !url) {
    // Sentinel mode configuration (only if no explicit URL is provided)
    const sentinels = parseSentinelHosts();
    const masterName = process.env.REDIS_SENTINEL_MASTER_NAME || 'mymaster';
    const sentinelPassword = process.env.REDIS_SENTINEL_PASSWORD || undefined;
    const redisPassword = process.env.REDIS_PASSWORD || undefined;

    console.log('[Redis] Sentinel mode enabled with %d sentinels, master: %s', sentinels.length, masterName);

    return {
      ...baseOptions,
      sentinels,
      name: masterName,
      sentinelPassword,
      password: redisPassword,
      enableReadyCheck: true,
      sentinelRetryStrategy: (times) => {
        if (times > 5) return null;
        return Math.min(times * 1000, 5000);
      },
      failoverDetector: true,
    };
  }

  // Single-node mode
  const redisUrl = url || process.env.REDIS_URL || 'redis://localhost:6379';
  const parsedUrl = new URL(redisUrl);

  return {
    ...baseOptions,
    host: parsedUrl.hostname,
    port: parseInt(parsedUrl.port) || 6379,
    password: parsedUrl.password || undefined,
    username: parsedUrl.username || undefined,
  };
}

/**
 * Singleton pattern for Next.js hot reload protection
 */
const globalForRedis = globalThis as unknown as { 
  redisApi: Redis | undefined;
  redisWorker: Redis | undefined;
};

/**
 * Masks Redis URL for safe logging.
 * Format: redis://:***@host:port/db
 */
function maskRedisUrl(url: string | undefined): string {
  if (!url) return 'undefined';
  try {
    const parsed = new URL(url);
    const maskedAuth = (parsed.password || parsed.username) ? ':***' : '';
    return `${parsed.protocol}//${maskedAuth}${parsed.host}${parsed.pathname}`;
  } catch {
    return 'invalid-url';
  }
}

/**
 * Creates a configured Redis client.
 */
function createRedisClient(options: RedisOptions, name: string): Redis {
  const client = new Redis({
    ...options,
    lazyConnect: true,
  });

  const clientInfo = options.host ? `${options.host}:${options.port}` : 'Sentinel';
  console.log(`[Redis:${name}] Initializing client for ${clientInfo}`);

  client.on('error', (err) => {
    console.error(`[Redis:${name}] Error: ${err.message}`);
  });

  client.on('connect', () => console.log(`[Redis:${name}] Connection established`));
  client.on('close', () => console.log(`[Redis:${name}] Connection closed`));
  client.on('ready', () => console.log(`[Redis:${name}] Ready (Commands enabled)`));
  
  client.on('reconnecting', (delay: number) => {
    console.warn(`[Redis:${name}] Reconnecting in ${delay}ms...`);
  });

  if (isSentinelMode && !options.host) {
    client.on('+switch-master', () => {
      console.log(`[Redis:${name} Sentinel] Master switch detected - reconnecting to new master`);
    });
  }

  return client;
}

// Startup Logs
const apiRedisUrl = process.env.REDIS_API_URL || process.env.REDIS_URL;
const workerRedisUrl = process.env.REDIS_WORKER_URL || process.env.REDIS_URL;

console.log('[Redis] API Client Target:', maskRedisUrl(apiRedisUrl));
console.log('[Redis] Worker Client Target:', maskRedisUrl(workerRedisUrl));

/**
 * P1-6 FIX: Thread-safe lazy Redis client with mutex to prevent race conditions
 * Creates a proxy for a Redis client to delay its initialization until it's actually used.
 */
function createLazyRedisClient(name: string, factory: () => Redis): Redis {
  let instance: Redis | null = null;
  let initializationLock: Promise<Redis> | null = null;
  
  const ensureInstance = async (): Promise<Redis> => {
    // Fast path: instance already created
    if (instance) return instance;
    
    // Acquire lock for initialization (prevents race condition)
    if (!initializationLock) {
      initializationLock = (async () => {
        // Double-check after acquiring lock
        if (!instance) {
          instance = factory();
        }
        return instance;
      })();
    }
    
    return initializationLock;
  };
  
  // Synchronous instance creation for proxy access
  const getOrCreateInstance = (): Redis => {
    if (!instance) {
      instance = factory();
    }
    return instance;
  };
  
  return new Proxy({} as Redis, {
    get(target, prop, receiver) {
      const inst = getOrCreateInstance();
      const value = Reflect.get(inst, prop, receiver);
      
      if (typeof value === 'function') {
        return (...args: any[]) => {
          const start = Date.now();
          const result = value.apply(inst, args);
          
          if (result instanceof Promise) {
            return result.finally(() => {
              const duration = Date.now() - start;
              if (duration > 50) {
                console.warn(`[Redis:${name}] SLOW OPERATION: ${String(prop)} took ${duration}ms`);
              }
            });
          }
          
          const duration = Date.now() - start;
          if (duration > 50) {
            console.warn(`[Redis:${name}] SLOW OPERATION: ${String(prop)} took ${duration}ms`);
          }
          return result;
        };
      }
      
      return value;
    }
  });
}

// REDIS A: API + caching (Uses API Redis instance)
export const redisApi = createLazyRedisClient('API', () => {
  if (globalForRedis.redisApi) return globalForRedis.redisApi;
  
  // OPTIMIZATION: If API and Worker URLs are the same, share the instance
  if (apiRedisUrl === workerRedisUrl && globalForRedis.redisWorker) {
    console.log('[Redis:API] Sharing instance with Worker client');
    return globalForRedis.redisWorker;
  }

  const client = createRedisClient(
    { 
      ...buildRedisOptions(apiRedisUrl),
      enableReadyCheck: true 
    },
    'API'
  );
  if (process.env.NODE_ENV !== 'production') {
    globalForRedis.redisApi = client;
  }
  return client;
});

// REDIS B: Workers + BullMQ queues (Uses Worker Redis instance)
export const redisWorker = createLazyRedisClient('Worker', () => {
  if (globalForRedis.redisWorker) return globalForRedis.redisWorker;

  // OPTIMIZATION: If API and Worker URLs are the same, share the instance
  if (workerRedisUrl === apiRedisUrl && globalForRedis.redisApi) {
    console.log('[Redis:Worker] Sharing instance with API client');
    return globalForRedis.redisApi;
  }

  const client = createRedisClient(
    { 
      ...buildRedisOptions(workerRedisUrl),
      maxRetriesPerRequest: null, // REQUIRED for BullMQ
      enableReadyCheck: false // Faster connection for workers
    },
    'Worker'
  );
  if (process.env.NODE_ENV !== 'production') {
    globalForRedis.redisWorker = client;
  }
  return client;
});

// REMOVED schedulerRedis to save connections. Use redisWorker instead.
export const schedulerRedis = redisWorker;

// Compatibility aliases
export const redis = redisApi;
export const redisApiClient = redisApi;
export const redisWorkerClient = redisWorker;

/**
 * Connection options for BullMQ (uses Worker Redis).
 */
export const redisConnection: RedisOptions = {
  ...buildRedisOptions(workerRedisUrl),
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
};

/**
 * Audit Redis connection usage and health.
 */
export async function getConnectionStats() {
  try {
    const info = await redisWorker.info('clients');
    const connectedClients = info.split('\n')
      .find(line => line.startsWith('connected_clients:'))
      ?.split(':')[1].trim();
    
    return {
      connected_clients: parseInt(connectedClients || '0', 10),
      process_pid: process.pid,
      api_status: redisApi.status,
      worker_status: redisWorker.status,
    };
  } catch (err) {
    console.error('[Redis:Stats] Failed to retrieve connection stats:', err);
    return null;
  }
}

/**
 * Check if Redis is currently connected and responsive.
 */
export function isRedisAvailable(client: Redis = redisApi): boolean {
  return client.status === 'ready';
}

/**
 * Alias for isRedisAvailable - checks if Redis API client is connected.
 */
export function isRedisConnected(): boolean {
  return redisApi.status === 'ready';
}

/**
 * Wait for Redis to be ready (with timeout).
 * Supports both (client, timeout) and (timeout) signatures for robustness.
 */
export async function waitForRedis(clientOrTimeout: any = redisApi, timeoutMs?: number): Promise<boolean> {
  let client: Redis;
  let timeout: number;

  // Handle (timeout) signature
  if (typeof clientOrTimeout === 'number') {
    client = redisApi;
    timeout = clientOrTimeout;
  } else {
    // Handle (client, timeout) signature
    client = clientOrTimeout || redisApi;
    timeout = timeoutMs ?? 3000;
  }

  // Final safety check to ensure we have a valid client with status/once
  if (!client || typeof client.once !== 'function' || typeof client.on !== 'function' || typeof client.off !== 'function') {
    return client?.status === 'ready';
  }

  if (client.status === 'ready') return true;
  if (client.status === 'end' || client.status === 'close') return false;
  
  // If lazyConnect is on and status is wait, trigger connection
  if (client.status === 'wait') {
    client.connect().catch((err) => {
      console.warn('[Redis] Lazy connect failed:', err instanceof Error ? err.message : err);
    });
  }
  
    return new Promise((resolve) => {
      let resolved = false;

      const cleanup = () => {
        if (typeof client.off === 'function') {
          client.off('ready', onReady);
          client.off('error', onError);
        }
      };

      const timer = setTimeout(() => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(false);
      }, timeout);

      const onReady = () => { 
        if (resolved) return;
        resolved = true;
        clearTimeout(timer); 
        cleanup();
        resolve(true); 
      };
      
      const onError = () => { 
        if (resolved) return;
        resolved = true;
        clearTimeout(timer); 
        cleanup();
        resolve(false); 
      };

      try {
        client.once('ready', onReady);
        client.once('error', onError);
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          cleanup();
          resolve(false);
        }
      }
    });
}

/**
 * Check if workers are online (status stored in API Redis).
 */
export async function areWorkersOnline(): Promise<boolean> {
  const redisReady = await waitForRedis(redisApi, 3000);
  if (!redisReady) return false;
  
  try {
    const heartbeat = await redisApi.get(`${REDIS_KEY_PREFIX}workers:heartbeat`);
    if (!heartbeat) return false;
    
    const data = JSON.parse(heartbeat);
    const age = Date.now() - data.timestamp;
    return age < 15000;
  } catch (err) {
    console.error('[Redis] Error checking worker heartbeat:', err);
    return false;
  }
}

/**
 * Set worker heartbeat (stored in API Redis).
 */
export async function setWorkerHeartbeat(healthData?: any): Promise<void> {
  try {
    const payload = {
      timestamp: Date.now(),
      health: healthData || { status: 'healthy' },
      pid: process.pid,
    };
    await redisApi.set(`${REDIS_KEY_PREFIX}workers:heartbeat`, JSON.stringify(payload), 'EX', 10);
  } catch (err) {
    console.error('[Redis] Error setting worker heartbeat:', err);
    throw err;
  }
}

/**
 * Distributed lock using Worker Redis.
 */
export async function withLock<T>(
  lockKey: string,
  ttlMs: number,
  fn: () => Promise<T>
): Promise<T> {
  const fullLockKey = `${REDIS_KEY_PREFIX}lock:${lockKey}`;
  const lockValue = Math.random().toString(36).slice(2);
  if (!redisWorker || typeof redisWorker.set !== 'function') {
    throw new Error(`Redis worker client not ready for lock: ${lockKey}`);
  }
  const acquired = await redisWorker.set(fullLockKey, lockValue, 'PX', ttlMs, 'NX');
  
  if (!acquired) throw new Error(`Failed to acquire lock: ${lockKey}`);
  
  try {
    return await fn();
  } finally {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    await redisWorker.eval(script, 1, fullLockKey, lockValue);
  }
}

/**
 * Safely disconnects from both Redis clients.
 */
export async function disconnectRedis(): Promise<void> {
  const disconnect = async (client: Redis, name: string) => {
    if (client.status === 'end') return;
    try {
      await client.quit();
      console.log(`[Redis:${name}] Disconnected`);
    } catch (err) {
      client.disconnect();
    }
  };

  await Promise.all([
    disconnect(redisApi, 'API'),
    disconnect(redisWorker, 'Worker')
  ]);
}

export const redisMode = isSentinelMode ? 'sentinel' : 'single-node';
