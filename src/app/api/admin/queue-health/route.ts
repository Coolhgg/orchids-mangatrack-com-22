import { NextRequest, NextResponse } from 'next/server';
import { 
  syncSourceQueue, 
  chapterIngestQueue, 
  notificationDeliveryQueue,
  notificationDeliveryPremiumQueue,
  feedFanoutQueue,
  gapRecoveryQueue,
} from '@/lib/queues';
import { CrawlGatekeeper } from '@/lib/crawl-gatekeeper';
import { sourceRateLimiter } from '@/lib/rate-limiter';
import { QUEUE_THRESHOLDS, type SystemStatus } from '@/lib/job-config';
import { validateInternalToken, handleApiError, ApiError, ErrorCodes } from '@/lib/api-utils';
import { createClient } from '@/lib/supabase/server';

interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
}

interface RateLimitStatus {
  source: string;
  tokens: number;
  maxTokens: number;
  requestsPerSecond: number;
}

interface QueueHealthReport {
  status: SystemStatus;
  queueDepth: number;
  thresholds: typeof QUEUE_THRESHOLDS;
  queues: QueueStats[];
  rateLimits: RateLimitStatus[];
  timestamp: string;
}

const KNOWN_SOURCES = ['mangadex', 'mangapark', 'mangasee', 'bato', 'manganato', 'mangakakalot', 'hiperdex'];

export async function GET(request: NextRequest): Promise<NextResponse<QueueHealthReport | any>> {
  try {
    // 1. Try internal token validation first (for monitoring tools)
    try {
      validateInternalToken(request);
    } catch (authError) {
      // 2. If internal token fails, check for admin session
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        throw new ApiError("Unauthorized access to admin metrics", 401, ErrorCodes.UNAUTHORIZED);
      }

      // SECURITY FIX: Strictly use app_metadata for role checks
      const isAdmin = user.app_metadata?.role === 'admin';
      
      if (!isAdmin) {
        throw new ApiError("Forbidden: Admin privileges required", 403, ErrorCodes.FORBIDDEN);
      }
    }

    const health = await CrawlGatekeeper.getSystemHealth();
    // ... rest of the code

  const queueList = [
    { queue: syncSourceQueue, name: 'sync-source' },
    { queue: chapterIngestQueue, name: 'chapter-ingest' },
    { queue: notificationDeliveryQueue, name: 'notification-delivery' },
    { queue: notificationDeliveryPremiumQueue, name: 'notification-delivery-premium' },
    { queue: feedFanoutQueue, name: 'feed-fanout' },
    { queue: gapRecoveryQueue, name: 'gap-recovery' },
  ];

  const queues: QueueStats[] = await Promise.all(
    queueList.map(async ({ queue, name }) => {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed', 'completed');
        return {
          name,
          waiting: counts.waiting || 0,
          active: counts.active || 0,
          delayed: counts.delayed || 0,
          failed: counts.failed || 0,
          completed: counts.completed || 0,
        };
      } catch {
        return {
          name,
          waiting: 0,
          active: 0,
          delayed: 0,
          failed: 0,
          completed: 0,
        };
      }
    })
  );

  const rateLimits: RateLimitStatus[] = await Promise.all(
    KNOWN_SOURCES.map(async (source) => {
      try {
        const status = await sourceRateLimiter.getStatus(source);
        return {
          source,
          tokens: status.tokens,
          maxTokens: status.maxTokens,
          requestsPerSecond: status.requestsPerSecond,
        };
      } catch {
        return {
          source,
          tokens: 0,
          maxTokens: 0,
          requestsPerSecond: 0,
        };
      }
    })
  );

    return NextResponse.json({
      status: health.status,
      queueDepth: health.queueDepth,
      thresholds: health.thresholds,
      queues,
      rateLimits,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}
