/**
 * Admin DMCA Moderation API
 * 
 * GET /api/admin/dmca - List DMCA requests with filtering
 * PATCH /api/admin/dmca - Update DMCA request status (resolve, reject, reinstate)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { 
  handleApiError, 
  ApiError, 
  ErrorCodes, 
  getClientIp, 
  parsePaginationParams, 
  getRateLimitInfo,
  validateUUID,
  validateOrigin,
  validateContentType,
  validateJsonSize,
} from '@/lib/api-utils';

// Validation schemas
const updateSchema = z.object({
  request_id: z.string().uuid(),
  action: z.enum(['resolve', 'reject', 'reinstate']),
  resolution_note: z.string().max(2000).optional(),
});

// Admin auth check helper
async function requireAdmin(request: NextRequest) {
  const ip = getClientIp(request);
  const ratelimit = await getRateLimitInfo(`admin-dmca:${ip}`, 60, 60000);
  
  if (!ratelimit.allowed) {
    throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED);
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    throw new ApiError("Unauthorized", 401, ErrorCodes.UNAUTHORIZED);
  }

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true, subscription_tier: true },
  });

  if (dbUser?.subscription_tier !== 'admin') {
    throw new ApiError("Forbidden: Admin access required", 403, ErrorCodes.FORBIDDEN);
  }

  return { user, dbUser, ratelimit };
}

export async function GET(request: NextRequest) {
  try {
    const { ratelimit } = await requireAdmin(request);

    const searchParams = request.nextUrl.searchParams;
    const { limit, offset } = parsePaginationParams(searchParams);
    
    // Filter params
    const status = searchParams.get('status'); // pending, processing, resolved, rejected
    const domain = searchParams.get('domain'); // Filter by target URL domain

    // Build where clause
    const where: any = {};
    
    if (status) {
      where.status = status;
    }
    
    if (domain) {
      where.target_url = { contains: domain };
    }

    const [requests, total] = await Promise.all([
      prisma.dmcaRequest.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
        include: {
          ChapterLink: {
            select: {
              id: true,
              url: true,
              source_name: true,
              status: true,
              deleted_at: true,
            },
          },
          Series: {
            select: {
              id: true,
              title: true,
            },
          },
          user: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      }),
      prisma.dmcaRequest.count({ where }),
    ]);

    // Get summary stats
    const stats = await prisma.dmcaRequest.groupBy({
      by: ['status'],
      _count: true,
    });

    const statsSummary = stats.reduce((acc, s) => {
      acc[s.status] = s._count;
      return acc;
    }, {} as Record<string, number>);

    return NextResponse.json({
      requests,
      stats: statsSummary,
      pagination: {
        total,
        limit,
        offset,
        hasMore: offset + limit < total,
      },
    }, {
      headers: {
        'X-RateLimit-Limit': ratelimit.limit.toString(),
        'X-RateLimit-Remaining': ratelimit.remaining.toString(),
        'X-RateLimit-Reset': ratelimit.reset.toString(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

  export async function PATCH(request: NextRequest) {
    try {
      validateOrigin(request);
      validateContentType(request);
      await validateJsonSize(request, 10 * 1024); // 10KB limit for DMCA updates
      const { dbUser } = await requireAdmin(request);

    const body = await request.json();
    const validation = updateSchema.safeParse(body);

    if (!validation.success) {
      throw new ApiError(
        validation.error.errors[0].message,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { request_id, action, resolution_note } = validation.data;

    const dmcaRequest = await prisma.dmcaRequest.findUnique({
      where: { id: request_id },
      include: {
        ChapterLink: true,
      },
    });

    if (!dmcaRequest) {
      throw new ApiError("DMCA request not found", 404, ErrorCodes.NOT_FOUND);
    }

    // Handle different actions
    switch (action) {
      case 'resolve': {
        // Mark as resolved, keep link removed
        await prisma.dmcaRequest.update({
          where: { id: request_id },
          data: {
            status: 'resolved',
            resolved_at: new Date(),
            resolution_note,
            processed_by: dbUser.id,
          },
        });

        // Log audit
        if (dmcaRequest.target_link_id) {
          await prisma.linkSubmissionAudit.create({
            data: {
              chapter_link_id: dmcaRequest.target_link_id,
              action: 'dmca_resolved',
              actor_id: dbUser.id,
              payload: {
                dmca_request_id: request_id,
                resolution_note,
              },
            },
          });
        }

        return NextResponse.json({ 
          success: true, 
          message: 'DMCA request resolved. Link remains removed.',
        });
      }

      case 'reject': {
        // Reject invalid claim, optionally reinstate link
        await prisma.$transaction(async (tx) => {
          await tx.dmcaRequest.update({
            where: { id: request_id },
            data: {
              status: 'rejected',
              resolved_at: new Date(),
              resolution_note,
              processed_by: dbUser.id,
            },
          });

          // Reinstate the link if it was removed
          if (dmcaRequest.ChapterLink) {
            await tx.chapterLink.update({
              where: { id: dmcaRequest.ChapterLink.id },
              data: {
                status: 'visible',
                deleted_at: null,
              },
            });

            await tx.linkSubmissionAudit.create({
              data: {
                chapter_link_id: dmcaRequest.ChapterLink.id,
                action: 'dmca_rejected_reinstated',
                actor_id: dbUser.id,
                payload: {
                  dmca_request_id: request_id,
                  resolution_note,
                },
              },
            });
          }
        });

        return NextResponse.json({ 
          success: true, 
          message: 'DMCA request rejected. Link has been reinstated.',
        });
      }

      case 'reinstate': {
        // Reinstate link after counter-notice or dispute resolution
        if (!dmcaRequest.ChapterLink) {
          throw new ApiError(
            "No link associated with this request to reinstate",
            400,
            ErrorCodes.BAD_REQUEST
          );
        }

        await prisma.$transaction(async (tx) => {
          await tx.dmcaRequest.update({
            where: { id: request_id },
            data: {
              resolution_note: resolution_note 
                ? `${dmcaRequest.resolution_note || ''}\n\nReinstatement: ${resolution_note}`
                : dmcaRequest.resolution_note,
              processed_by: dbUser.id,
            },
          });

          await tx.chapterLink.update({
            where: { id: dmcaRequest.ChapterLink!.id },
            data: {
              status: 'visible',
              deleted_at: null,
            },
          });

          await tx.linkSubmissionAudit.create({
            data: {
              chapter_link_id: dmcaRequest.ChapterLink!.id,
              action: 'dmca_reinstated',
              actor_id: dbUser.id,
              payload: {
                dmca_request_id: request_id,
                resolution_note,
                reason: 'Counter-notice or dispute resolution',
              },
            },
          });
        });

        return NextResponse.json({ 
          success: true, 
          message: 'Link has been reinstated following dispute resolution.',
        });
      }

      default:
        throw new ApiError("Invalid action", 400, ErrorCodes.BAD_REQUEST);
    }
  } catch (error) {
    return handleApiError(error);
  }
}
