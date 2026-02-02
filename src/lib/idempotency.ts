import { redis, waitForRedis, REDIS_KEY_PREFIX } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/config/feature-flags';

const IDEMPOTENCY_TTL = 24 * 60 * 60;

export interface IdempotencyResult {
  isDuplicate: boolean;
  previousResult?: unknown;
  key: string;
}

export async function checkIdempotency(
  idempotencyKey: string | null | undefined,
  requestSignature?: string
): Promise<IdempotencyResult> {
  if (!isFeatureEnabled('idempotency_checks')) {
    return { isDuplicate: false, key: '' };
  }

  if (!idempotencyKey) {
    return { isDuplicate: false, key: '' };
  }

  const key = `${REDIS_KEY_PREFIX}idempotency:${idempotencyKey}`;

  const redisReady = await waitForRedis(redis, 500);
  if (!redisReady) {
    logger.warn('Redis not available for idempotency check');
    return { isDuplicate: false, key };
  }

  try {
    const existing = await redis.get(key);
    if (existing) {
      return {
        isDuplicate: true,
        previousResult: JSON.parse(existing),
        key,
      };
    }
    return { isDuplicate: false, key };
  } catch (err) {
    logger.error('Idempotency check failed', { error: err instanceof Error ? err.message : String(err) });
    return { isDuplicate: false, key };
  }
}

export async function storeIdempotencyResult(
  key: string,
  result: unknown
): Promise<void> {
  if (!key || !isFeatureEnabled('idempotency_checks')) return;

  const redisReady = await waitForRedis(redis, 500);
  if (!redisReady) return;

  try {
    await redis.setex(key, IDEMPOTENCY_TTL, JSON.stringify(result));
  } catch (err) {
    logger.error('Failed to store idempotency result', { error: err instanceof Error ? err.message : String(err) });
  }
}

export function extractIdempotencyKey(request: Request): string | null {
  return request.headers.get('x-idempotency-key') || 
         request.headers.get('idempotency-key') ||
         null;
}

export function generateIdempotencyKey(prefix: string, ...parts: string[]): string {
  const uniqueParts = [prefix, ...parts, Date.now().toString(36)];
  return uniqueParts.join(':');
}
