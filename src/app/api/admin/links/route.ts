/**
 * Admin Link Moderation API
 * 
 * GET /api/admin/links - List links with filtering (reports, domain, status)
 * PATCH /api/admin/links - Bulk actions (hide, remove, approve)
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
} from '@/lib/api-utils';

// Validation schemas
const bulkActionSchema = z.object({
  link_ids: z.array(z.string().uuid()).min(1).max(50),
  action: z.enum(['approve', 'hide', 'remove', 'restore']),
  reason: z.string().max(500).optional(),
});

// Admin auth check helper
async function requireAdmin(request: NextRequest) {
  const ip = getClientIp(request);
  const ratelimit = await getRateLimitInfo(`admin-links:${ip}`, 60, 60000);
  
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
    const status = searchParams.get('status'); // visible, unverified, hidden, removed
    const domain = searchParams.get('domain');
    const minReports = searchParams.get('min_reports');
    const sortBy = searchParams.get('sort') || 'reports_desc'; // reports_desc, newest, oldest

    // Build where clause
    const where: any = {
      deleted_at: status === 'removed' ? { not: null } : null,
    };
    
    if (status && status !== 'removed') {
      where.status = status;
    }
    
    if (domain) {
      where.url = { contains: domain };
    }
    
    if (minReports) {
      where.last_report_score = { gte: parseInt(minReports, 10) };
    }

    // Build order by
    let orderBy: any = { submitted_at: 'desc' };
    if (sortBy === 'reports_desc') {
      orderBy = { last_report_score: 'desc' };
    } else if (sortBy === 'oldest') {
      orderBy = { submitted_at: 'asc' };
    }

    const [links, total] = await Promise.all([
      prisma.chapterLink.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        include: {
          series: {
            select: { id: true, title: true },
          },
          submitter: {
            select: { id: true, username: true, trust_score: true },
          },
          reports: {
            select: {
              id: true,
              reason: true,
              details: true,
              weight: true,
              created_at: true,
              reporter: {
                select: { id: true, username: true },
              },
            },
            orderBy: { created_at: 'desc' },
            take: 5,
          },
          _count: {
            select: { reports: true, votes: true },
          },
        },
      }),
      prisma.chapterLink.count({ where }),
    ]);

    // Get queue stats
    const queueStats = await prisma.chapterLink.groupBy({
      by: ['status'],
      where: { deleted_at: null },
      _count: true,
    });

    const reportedCount = await prisma.chapterLink.count({
      where: {
        deleted_at: null,
        last_report_score: { gt: 0 },
      },
    });

    return NextResponse.json({
      links: links.map(link => ({
        ...link,
        // Extract domain for display
        domain: new URL(link.url).hostname,
      })),
      stats: {
        byStatus: queueStats.reduce((acc, s) => {
          acc[s.status] = s._count;
          return acc;
        }, {} as Record<string, number>),
        reported: reportedCount,
      },
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
      await validateJsonSize(request, 10 * 1024); // 10KB limit for bulk actions
      const { dbUser } = await requireAdmin(request);

    const body = await request.json();
    const validation = bulkActionSchema.safeParse(body);

    if (!validation.success) {
      throw new ApiError(
        validation.error.errors[0].message,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { link_ids, action, reason } = validation.data;

    // Fetch links to verify they exist
    const links = await prisma.chapterLink.findMany({
      where: { id: { in: link_ids } },
      select: { id: true, status: true, deleted_at: true },
    });

    if (links.length === 0) {
      throw new ApiError("No links found", 404, ErrorCodes.NOT_FOUND);
    }

    const updatedIds: string[] = [];

    await prisma.$transaction(async (tx) => {
      for (const link of links) {
        let newStatus: string | undefined;
        let deletedAt: Date | null | undefined;

        switch (action) {
          case 'approve':
            newStatus = 'visible';
            deletedAt = null;
            break;
          case 'hide':
            newStatus = 'hidden';
            break;
          case 'remove':
            newStatus = 'removed';
            deletedAt = new Date();
            break;
          case 'restore':
            newStatus = 'visible';
            deletedAt = null;
            break;
        }

        await tx.chapterLink.update({
          where: { id: link.id },
          data: {
            status: newStatus as any,
            deleted_at: deletedAt,
          },
        });

        // Clear reports if approving/restoring
        if (action === 'approve' || action === 'restore') {
          await tx.chapterLinkReport.updateMany({
            where: { chapter_link_id: link.id, resolved_at: null },
            data: { resolved_at: new Date(), resolution_note: `Admin ${action}` },
          });

          // Reset report score
          await tx.chapterLink.update({
            where: { id: link.id },
            data: { last_report_score: 0 },
          });
        }

        // Create audit log
        await tx.linkSubmissionAudit.create({
          data: {
            chapter_link_id: link.id,
            action: `admin_${action}`,
            actor_id: dbUser.id,
            payload: {
              previous_status: link.status,
              new_status: newStatus,
              reason,
            },
          },
        });

        updatedIds.push(link.id);
      }
    });

    return NextResponse.json({
      success: true,
      message: `${updatedIds.length} link(s) ${action}d successfully`,
      updated_ids: updatedIds,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
