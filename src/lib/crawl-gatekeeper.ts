import { Queue } from 'bullmq';
import { syncSourceQueue } from './queues';
import { prisma } from './prisma';
import { redis, REDIS_KEY_PREFIX } from './redis';
import {
  QUEUE_THRESHOLDS,
  JOB_PRIORITIES,
  DEDUP_WINDOW_MS,
  getSystemStatus,
  isPriorityAllowedAtStatus,
  assignJobPriority,
  type SystemStatus,
  type JobPriority,
  type PriorityMetadata,
} from './job-config';

export type CrawlReason = 'PERIODIC' | 'DISCOVERY' | 'USER_REQUEST' | 'GAP_RECOVERY';

export interface GatekeeperResponse {
  allowed: boolean;
  reason?: string;
  priority: number;
  jobPriority: JobPriority;
}

export { QUEUE_THRESHOLDS as THRESHOLDS };

export class CrawlGatekeeper {
  static async shouldEnqueue(
    seriesSourceId: string,
    tier: string,
    reason: CrawlReason,
    metadata?: Partial<PriorityMetadata>
  ): Promise<GatekeeperResponse> {
    if (!seriesSourceId) {
      console.warn('[Gatekeeper] Empty seriesSourceId provided');
    }

    const normalizedTier = tier?.toUpperCase() || 'C';
    const queueDepth = await this.getQueueDepth(syncSourceQueue);
    const status = getSystemStatus(queueDepth);

    // Determine job priority
    const fullMetadata: PriorityMetadata = {
      trackerCount: metadata?.trackerCount ?? 0,
      lastActivity: metadata?.lastActivity ?? null,
      isDiscovery: metadata?.isDiscovery ?? reason === 'DISCOVERY',
    };
    const jobPriority = assignJobPriority(normalizedTier, reason, fullMetadata);
    const numericPriority = JOB_PRIORITIES[jobPriority];

    // MELTDOWN: Halt all enqueues
    if (status === 'meltdown') {
      return {
        allowed: false,
        reason: 'System meltdown: halting all enqueues',
        priority: numericPriority,
        jobPriority,
      };
    }

    // Priority-based filtering
    if (!isPriorityAllowedAtStatus(jobPriority, status)) {
      return {
        allowed: false,
        reason: `System ${status}: dropping ${jobPriority} priority jobs`,
        priority: numericPriority,
        jobPriority,
      };
    }

    // Deduplication window check
    const isDuplicate = await this.isDuplicateWithinWindow(seriesSourceId);
    if (isDuplicate && reason === 'PERIODIC') {
      return {
        allowed: false,
        reason: 'Duplicate job within dedup window',
        priority: numericPriority,
        jobPriority,
      };
    }

    // TIER RULES: Tier A is "One-Shot" for full crawls
    if (normalizedTier === 'A' && reason === 'PERIODIC') {
      try {
        const source = await prisma.seriesSource.findUnique({
          where: { id: seriesSourceId },
          select: { last_success_at: true }
        });

        if (source?.last_success_at) {
          return {
            allowed: false,
            reason: 'Tier A is one-shot; discovery/events will trigger updates',
            priority: numericPriority,
            jobPriority,
          };
        }
      } catch (error) {
        console.error('[Gatekeeper] Failed to check Tier A one-shot status:', error);
      }
    }

    // Mark dedup window
    await this.markDedupWindow(seriesSourceId);

    return { allowed: true, priority: numericPriority, jobPriority };
  }

  private static async isDuplicateWithinWindow(seriesSourceId: string): Promise<boolean> {
    const key = `${REDIS_KEY_PREFIX}dedup:${seriesSourceId}`;
    const exists = await redis.get(key);
    return !!exists;
  }

  private static async markDedupWindow(seriesSourceId: string): Promise<void> {
    const key = `${REDIS_KEY_PREFIX}dedup:${seriesSourceId}`;
    await redis.set(key, '1', 'PX', DEDUP_WINDOW_MS);
  }

  private static async getQueueDepth(queue: Queue): Promise<number> {
    try {
      const counts = await queue.getJobCounts('waiting', 'delayed');
      return (counts.waiting || 0) + (counts.delayed || 0);
    } catch (error) {
      console.error('[Gatekeeper] Failed to get queue depth:', error);
      return 0;
    }
  }

  static async enqueueIfAllowed(
    seriesSourceId: string,
    tier: string,
    reason: CrawlReason,
    jobData: Record<string, unknown> = {},
    metadata?: Partial<PriorityMetadata>
  ): Promise<boolean> {
    const decision = await this.shouldEnqueue(seriesSourceId, tier, reason, metadata);

    if (!decision.allowed) {
      console.log(`[Gatekeeper][Skipped] sourceId=${seriesSourceId} tier=${tier} reason=${reason} priority=${decision.jobPriority} msg="${decision.reason}"`);
      return false;
    }

    await syncSourceQueue.add(
      `sync-${seriesSourceId}`,
      { ...jobData, seriesSourceId },
      {
        jobId: `sync-${seriesSourceId}`,
        priority: decision.priority,
        removeOnComplete: true,
      }
    );

    console.log(`[Gatekeeper][Enqueued] sourceId=${seriesSourceId} tier=${tier} reason=${reason} priority=${decision.jobPriority} (${decision.priority})`);
    return true;
  }

  static async getSystemHealth(): Promise<{
    status: SystemStatus;
    queueDepth: number;
    thresholds: typeof QUEUE_THRESHOLDS;
  }> {
    const queueDepth = await this.getQueueDepth(syncSourceQueue);
    const status = getSystemStatus(queueDepth);

    return {
      status,
      queueDepth,
      thresholds: QUEUE_THRESHOLDS,
    };
  }
}
