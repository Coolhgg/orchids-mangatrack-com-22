/**
 * Link Vote API
 * 
 * POST /api/links/:linkId/vote - Vote on a link (auth required)
 * 
 * Features:
 * - Unique vote per user enforced by unique constraint
 * - Atomic visibility_score update in same transaction
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
  validateOrigin,
  validateContentType,
  validateJsonSize,
  getClientIp,
  logSecurityEvent,
  validateUUID,
} from '@/lib/api-utils';

// =============================================================================
// VALIDATION SCHEMA
// =============================================================================

const VoteSchema = z.object({
  vote: z.union([z.literal(1), z.literal(-1)]),
});

// =============================================================================
// POST - Vote on a link
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
    await validateJsonSize(request, 1024); // 1KB max

    // --- 4. VALIDATE PATH PARAMS ---
    validateUUID(linkId, 'linkId');

    // --- 5. RATE LIMITING ---
    // 30 votes per minute per user
    if (!await checkRateLimit(`link-vote:${authUser.id}`, 30, 60000)) {
      throw new ApiError('Too many votes. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    // --- 6. PARSE AND VALIDATE BODY ---
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.BAD_REQUEST);
    }

    const parsed = VoteSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        'Vote must be 1 (upvote) or -1 (downvote)',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { vote } = parsed.data;

    // --- 7. CHECK LINK EXISTS AND IS VOTEABLE ---
    const link = await prisma.chapterLink.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        status: true,
        deleted_at: true,
        submitted_by: true,
      },
    });

    if (!link || link.deleted_at) {
      throw new ApiError('Link not found', 404, ErrorCodes.NOT_FOUND);
    }

    // Can only vote on visible/unverified links
    if (link.status !== 'visible' && link.status !== 'unverified') {
      throw new ApiError('Cannot vote on hidden or removed links', 400, ErrorCodes.BAD_REQUEST);
    }

    // --- 8. TRANSACTIONAL VOTE INSERT/UPDATE ---
    const result = await prisma.$transaction(async (tx) => {
      // Check for existing vote
      const existingVote = await tx.linkVote.findUnique({
        where: {
          chapter_link_id_user_id: {
            chapter_link_id: linkId,
            user_id: authUser.id,
          },
        },
      });

      let scoreDelta = 0;
      let action: 'create' | 'update' | 'remove' = 'create';

      if (existingVote) {
        if (existingVote.vote === vote) {
          // Same vote - remove it (toggle behavior)
          await tx.linkVote.delete({
            where: { id: existingVote.id },
          });
          scoreDelta = -vote; // Removing upvote decreases score, removing downvote increases
          action = 'remove';
        } else {
          // Different vote - update it
          await tx.linkVote.update({
            where: { id: existingVote.id },
            data: { 
              vote,
              updated_at: new Date(),
            },
          });
          // Score change is double (remove old, add new)
          scoreDelta = vote * 2;
          action = 'update';
        }
      } else {
        // New vote
        await tx.linkVote.create({
          data: {
            chapter_link_id: linkId,
            user_id: authUser.id,
            vote,
          },
        });
        scoreDelta = vote;
        action = 'create';
      }

      // Update visibility score atomically
      const updatedLink = await tx.chapterLink.update({
        where: { id: linkId },
        data: {
          visibility_score: { increment: scoreDelta },
        },
        select: {
          visibility_score: true,
        },
      });

      // Log audit
      await tx.linkSubmissionAudit.create({
        data: {
          chapter_link_id: linkId,
          action: `vote_${action}`,
          actor_id: authUser.id,
          actor_ip: ip,
          payload: {
            vote,
            action,
            score_delta: scoreDelta,
            new_score: updatedLink.visibility_score,
          },
        },
      });

      return {
        action,
        newScore: updatedLink.visibility_score,
        userVote: action === 'remove' ? null : vote,
      };
    }, DEFAULT_TX_OPTIONS);

    // --- 9. LOG SECURITY EVENT ---
    await logSecurityEvent({
      userId: authUser.id,
      event: 'LINK_VOTE',
      status: 'success',
      ipAddress: ip,
      userAgent,
      metadata: {
        link_id: linkId,
        vote,
        action: result.action,
      },
    });

    // --- 10. RETURN RESPONSE ---
    return NextResponse.json({
      success: true,
      action: result.action,
      visibility_score: result.newScore,
      user_vote: result.userVote,
      message: result.action === 'remove' 
        ? 'Vote removed' 
        : result.action === 'update'
          ? 'Vote updated'
          : 'Vote recorded',
    });

  } catch (error) {
    return handleApiError(error);
  }
}
