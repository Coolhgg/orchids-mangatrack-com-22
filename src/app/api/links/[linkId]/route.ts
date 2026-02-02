/**
 * Link Detail API
 * 
 * GET /api/links/:linkId - Get link details (public)
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import {
  ApiError,
  ErrorCodes,
  handleApiError,
  checkRateLimit,
  getClientIp,
  htmlEncode,
  validateUUID,
} from '@/lib/api-utils';
import { extractDomain, getSourceTier } from '@/lib/chapter-links';

// =============================================================================
// GET - Get link details
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  try {
    const { linkId } = await params;
    const ip = getClientIp(request);

    // Rate limit
    if (!await checkRateLimit(`link-detail:${ip}`, 60, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    // Validate UUID
    validateUUID(linkId, 'linkId');

    // Get authenticated user (optional)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch link with vote counts
    const link = await prisma.chapterLink.findUnique({
      where: { id: linkId },
      include: {
        _count: {
          select: {
            votes: true,
            reports: true,
          },
        },
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
        chapter: {
          select: {
            id: true,
            chapter_number: true,
            chapter_title: true,
          },
        },
        submitter: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
          },
        },
      },
    });

    if (!link) {
      throw new ApiError('Link not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Check visibility
    // Public can see visible/unverified links
    // Submitter can see their own hidden links
    // Removed links are only visible to mods (handled separately)
    const canView = 
      link.status === 'visible' || 
      link.status === 'unverified' ||
      (user && link.submitted_by === user.id);

    if (!canView) {
      throw new ApiError('Link not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Get user's vote if authenticated
    let userVote: number | null = null;
    let hasReported = false;
    if (user) {
      const [vote, report] = await Promise.all([
        prisma.linkVote.findUnique({
          where: {
            chapter_link_id_user_id: {
              chapter_link_id: linkId,
              user_id: user.id,
            },
          },
          select: { vote: true },
        }),
        prisma.chapterLinkReport.findUnique({
          where: {
            chapter_link_id_reporter_id: {
              chapter_link_id: linkId,
              reporter_id: user.id,
            },
          },
          select: { id: true },
        }),
      ]);
      userVote = vote?.vote ?? null;
      hasReported = !!report;
    }

    const domain = extractDomain(link.url) || 'unknown';

    return NextResponse.json({
      id: link.id,
      url: link.url,
      domain,
      source_name: htmlEncode(link.source_name),
      status: link.status,
      visibility_score: link.visibility_score,
      tier: getSourceTier(domain),
      submitted_at: link.submitted_at.toISOString(),
      is_verified: link.verified_at !== null,
      verified_at: link.verified_at?.toISOString() ?? null,
      series: link.series ? {
        id: link.series.id,
        title: htmlEncode(link.series.title),
        cover_url: link.series.cover_url,
      } : null,
      chapter: link.chapter ? {
        id: link.chapter.id,
        number: link.chapter.chapter_number,
        title: link.chapter.chapter_title ? htmlEncode(link.chapter.chapter_title) : null,
      } : {
        number: link.chapter_number,
        title: null,
      },
      submitter: link.submitter && link.submitted_by !== user?.id ? {
        id: link.submitter.id,
        username: htmlEncode(link.submitter.username),
        avatar_url: link.submitter.avatar_url,
      } : null,
      is_own_submission: user ? link.submitted_by === user.id : false,
      vote_count: link._count.votes,
      report_count: link._count.reports,
      user_vote: userVote,
      has_reported: hasReported,
      metadata: link.metadata,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
