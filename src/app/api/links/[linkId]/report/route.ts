/**
 * Link Report API
 * 
 * POST /api/links/:linkId/report - Report a link (auth required)
 * 
 * Features:
 * - Reputation-weighted reporting (trust-based weight)
 * - Auto-hide when report score >= threshold
 * - Rate limiting to prevent Sybil attacks
 * - Audit logging
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS } from '@/lib/prisma';
import {
  ApiError,
  ErrorCodes,
  handleApiError,
  checkRateLimit,
  getRateLimitInfo,
  validateOrigin,
  validateContentType,
  validateJsonSize,
  sanitizeInput,
  getClientIp,
  logSecurityEvent,
  validateUUID,
} from '@/lib/api-utils';
import {
  MAX_REPORTS_PER_USER_PER_DAY,
  AUTO_HIDE_REPORT_THRESHOLD,
} from '@/lib/chapter-links/constants';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Report weight thresholds based on account status
const REPORT_WEIGHTS = {
  NEW_USER: 0,      // New users (<7 days or <100 XP) have 0 weight
  DEFAULT: 1,       // Normal users
  TRUSTED: 2,       // High trust score (>= 0.9)
  MODERATOR: 5,     // Moderators/admins
};

// Hide threshold - link is auto-hidden when report score reaches this
const HIDE_THRESHOLD = AUTO_HIDE_REPORT_THRESHOLD || 10;

// =============================================================================
// VALIDATION SCHEMA
// =============================================================================

const ReportSchema = z.object({
  reason: z.enum(['broken', 'malicious', 'spam', 'copyright', 'other']),
  details: z.string()
    .max(1000, 'Details must be under 1000 characters')
    .optional()
    .transform(val => val ? sanitizeInput(val, 1000) : undefined),
});

// =============================================================================
// HELPERS
// =============================================================================

function isNewUser(user: { created_at?: string | Date; xp?: number }): boolean {
  const createdAt = user.created_at ? new Date(user.created_at) : new Date();
  const accountAge = Date.now() - createdAt.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  
  return accountAge < sevenDays || (user.xp ?? 0) < 100;
}

function calculateReportWeight(
  dbUser: { xp: number; level: number; trust_score: number; created_at: Date },
  isModerator: boolean
): number {
  // Moderators get max weight
  if (isModerator) {
    return REPORT_WEIGHTS.MODERATOR;
  }

  // New users get 0 weight (their reports are logged but don't auto-hide)
  if (isNewUser({ created_at: dbUser.created_at, xp: dbUser.xp })) {
    return REPORT_WEIGHTS.NEW_USER;
  }

  // High trust users get bonus weight
  if (dbUser.trust_score >= 0.9) {
    return REPORT_WEIGHTS.TRUSTED;
  }

  return REPORT_WEIGHTS.DEFAULT;
}

// =============================================================================
// POST - Report a link
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
) {
  try {
    const { linkId } = await params;
    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent');

    // --- 1. AUTH CHECK ---
    const supabase = await createClient();
    const { data: { user: authUser }, error: authError } = await supabase.auth.getUser();

    if (authError || !authUser) {
      throw new ApiError('Authentication required', 401, ErrorCodes.UNAUTHORIZED);
    }

    // --- 2. CSRF PROTECTION ---
    validateOrigin(request);

    // --- 3. CONTENT VALIDATION ---
    validateContentType(request);
    await validateJsonSize(request, 5 * 1024); // 5KB max

    // --- 4. VALIDATE PATH PARAMS ---
    validateUUID(linkId, 'linkId');

    // --- 5. FETCH USER DATA ---
    const dbUser = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        xp: true,
        level: true,
        trust_score: true,
        created_at: true,
      },
    });

    if (!dbUser) {
      throw new ApiError('User not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Check if user is a moderator
    const isModerator = authUser.app_metadata?.role === 'admin' || 
                        authUser.app_metadata?.role === 'moderator';

    // --- 6. RATE LIMITING ---
    // Daily report limit
    const rateLimitKey = `link-report:${authUser.id}`;
    const rateLimitInfo = await getRateLimitInfo(
      rateLimitKey,
      MAX_REPORTS_PER_USER_PER_DAY,
      24 * 60 * 60 * 1000 // 24 hours
    );

    if (!rateLimitInfo.allowed) {
      await logSecurityEvent({
        userId: authUser.id,
        event: 'LINK_REPORT_RATE_LIMITED',
        status: 'failure',
        ipAddress: ip,
        userAgent,
        metadata: { link_id: linkId },
      });

      throw new ApiError(
        `You can only submit ${MAX_REPORTS_PER_USER_PER_DAY} reports per day.`,
        429,
        ErrorCodes.RATE_LIMITED
      );
    }

    // --- 7. PARSE AND VALIDATE BODY ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const parsed = ReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        parsed.error.errors[0].message,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { reason, details } = parsed.data;

    // --- 8. CHECK LINK EXISTS AND IS REPORTABLE ---
    const link = await prisma.chapterLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        status: true,
        deleted_at: true,
        submitted_by: true,
        last_report_score: true,
        url: true,
        series_id: true,
        chapter_id: true,
      },
    });

    if (!link || link.deleted_at) {
      throw new ApiError('Link not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Can only report visible/unverified links
    if (link.status !== 'visible' && link.status !== 'unverified') {
      throw new ApiError('Cannot report hidden or removed links', 400, ErrorCodes.BAD_REQUEST);
    }

    // Cannot report own submission
    if (link.submitted_by === authUser.id) {
      throw new ApiError('Cannot report your own submission', 400, ErrorCodes.BAD_REQUEST);
    }

    // --- 9. CHECK FOR EXISTING REPORT ---
    const existingReport = await prisma.chapterLinkReport.findUnique({
      where: {
        chapter_link_id_reporter_id: {
          chapter_link_id: linkId,
          reporter_id: authUser.id,
        },
      },
    });

    if (existingReport) {
      throw new ApiError('You have already reported this link', 409, ErrorCodes.CONFLICT);
    }

    // --- 10. CALCULATE REPORT WEIGHT ---
    const weight = calculateReportWeight(dbUser, isModerator);

    // --- 11. TRANSACTIONAL REPORT INSERT ---
    const result = await prisma.$transaction(async (tx) => {
      // Create report
      const report = await tx.chapterLinkReport.create({
        data: {
          chapter_link_id: linkId,
          reporter_id: authUser.id,
          reason,
          details,
          weight,
        },
      });

      // Update link's report score
      const newReportScore = link.last_report_score + weight;
      
      // Check if should auto-hide
      const shouldHide = newReportScore >= HIDE_THRESHOLD && link.status !== 'hidden';

      const updatedLink = await tx.chapterLink.update({
        where: { id: linkId },
        data: {
          last_report_score: newReportScore,
          ...(shouldHide ? { status: 'hidden' } : {}),
        },
        select: {
          last_report_score: true,
          status: true,
        },
      });

      // Log audit
      await tx.linkSubmissionAudit.create({
        data: {
          chapter_link_id: linkId,
          action: shouldHide ? 'report_auto_hide' : 'report',
          actor_id: authUser.id,
          actor_ip: ip,
          payload: {
            reason,
            details: details || null,
            weight,
            old_score: link.last_report_score,
            new_score: newReportScore,
            auto_hidden: shouldHide,
            reporter_level: dbUser.level,
            reporter_trust: dbUser.trust_score,
            is_moderator: isModerator,
          },
        },
      });

      return {
        reportId: report.id,
        newScore: updatedLink.last_report_score,
        wasAutoHidden: shouldHide,
        status: updatedLink.status,
      };
    }, DEFAULT_TX_OPTIONS);

    // --- 12. LOG SECURITY EVENT ---
    await logSecurityEvent({
      userId: authUser.id,
      event: result.wasAutoHidden ? 'LINK_REPORT_AUTO_HIDE' : 'LINK_REPORT',
      status: 'success',
      ipAddress: ip,
      userAgent,
      metadata: {
        link_id: linkId,
        report_id: result.reportId,
        reason,
        weight,
        new_score: result.newScore,
        auto_hidden: result.wasAutoHidden,
      },
    });

    // --- 13. RETURN RESPONSE ---
    return NextResponse.json({
      success: true,
      report_id: result.reportId,
      weight,
      new_report_score: result.newScore,
      link_status: result.status,
      message: result.wasAutoHidden
        ? 'Report submitted. Link has been hidden pending review.'
        : weight === 0
          ? 'Report recorded for review. New accounts have reduced weight.'
          : 'Report submitted successfully.',
    }, { status: 201 });

  } catch (error) {
    return handleApiError(error);
  }
}
