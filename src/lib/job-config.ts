import { JobsOptions } from 'bullmq';

export type JobPriority = 'P0' | 'P1' | 'P2' | 'P3';

export const JOB_PRIORITIES = {
  P0: 1,  // Tracked series - never dropped
  P1: 2,  // Recently active - cutoff at CRITICAL
  P2: 3,  // Popular/Discover - cutoff at OVERLOADED
  P3: 4,  // Cold/Untracked - cutoff at ELEVATED
} as const;

export const QUEUE_THRESHOLDS = {
  HEALTHY: 2500,
  ELEVATED: 5000,
  OVERLOADED: 10000,
  CRITICAL: 15000,
  MELTDOWN: 20000,
} as const;

export type SystemStatus = 'healthy' | 'elevated' | 'overloaded' | 'critical' | 'meltdown';

export function getSystemStatus(queueDepth: number): SystemStatus {
  if (queueDepth > QUEUE_THRESHOLDS.MELTDOWN) return 'meltdown';
  if (queueDepth > QUEUE_THRESHOLDS.CRITICAL) return 'critical';
  if (queueDepth > QUEUE_THRESHOLDS.OVERLOADED) return 'overloaded';
  if (queueDepth > QUEUE_THRESHOLDS.ELEVATED) return 'elevated';
  return 'healthy';
}

export function isPriorityAllowedAtStatus(priority: JobPriority, status: SystemStatus): boolean {
  switch (status) {
    case 'meltdown':
      return false; // Halt all enqueues
    case 'critical':
      return priority === 'P0'; // Only tracked series
    case 'overloaded':
      return priority === 'P0' || priority === 'P1';
    case 'elevated':
      return priority !== 'P3'; // Skip cold/untracked
    case 'healthy':
      return true;
  }
}

export const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

export const NEGATIVE_CACHE_CONFIG = {
  TTL_MS: 60 * 60 * 1000, // 1 hour
  THRESHOLD: 3, // Skip after 3 consecutive empty results
} as const;

export const BACKOFF_CONFIG = {
  RATE_LIMIT_MS: 60 * 60 * 1000,    // 1 hour
  PROXY_BLOCKED_MS: 2 * 60 * 60 * 1000, // 2 hours
  FORBIDDEN_MS: 4 * 60 * 60 * 1000, // 4 hours (403/Cloudflare)
  SOURCE_DOWN_MS: 6 * 60 * 60 * 1000, // 6 hours
} as const;

export const JOB_TTL_CONFIG: Record<string, JobsOptions> = {
  'sync-source': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 60000 },
    removeOnComplete: { count: 100, age: 3600 },
    removeOnFail: { age: 24 * 3600 },
  },
  'chapter-ingest': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 500, age: 1800 },
    removeOnFail: { age: 24 * 3600 },
  },
  'check-source': {
    attempts: 2,
    backoff: { type: 'exponential', delay: 30000 },
    removeOnComplete: { count: 100, age: 900 },
    removeOnFail: { age: 12 * 3600 },
  },
  'notification-delivery': {
    attempts: 5,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { count: 500, age: 300 },
    removeOnFail: { age: 48 * 3600 },
  },
  'feed-fanout': {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: { count: 100, age: 600 },
    removeOnFail: { age: 12 * 3600 },
  },
} as const;

export interface PriorityMetadata {
  trackerCount: number;
  lastActivity: Date | null;
  isDiscovery: boolean;
}

export function assignJobPriority(
  tier: string,
  reason: string,
  metadata: PriorityMetadata
): JobPriority {
  // P0: User-initiated or tracked series
  if (reason === 'USER_REQUEST' || reason === 'GAP_RECOVERY') return 'P0';
  if (metadata.trackerCount > 0) return 'P0';
  
  // P1: Recently active
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  if (metadata.lastActivity && metadata.lastActivity.getTime() > sevenDaysAgo) return 'P1';
  if (metadata.trackerCount >= 50) return 'P1';
  
  // P2: Discovery/Popular (Tier A/B)
  const normalizedTier = tier?.toUpperCase() || 'C';
  if (normalizedTier === 'A' || normalizedTier === 'B' || metadata.isDiscovery) return 'P2';
  
  // P3: Cold/untracked
  return 'P3';
}
