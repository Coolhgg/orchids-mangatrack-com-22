import { z } from 'zod';
import { logger } from '@/lib/logger';

const FeatureFlagsSchema = z.object({
  metadata_retry: z.boolean().default(true),
  resolution_thresholds: z.boolean().default(true),
  memory_guards: z.boolean().default(true),
  response_validation: z.boolean().default(false),
  reconciliation_jobs: z.boolean().default(true),
  source_disable_cleanup: z.boolean().default(true),
  idempotency_checks: z.boolean().default(true),
  soft_delete_filtering: z.boolean().default(true),
  utc_timestamp_enforcement: z.boolean().default(true),
});

export type FeatureFlags = z.infer<typeof FeatureFlagsSchema>;

const DEFAULT_FLAGS: FeatureFlags = {
  metadata_retry: true,
  resolution_thresholds: true,
  memory_guards: true,
  response_validation: false,
  reconciliation_jobs: true,
  source_disable_cleanup: true,
  idempotency_checks: true,
  soft_delete_filtering: true,
  utc_timestamp_enforcement: true,
};

// L5 FIX: TTL-based cache invalidation
let cachedFlags: FeatureFlags | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getFeatureFlags(): FeatureFlags {
  const now = Date.now();
  
  // L5 FIX: Check if cache is valid (not null and within TTL)
  if (cachedFlags && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedFlags;
  }

  try {
    const envFlags = process.env.FEATURE_FLAGS;
    if (envFlags) {
      const parsed = JSON.parse(envFlags);
      cachedFlags = FeatureFlagsSchema.parse({ ...DEFAULT_FLAGS, ...parsed });
    } else {
      cachedFlags = DEFAULT_FLAGS;
    }
    cacheTimestamp = now;
  } catch (err) {
    logger.warn('Failed to parse FEATURE_FLAGS, using defaults', { error: err instanceof Error ? err.message : String(err) });
    cachedFlags = DEFAULT_FLAGS;
    cacheTimestamp = now;
  }

  return cachedFlags;
}

export function isFeatureEnabled(flag: keyof FeatureFlags): boolean {
  return getFeatureFlags()[flag];
}

export function resetFeatureFlags(): void {
  cachedFlags = null;
  cacheTimestamp = 0;
}

export function setFeatureFlag(flag: keyof FeatureFlags, value: boolean): void {
  const flags = getFeatureFlags();
  cachedFlags = { ...flags, [flag]: value };
  cacheTimestamp = Date.now();
}
