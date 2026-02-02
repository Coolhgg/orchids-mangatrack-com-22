/**
 * Link Status Moderation API
 * 
 * PATCH /api/links/:linkId/status - Change link status (moderator only)
 * 
 * Features:
 * - Moderator-only access
 * - Status transitions: hidden -> visible, visible -> hidden/removed
 * - DMCA takedown handling for copyright removals
 * - Notification to submitter on removal
 * - Full audit trail
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
  validateOrigin,
  validateContentType,
  validateJsonSize,
  sanitizeInput,
  getClientIp,
  logSecurityEvent,
  validateUUID,
} from '@/lib/api-utils';
import { ChapterLinkStatus } from '@prisma/client';

// =============================================================================
// VALIDATION SCHEMA
// =============================================================================

const StatusUpdateSchema = z.object({
  status: z.enum(['hidden', 'removed', 'visible']),
  reason: z.string()
    .max(500, 'Reason must be under 500 characters')
    .optional()
    .transform(val => val ? sanitizeInput(val, 500) : undefined),
  // DMCA-specific fields (required when status='removed' and reason='copyright')
  dmca_requester: z.string().max(200).optional(),
  dmca_company: z.string().max(200).optional(),
  dmca_contact: z.string().email().optional(),
  dmca_work_title: z.string().max(500).optional(),
  dmca_claim_details: z.string().max(2000).optional(),
});

// =============================================================================
// HELPERS
// =============================================================================

function isModerator(user: { app_metadata?: Record<string, unknown> }): boolean {
  const role = user.app_metadata?.role;
  return role === 'admin' || role === 'moderator';
}

// Allowed status transitions
const VALID_TRANSITIONS: Record<ChapterLinkStatus, ChapterLinkStatus[]> = {
  'unverified': ['visible', 'hidden', 'removed'],
  'visible': ['hidden', 'removed'],
  'hidden': ['visible', 'removed'],
  'removed': ['hidden'], // Removed links can be restored to hidden for review
};

// =============================================================================
// PATCH - Update link status (moderator only)
// =============================================================================

export async function PATCH(
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

    // --- 2. MODERATOR CHECK ---
    if (!isModerator(authUser)) {
      await logSecurityEvent({
        userId: authUser.id,
        event: 'LINK_MOD_UNAUTHORIZED',
        status: 'failure',
        ipAddress: ip,
        userAgent,
        metadata: { link_id: linkId },
      });
      throw new ApiError('Moderator privileges required', 403, ErrorCodes.FORBIDDEN);
    }

    // --- 3. CSRF PROTECTION ---
    validateOrigin(request);

    // --- 4. CONTENT VALIDATION ---
    validateContentType(request);
    await validateJsonSize(request, 10 * 1024); // 10KB max

    // --- 5. VALIDATE PATH PARAMS ---
    validateUUID(linkId, 'linkId');

    // --- 6. RATE LIMITING (even for mods) ---
    if (!await checkRateLimit(`link-mod:${authUser.id}`, 60, 60000)) {
      throw new ApiError('Too many moderation actions. Please wait.', 429, ErrorCodes.RATE_LIMITED);
    }

    // --- 7. PARSE AND VALIDATE BODY ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const parsed = StatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        parsed.error.errors[0].message,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { 
      status: newStatus, 
      reason,
      dmca_requester,
      dmca_company,
      dmca_contact,
      dmca_claim_details,
      dmca_work_title,
    } = parsed.data;

    // --- 8. FETCH LINK ---
    const link = await prisma.chapterLink.findUnique({
      where: { id: linkId },
      include: {
        submitter: {
          select: {
            id: true,
            email: true,
            username: true,
          },
        },
        series: {
          select: {
            id: true,
            title: true,
          },
        },
      },
    });

    if (!link) {
      throw new ApiError('Link not found', 404, ErrorCodes.NOT_FOUND);
    }

    // --- 9. VALIDATE STATUS TRANSITION ---
    const currentStatus = link.status;
    const allowedTransitions = VALID_TRANSITIONS[currentStatus] || [];

    if (!allowedTransitions.includes(newStatus)) {
      throw new ApiError(
        `Cannot change status from '${currentStatus}' to '${newStatus}'`,
        400,
        ErrorCodes.BAD_REQUEST
      );
    }

    // --- 10. SPECIAL HANDLING FOR COPYRIGHT REMOVAL ---
    const isCopyrightRemoval = newStatus === 'removed' && 
      (reason?.toLowerCase().includes('copyright') || reason?.toLowerCase().includes('dmca'));

    // --- 11. TRANSACTIONAL STATUS UPDATE ---
    const result = await prisma.$transaction(async (tx) => {
      // Update link status
      const updateData: Record<string, unknown> = {
        status: newStatus,
      };

      // If removing, set deleted_at
      if (newStatus === 'removed') {
        updateData.deleted_at = new Date();
      } else if (currentStatus === 'removed' && newStatus === 'hidden') {
        // Restoring from removed - clear deleted_at
        updateData.deleted_at = null;
      }

      // If approving (hidden -> visible), record verification
      if (currentStatus === 'hidden' && newStatus === 'visible') {
        updateData.verified_by = authUser.id;
        updateData.verified_at = new Date();
      }

      const updatedLink = await tx.chapterLink.update({
        where: { id: linkId },
        data: updateData,
        select: {
          id: true,
          status: true,
          deleted_at: true,
        },
      });

      // Resolve all pending reports if approving
      if (newStatus === 'visible') {
        await tx.chapterLinkReport.updateMany({
          where: {
            chapter_link_id: linkId,
            resolved_at: null,
          },
          data: {
            resolved_at: new Date(),
            resolution_note: `Link approved by moderator: ${reason || 'No reason provided'}`,
          },
        });
      }

      // Create DMCA record if copyright removal
      let dmcaRequestId: string | null = null;
      if (isCopyrightRemoval) {
        const dmcaRequest = await tx.dmcaRequest.create({
          data: {
            target_link_id: linkId,
            target_series_id: link.series_id,
            requester_name: dmca_requester || null,
            requester_company: dmca_company || null,
            requester_contact: dmca_contact || 'Not provided',
            work_title: dmca_work_title || link.series?.title || null,
            claim_details: dmca_claim_details || reason || 'Copyright takedown',
            target_url: link.url,
            status: 'processed',
            resolved_at: new Date(),
            resolution_note: `Processed by moderator ${authUser.id}`,
            processed_by: authUser.id,
          },
        });
        dmcaRequestId = dmcaRequest.id;
      }

      // Log audit
      await tx.linkSubmissionAudit.create({
        data: {
          chapter_link_id: linkId,
          action: `mod_status_${newStatus}`,
          actor_id: authUser.id,
          actor_ip: ip,
          payload: {
            old_status: currentStatus,
            new_status: newStatus,
            reason: reason || null,
            is_copyright_removal: isCopyrightRemoval,
            dmca_request_id: dmcaRequestId,
            submitter_id: link.submitted_by,
          },
        },
      });

      // Create notification for submitter if removed
      if (newStatus === 'removed' && link.submitted_by) {
        await tx.notification.create({
          data: {
            user_id: link.submitted_by,
            type: 'link_removed',
            title: 'Link Removed',
            message: isCopyrightRemoval
              ? `Your link to "${link.url}" was removed due to a copyright claim.`
              : `Your link to "${link.url}" was removed by a moderator.${reason ? ` Reason: ${reason}` : ''}`,
            metadata: {
              link_id: linkId,
              series_id: link.series_id,
              reason: reason || 'Policy violation',
              is_dmca: isCopyrightRemoval,
            },
          },
        });
      }

      return {
        link: updatedLink,
        dmcaRequestId,
        notifiedSubmitter: newStatus === 'removed' && !!link.submitted_by,
      };
    }, DEFAULT_TX_OPTIONS);

    // --- 12. LOG SECURITY EVENT ---
    await logSecurityEvent({
      userId: authUser.id,
      event: `LINK_MOD_${newStatus.toUpperCase()}`,
      status: 'success',
      ipAddress: ip,
      userAgent,
      metadata: {
        link_id: linkId,
        old_status: currentStatus,
        new_status: newStatus,
        reason,
        is_dmca: isCopyrightRemoval,
        dmca_request_id: result.dmcaRequestId,
      },
    });

    // --- 13. RETURN RESPONSE ---
    return NextResponse.json({
      success: true,
      id: result.link.id,
      status: result.link.status,
      previous_status: currentStatus,
      reason: reason || null,
      is_dmca_removal: isCopyrightRemoval,
      dmca_request_id: result.dmcaRequestId,
      notified_submitter: result.notifiedSubmitter,
      message: newStatus === 'visible' 
        ? 'Link approved and made visible'
        : newStatus === 'hidden'
          ? 'Link hidden pending review'
          : isCopyrightRemoval
            ? 'Link removed due to copyright claim. DMCA request recorded.'
            : 'Link removed',
    });

  } catch (error) {
    return handleApiError(error);
  }
}
