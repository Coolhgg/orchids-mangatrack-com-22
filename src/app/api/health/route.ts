import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redis, waitForRedis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { 
  performReadinessChecks,
  type HealthStatus,
} from '@/lib/bug-fixes/v5-audit-bugs-51-80';
import {
  checkQueueHealth,
  QUEUE_HEALTH_THRESHOLDS,
  type QueueHealthStatus,
} from '@/lib/bug-fixes/v5-audit-bugs-81-100';
import { checkDLQHealth } from '@/lib/monitoring';
import { getSearchCacheStats } from '@/lib/search-cache';

// Import queues for health checks
import { syncSourceQueue, seriesResolutionQueue, refreshCoverQueue } from '@/lib/queues';

export const dynamic = 'force-dynamic';

/**
 * Health Check Endpoint
 * 
 * Bug 73 Fix: Reports both liveness AND readiness
 * Bug 97 Fix: Includes queue backlog in health assessment
 * 
 * - Liveness: Is the process running?
 * - Readiness: Can the service process requests?
 * - Queue Health: Is the job backlog under control?
 * - Search Cache: Hit/miss rates for search caching
 * 
 * Returns:
 * - 200: Healthy and ready to process requests
 * - 503: Unhealthy or not ready
 * - 206: Degraded (some services down but still functional)
 */
export async function GET() {
  const startTime = Date.now();
  
  // Perform comprehensive readiness checks (Bug 73)
  const healthStatus: HealthStatus = await performReadinessChecks({
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    redis: async () => {
      const isRedisUp = await waitForRedis(redis, 2000);
      if (!isRedisUp) {
        throw new Error('Redis connection timeout');
      }
      // Also verify we can actually write/read
      const testKey = `health_check_${Date.now()}`;
      await redis.set(testKey, '1', 'EX', 5);
      await redis.del(testKey);
    },
    queues: async () => {
      // Optional: Check if BullMQ queues are accessible
      // This is handled by the Redis check in most cases
    }
  });

  // Bug 97: Check queue health including backlog
  let queueHealthStatuses: QueueHealthStatus[] = [];
  let queueOverallStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  
  try {
    const queues = [
      { queue: syncSourceQueue, name: 'sync-source' },
      { queue: seriesResolutionQueue, name: 'series-resolution' },
      { queue: refreshCoverQueue, name: 'cover-refresh' },
    ];
    
    for (const { queue, name } of queues) {
      try {
        const queueHealth = await checkQueueHealth({
          name,
          getJobCounts: () => queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed') as Promise<{ waiting: number; active: number; completed: number; failed: number; delayed: number }>,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          getJobs: (types, start, end) => queue.getJobs(types as any, start, end),
        });
        
        queueHealthStatuses.push(queueHealth);
        
        // Update overall queue status (worst case wins)
        if (queueHealth.status === 'critical') {
          queueOverallStatus = 'critical';
        } else if (queueHealth.status === 'warning' && queueOverallStatus !== 'critical') {
          queueOverallStatus = 'warning';
        }
      } catch (err) {
        // Individual queue check failed, but don't crash the health check
        queueHealthStatuses.push({
          name,
          status: 'warning',
          waiting: 0,
          active: 0,
          completed: 0,
          failed: 0,
          delayed: 0,
          failedRatio: 0,
          hasStaleJobs: false,
          issues: [`Failed to check queue: ${err instanceof Error ? err.message : 'Unknown error'}`],
        });
        if (queueOverallStatus === 'healthy') {
          queueOverallStatus = 'warning';
        }
      }
    }
  } catch (queueError) {
    logger.warn('Failed to check queue health', { error: queueError instanceof Error ? queueError.message : String(queueError) });
  }

  // Check DLQ/WorkerFailure count and trigger alerts if needed
  let dlqCount = 0;
  let dlqStatus: 'healthy' | 'warning' | 'critical' = 'healthy';
  try {
    dlqCount = await prisma.workerFailure.count({
      where: { resolved_at: null },
    });
    
    // Trigger DLQ alerting (async, non-blocking)
    checkDLQHealth(dlqCount).catch(err => {
      logger.warn('DLQ health check alert failed', { error: err });
    });

    // Update status based on DLQ count
    if (dlqCount >= 500) {
      dlqStatus = 'critical';
    } else if (dlqCount >= 200) {
      dlqStatus = 'critical';
    } else if (dlqCount >= 50) {
      dlqStatus = 'warning';
    }
  } catch (dlqError) {
    logger.warn('Failed to check DLQ count', { error: dlqError instanceof Error ? dlqError.message : String(dlqError) });
  }

  // Search cache stats monitoring (for verifying cache key fix)
  let searchCacheStats = { hits: 0, misses: 0, hitRate: 0, dedupSaves: 0, externalDedupSaves: 0 };
  try {
    searchCacheStats = await getSearchCacheStats();
  } catch (cacheError) {
    logger.warn('Failed to get search cache stats', { error: cacheError instanceof Error ? cacheError.message : String(cacheError) });
  }

  // Calculate overall status (combine service health, queue health, and DLQ)
  let overallStatus = healthStatus.status;
  if (queueOverallStatus === 'critical' || dlqStatus === 'critical') {
    overallStatus = 'unhealthy';
  } else if ((queueOverallStatus === 'warning' || dlqStatus === 'warning') && overallStatus === 'healthy') {
    overallStatus = 'degraded';
  }

  // Add additional metadata
  const response = {
    ...healthStatus,
    status: overallStatus, // Override with combined status
    // Legacy format for backwards compatibility
    services: {
      database: healthStatus.checks.find(c => c.name === 'database')?.healthy ? 'up' : 'down',
      redis: healthStatus.checks.find(c => c.name === 'redis')?.healthy ? 'up' : 'down',
    },
    // Bug 97: Queue health details
    queues: {
      status: queueOverallStatus,
      details: queueHealthStatuses.map(q => ({
        name: q.name,
        status: q.status,
        backlog: q.waiting + q.delayed,
        active: q.active,
        failed: q.failed,
        failedRatio: Math.round(q.failedRatio * 100) + '%',
        issues: q.issues,
      })),
      thresholds: {
        warningBacklog: QUEUE_HEALTH_THRESHOLDS.WARNING_BACKLOG,
        criticalBacklog: QUEUE_HEALTH_THRESHOLDS.CRITICAL_BACKLOG,
      },
    },
    // DLQ (Dead Letter Queue) monitoring
    dlq: {
      status: dlqStatus,
      unresolvedCount: dlqCount,
      thresholds: { warning: 50, error: 200, critical: 500 },
    },
    // Search cache stats (for monitoring cache key fix effectiveness)
    searchCache: {
      hits: searchCacheStats.hits,
      misses: searchCacheStats.misses,
      hitRate: `${searchCacheStats.hitRate.toFixed(1)}%`,
      dedupSaves: searchCacheStats.dedupSaves,
      externalDedupSaves: searchCacheStats.externalDedupSaves,
    },
    responseTimeMs: Date.now() - startTime,
    // Memory stats for debugging
    memory: {
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rss: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };

  // Log unhealthy checks for monitoring
  for (const check of healthStatus.checks) {
    if (!check.healthy) {
      logger.error(`Health check failed: ${check.name}`, { error: check.error });
    }
  }
  
  // Log queue issues
  for (const queue of queueHealthStatuses) {
    if (queue.issues.length > 0) {
      logger.warn(`Queue health issues: ${queue.name}`, { issues: queue.issues });
    }
  }

  // Determine HTTP status code
  let httpStatus: number;
  switch (overallStatus) {
    case 'healthy':
      httpStatus = 200;
      break;
    case 'degraded':
      httpStatus = 206; // Partial Content - service is degraded
      break;
    case 'unhealthy':
    default:
      httpStatus = 503; // Service Unavailable
      break;
  }

  return NextResponse.json(response, {
    status: httpStatus,
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate',
      'X-Health-Status': overallStatus,
      'X-Can-Process-Jobs': String(healthStatus.canProcessJobs && queueOverallStatus !== 'critical'),
      'X-Queue-Status': queueOverallStatus,
      'X-DLQ-Status': dlqStatus,
      'X-DLQ-Count': String(dlqCount),
      'X-Search-Cache-Hit-Rate': `${searchCacheStats.hitRate.toFixed(1)}%`,
    },
  });
}
