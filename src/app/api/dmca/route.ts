/**
 * DMCA Takedown Request API
 * 
 * POST /api/dmca - Submit a DMCA takedown request
 * 
 * Requirements:
 * - Required fields: requester_contact, target_url or target_link_id, claim_details
 * - On valid request targeting a link:
 *   - Set link.status='removed', link.deleted_at=now() (soft delete)
 *   - Log to audit trail
 *   - Create DMCA request record
 * - Rate limited to prevent abuse
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { z } from 'zod';
import { validateOrigin, withErrorHandling, ApiError, ErrorCodes, getClientIp, checkRateLimit, validateContentType, validateJsonSize, logSecurityEvent } from '@/lib/api-utils';

// Validation schema for DMCA request
const dmcaRequestSchema = z.object({
  requester_contact: z.string().email({ message: 'Valid email address required' }),
  requester_name: z.string().min(1, 'Full name is required').max(200),
  requester_company: z.string().max(200).optional(),
  target_url: z.string().url('A valid URL is required').optional(),
  target_link_id: z.string().uuid('Invalid link ID format').optional(),
  work_title: z.string().min(1, 'Title of copyrighted work is required').max(500),
  claim_details: z.string().min(20, 'Please provide detailed claim information (min 20 characters)').max(5000),
  // DMCA compliance fields
  good_faith_statement: z.boolean().refine(val => val === true, {
    message: 'You must confirm good faith belief',
  }),
  accuracy_statement: z.boolean().refine(val => val === true, {
    message: 'You must confirm the accuracy of your information',
  }),
}).refine(data => data.target_url || data.target_link_id, {
  message: 'Either target_url or target_link_id must be provided',
  path: ['target_url'],
});

export async function POST(request: NextRequest) {
  return withErrorHandling(async () => {
    validateOrigin(request);
    validateContentType(request);
    await validateJsonSize(request);
    
    // Get IP for rate limiting and audit
    const ip = getClientIp(request);

    // Rate limit check: 5 requests per hour (3600000ms)
    if (!await checkRateLimit(`dmca-submit:${ip}`, 5, 3600000)) {
      throw new ApiError('Too many requests. Please wait before submitting another DMCA request.', 429, ErrorCodes.RATE_LIMITED);
    }

    // Parse and validate request body
    const body = await request.json();
    const validation = dmcaRequestSchema.safeParse(body);
    
    if (!validation.success) {
      // Map Zod errors to field-specific messages for the frontend
      const details: Record<string, string[]> = {};
      validation.error.errors.forEach(err => {
        const path = err.path.join('.');
        if (!details[path]) details[path] = [];
        details[path].push(err.message);
      });

      const error = new ApiError('Validation failed', 400, ErrorCodes.VALIDATION_ERROR);
      (error as any).details = details;
      throw error;
    }

    const data = validation.data;

    // Log security event for the submission attempt
    await logSecurityEvent({
      userId: 'anonymous',
      event: 'dmca_submission',
      status: 'success',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent'),
      metadata: {
        requester_contact: data.requester_contact,
        work_title: data.work_title,
        target_url: data.target_url,
      }
    });

    // Find target link if URL provided (not direct ID)
    let targetLinkId: string | null = data.target_link_id || null;
    let targetLink: { id: string; series_id: string; url: string; submitted_by: string | null } | null = null;

    if (data.target_url && !targetLinkId) {
      // Normalize URL for lookup
      const normalizedUrl = data.target_url.toLowerCase().trim()
        .replace(/^https?:\/\//, '')
        .replace(/\/+$/, '');

      targetLink = await prisma.chapterLink.findFirst({
        where: {
          url_normalized: normalizedUrl,
          deleted_at: null,
        },
        select: {
          id: true,
          series_id: true,
          url: true,
          submitted_by: true,
        },
      });

      if (targetLink) {
        targetLinkId = targetLink.id;
      }
    } else if (targetLinkId) {
      targetLink = await prisma.chapterLink.findUnique({
        where: { id: targetLinkId },
        select: {
          id: true,
          series_id: true,
          url: true,
          submitted_by: true,
        },
      });
    }

    // Create DMCA request record
    const dmcaRequest = await prisma.dmcaRequest.create({
      data: {
        requester_contact: data.requester_contact,
        requester_name: data.requester_name,
        requester_company: data.requester_company,
        target_url: data.target_url,
        target_link_id: targetLinkId,
        target_series_id: targetLink?.series_id,
        work_title: data.work_title,
        claim_details: data.claim_details,
        status: 'pending',
      },
    });

    // If we found a matching link, immediately remove it (Safe Harbor compliance)
    if (targetLink) {
      await prisma.$transaction(async (tx) => {
        // Soft delete the link
        await tx.chapterLink.update({
          where: { id: targetLink!.id },
          data: {
            status: 'removed',
            deleted_at: new Date(),
          },
        });

        // Create audit log entry (append-only)
        await tx.linkSubmissionAudit.create({
          data: {
            chapter_link_id: targetLink!.id,
            action: 'dmca_remove',
            actor_ip: ip,
            payload: {
              dmca_request_id: dmcaRequest.id,
              requester_contact: data.requester_contact,
              work_title: data.work_title,
              reason: 'DMCA takedown request',
            },
          },
        });
      });

      // Update DMCA request status to processing
      await prisma.dmcaRequest.update({
        where: { id: dmcaRequest.id },
        data: { status: 'processing' },
      });
    }

    return NextResponse.json({
      success: true,
      message: targetLink 
        ? 'DMCA request received and link has been removed pending review.'
        : 'DMCA request received. Our team will review and take appropriate action.',
      request_id: dmcaRequest.id,
      link_removed: !!targetLink,
    }, { status: 201 });
  })
}

// GET endpoint to check status of a DMCA request (for submitters)
export async function GET(request: NextRequest) {
  return withErrorHandling(async () => {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get('id');
    const email = searchParams.get('email');

    if (!requestId || !email) {
      throw new ApiError('Missing required parameters: id and email', 400, ErrorCodes.BAD_REQUEST);
    }

    const dmcaRequest = await prisma.dmcaRequest.findFirst({
      where: {
        id: requestId,
        requester_contact: email,
      },
      select: {
        id: true,
        status: true,
        work_title: true,
        target_url: true,
        created_at: true,
        resolved_at: true,
        resolution_note: true,
      },
    });

    if (!dmcaRequest) {
      throw new ApiError('Request not found or email does not match', 404, ErrorCodes.NOT_FOUND);
    }

    return { request: dmcaRequest };
  })
}
