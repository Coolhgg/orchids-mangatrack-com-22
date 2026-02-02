import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { prisma } from "@/lib/prisma"
import { handleApiError, ApiError, ErrorCodes, getClientIp, parsePaginationParams, getRateLimitInfo, validateUUID, validateOrigin, validateContentType, validateJsonSize } from "@/lib/api-utils"
import { z } from "zod"
import * as Queues from "@/lib/queues"

// SECURITY: Schema for validating POST body
const DLQActionSchema = z.object({
  failureId: z.string().uuid("Invalid failure ID format").optional(),
  action: z.enum(['resolve', 'delete', 'retry', 'prune'], { errorMap: () => ({ message: 'Invalid action' }) }),
});

export async function GET(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const ratelimit = await getRateLimitInfo(`admin-dlq:${ip}`, 30, 60000);
    
    if (!ratelimit.allowed) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscription_tier: true }
    })

    if (dbUser?.subscription_tier !== 'admin') {
      throw new ApiError("Forbidden: Admin access required", 403, ErrorCodes.FORBIDDEN)
    }

    const searchParams = request.nextUrl.searchParams;
    const isSummary = searchParams.get('summary') === 'true';

    if (isSummary) {
      // Pattern analysis: Group by error message and queue
      const summary = await prisma.$queryRaw`
        SELECT 
          queue_name, 
          substring(error_message from 1 for 100) as error_pattern,
          count(*)::int as count,
          max(created_at) as last_seen
        FROM worker_failures
        WHERE resolved_at IS NULL
        GROUP BY queue_name, error_pattern
        ORDER BY count DESC
        LIMIT 20
      `;
      return NextResponse.json({ summary });
    }

    const { limit, offset } = parsePaginationParams(searchParams)

    const [failures, total] = await Promise.all([
      prisma.workerFailure.findMany({
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.workerFailure.count()
    ])

    return NextResponse.json({
      failures,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total
      }
    }, {
      headers: {
        'X-RateLimit-Limit': ratelimit.limit.toString(),
        'X-RateLimit-Remaining': ratelimit.remaining.toString(),
        'X-RateLimit-Reset': ratelimit.reset.toString(),
      }
    })
  } catch (error) {
    return handleApiError(error)
  }
}

export async function POST(request: NextRequest) {
  try {
    validateOrigin(request);
    validateContentType(request);
    await validateJsonSize(request, 1024);
    
    const ip = getClientIp(request);
    const ratelimit = await getRateLimitInfo(`admin-dlq-action:${ip}`, 20, 60000);
    
    if (!ratelimit.allowed) {
      throw new ApiError("Too many requests. Please wait a moment.", 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED)
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscription_tier: true }
    })

    if (dbUser?.subscription_tier !== 'admin') {
      throw new ApiError("Forbidden: Admin access required", 403, ErrorCodes.FORBIDDEN)
    }

    let body;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("Invalid JSON body", 400, ErrorCodes.BAD_REQUEST);
    }

    const validatedBody = DLQActionSchema.safeParse(body);
    if (!validatedBody.success) {
      throw new ApiError(validatedBody.error.errors[0].message, 400, ErrorCodes.VALIDATION_ERROR);
    }

    const { failureId, action } = validatedBody.data;

    if (action === 'prune') {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const deleted = await prisma.workerFailure.deleteMany({
        where: {
          OR: [
            { resolved_at: { lt: thirtyDaysAgo } },
            { created_at: { lt: thirtyDaysAgo }, resolved_at: { not: null } }
          ]
        }
      });
      return NextResponse.json({ success: true, count: deleted.count });
    }

    if (!failureId) {
      throw new ApiError("failureId is required for this action", 400, ErrorCodes.BAD_REQUEST);
    }

    validateUUID(failureId, 'failureId');

    if (action === 'resolve') {
      const updated = await prisma.workerFailure.update({
        where: { id: failureId },
        data: { resolved_at: new Date() }
      })
      return NextResponse.json(updated)
    }

    if (action === 'delete') {
      await prisma.workerFailure.delete({
        where: { id: failureId }
      })
      return NextResponse.json({ success: true })
    }

      if (action === 'retry') {
        const failure = await prisma.workerFailure.findUnique({
          where: { id: failureId }
        });

        if (!failure) {
          throw new ApiError("Failure record not found", 404, ErrorCodes.NOT_FOUND);
        }

        // L5 FIX: Check if already resolved (retry deduplication)
        if (failure.resolved_at) {
          throw new ApiError("This failure has already been resolved or retried", 409, ErrorCodes.CONFLICT);
        }

        // Map queue name to queue instance
        const queueName = failure.queue_name;
        // Convert kebab-case to camelCase for the exported queue name
        const camelQueueName = queueName.replace(/-([a-z])/g, (g) => g[1].toUpperCase()) + 'Queue';
        const queue = (Queues as any)[camelQueueName];

        if (!queue || typeof queue.add !== 'function') {
          throw new ApiError(`Queue ${queueName} not found or not retryable`, 400, ErrorCodes.BAD_REQUEST);
        }

        // L5 FIX: Use unique job ID with timestamp to prevent duplicate job IDs
        const retryJobId = `dlq-retry-${failure.job_id}-${Date.now()}`;
        
        // Re-enqueue the job with deduplication key in job options
        await queue.add(retryJobId, failure.payload, {
          jobId: retryJobId,
          removeOnComplete: true,
          removeOnFail: false
        });

        // Mark as resolved since it's being retried
        await prisma.workerFailure.update({
          where: { id: failureId },
          data: { resolved_at: new Date() }
        });

        return NextResponse.json({ success: true, message: `Job re-enqueued to ${queueName}`, jobId: retryJobId });
      }

    throw new ApiError("Invalid action", 400, ErrorCodes.BAD_REQUEST)
  } catch (error) {
    return handleApiError(error)
  }
}
