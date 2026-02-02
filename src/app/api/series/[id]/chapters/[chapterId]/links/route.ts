/**
 * Chapter Links API
 * 
 * POST /api/series/:seriesId/chapters/:chapterId/links
 * 
 * User-submitted chapter links with abuse protection.
 * 
 * Features:
 * - Rate limiting (stricter for new users)
 * - URL normalization and deduplication
 * - Domain blacklist checking
 * - Advisory lock for race condition prevention
 * - Reputation-weighted trust system
 * - Audit logging for Safe Harbor compliance
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
  htmlEncode,
} from '@/lib/api-utils';
import {
  validateUrl,
  normalizeUrl,
  hashUrl,
  extractDomain,
  getSourceName,
  getSourceTier,
  checkBlacklist,
  generateChapterLockKey,
} from '@/lib/chapter-links';
import {
  MAX_VISIBLE_LINKS_PER_CHAPTER,
  OFFICIAL_DOMAINS,
} from '@/lib/chapter-links/constants';
import { ChapterLinkStatus } from '@prisma/client';

// =============================================================================
// CONFIGURATION
// =============================================================================

// Rate limits by user tier
const RATE_LIMITS = {
  // New users: < 7 days OR < 100 XP
  NEW_USER: { max: 5, windowMs: 24 * 60 * 60 * 1000, windowDesc: 'day' }, // 5/day
  // Default users
  DEFAULT: { max: 20, windowMs: 24 * 60 * 60 * 1000, windowDesc: 'day' }, // 20/day
  // IP-based fallback (anonymous or suspicious)
  IP_BASED: { max: 10, windowMs: 60 * 60 * 1000, windowDesc: 'hour' }, // 10/hour
};

// Trust threshold for auto-visible links (vs unverified)
const TRUST_LEVEL_THRESHOLD = 10; // User level >= 10

// Social domains that are not valid chapter links
const SOCIAL_DOMAINS = [
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'twitter.com',
  'x.com',
  'google.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'discord.com',
  'discord.gg',
  'telegram.org',
  't.me',
];

// Extended blacklist (beyond constants.ts)
const EXTENDED_BLACKLIST = [
  { domain: 'bit.ly', reason: 'url_shortener' },
  { domain: 'tinyurl.com', reason: 'url_shortener' },
  { domain: 'goo.gl', reason: 'url_shortener' },
  { domain: 't.co', reason: 'url_shortener' },
  { domain: 'adfly.co', reason: 'ad_link' },
  { domain: 'adf.ly', reason: 'ad_link' },
  { domain: 'linkvertise.com', reason: 'ad_link' },
  { domain: 'ouo.io', reason: 'ad_link' },
  { domain: 'ouo.press', reason: 'ad_link' },
  { domain: 'shorte.st', reason: 'ad_link' },
];

// =============================================================================
// VALIDATION SCHEMA
// =============================================================================

const SubmitLinkSchema = z.object({
  url: z.string()
    .min(10, 'URL is too short')
    .max(2000, 'URL is too long')
    .url('Invalid URL format'),
  source_name: z.string()
    .max(100, 'Source name is too long')
    .optional()
    .transform(val => val ? sanitizeInput(val, 100) : undefined),
  note: z.string()
    .max(500, 'Note is too long')
    .optional()
    .transform(val => val ? sanitizeInput(val, 500) : undefined),
});

// =============================================================================
// HELPERS
// =============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNewUser(user: { created_at?: string | Date; xp?: number }): boolean {
  const createdAt = user.created_at ? new Date(user.created_at) : new Date();
  const accountAge = Date.now() - createdAt.getTime();
  const sevenDays = 7 * 24 * 60 * 60 * 1000;
  
  return accountAge < sevenDays || (user.xp ?? 0) < 100;
}

function isSocialDomain(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  return SOCIAL_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith(`.${d}`));
}

function isOfficialDomain(domain: string): boolean {
  const lowerDomain = domain.toLowerCase();
  return OFFICIAL_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith(`.${d}`));
}

// =============================================================================
// GET - List chapter links
// =============================================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  try {
    const { id: seriesId, chapterId } = await params;
    const ip = getClientIp(request);

    // Rate limit
    if (!await checkRateLimit(`chapter-links-get:${ip}`, 60, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    // Validate UUIDs
    if (!UUID_REGEX.test(seriesId)) {
      throw new ApiError('Invalid series ID format', 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (!UUID_REGEX.test(chapterId)) {
      throw new ApiError('Invalid chapter ID format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // Get authenticated user (optional)
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Fetch links
    const links = await prisma.chapterLink.findMany({
      where: {
        series_id: seriesId,
        chapter_id: chapterId,
        deleted_at: null,
        status: {
          in: ['visible', 'unverified'], // Show both visible and unverified to all
        },
      },
      orderBy: [
        { status: 'asc' }, // visible first
        { visibility_score: 'desc' },
        { submitted_at: 'asc' },
      ],
      take: 10, // Max 10 links returned
    });

    // Get user's votes if authenticated
    let userVotes: Record<string, number> = {};
    if (user) {
      const votes = await prisma.linkVote.findMany({
        where: {
          user_id: user.id,
          chapter_link_id: { in: links.map(l => l.id) },
        },
        select: { chapter_link_id: true, vote: true },
      });
      userVotes = Object.fromEntries(votes.map(v => [v.chapter_link_id, v.vote]));
    }

    // Count visible links for canSubmit check
    const visibleCount = links.filter(l => 
      l.status === 'visible' || l.status === 'unverified'
    ).length;

    return NextResponse.json({
      links: links.map(l => ({
        id: l.id,
        url: l.url,
        domain: extractDomain(l.url) || 'unknown',
        source_name: htmlEncode(l.source_name),
        status: l.status,
        visibility_score: l.visibility_score,
        submitted_at: l.submitted_at.toISOString(),
        is_verified: l.verified_at !== null,
        tier: getSourceTier(extractDomain(l.url) || ''),
        metadata: l.metadata,
      })),
      canSubmit: visibleCount < MAX_VISIBLE_LINKS_PER_CHAPTER,
      userVotes,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

// =============================================================================
// POST - Submit a new chapter link
// =============================================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; chapterId: string }> }
) {
  try {
    const { id: seriesId, chapterId } = await params;
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
    await validateJsonSize(request, 10 * 1024); // 10KB max

    // --- 4. VALIDATE PATH PARAMS ---
    if (!UUID_REGEX.test(seriesId)) {
      throw new ApiError('Invalid series ID format', 400, ErrorCodes.VALIDATION_ERROR);
    }
    if (!UUID_REGEX.test(chapterId)) {
      throw new ApiError('Invalid chapter ID format', 400, ErrorCodes.VALIDATION_ERROR);
    }

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

    // --- 6. RATE LIMITING ---
    const isNew = isNewUser({ created_at: dbUser.created_at, xp: dbUser.xp });
    const rateConfig = isNew ? RATE_LIMITS.NEW_USER : RATE_LIMITS.DEFAULT;
    
    const rateLimitKey = `chapter-link-submit:${authUser.id}`;
    const rateLimitInfo = await getRateLimitInfo(
      rateLimitKey,
      rateConfig.max,
      rateConfig.windowMs
    );

    if (!rateLimitInfo.allowed) {
      // Log suspicious activity
      await logSecurityEvent({
        userId: authUser.id,
        event: 'CHAPTER_LINK_RATE_LIMITED',
        status: 'failure',
        ipAddress: ip,
        userAgent,
        metadata: { 
          remaining: rateLimitInfo.remaining,
          reset: rateLimitInfo.reset,
          isNewUser: isNew,
        },
      });

      const error = new ApiError(
        `Rate limit exceeded. You can submit ${rateConfig.max} links per ${rateConfig.windowDesc}.`,
        429,
        ErrorCodes.RATE_LIMITED
      );
      (error as any).retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000);
      throw error;
    }

    // Also enforce IP-based rate limit
    const ipRateLimitKey = `chapter-link-submit-ip:${ip}`;
    if (!await checkRateLimit(ipRateLimitKey, RATE_LIMITS.IP_BASED.max, RATE_LIMITS.IP_BASED.windowMs)) {
      throw new ApiError(
        'Too many submissions from this IP address.',
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

    const parsed = SubmitLinkSchema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        parsed.error.errors[0].message,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const { url, source_name, note } = parsed.data;

    // --- 8. URL VALIDATION (NO REMOTE FETCH) ---
    const urlValidation = validateUrl(url);
    if (!urlValidation.isValid) {
      throw new ApiError(
        urlValidation.error || 'Invalid URL',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    const domain = urlValidation.domain!;
    const urlNormalized = urlValidation.normalized!;
    const urlHash = urlValidation.hash!;

    // --- 9. DOMAIN BLACKLIST CHECK ---
    // Check against hardcoded extended blacklist
    const blacklistCheck = checkBlacklist(url, EXTENDED_BLACKLIST);
    if (blacklistCheck.isBlocked) {
      throw new ApiError(
        `This domain (${blacklistCheck.domain}) is not allowed: ${blacklistCheck.reason}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // Check against database blacklist
    const dbBlacklist = await prisma.domainBlacklist.findMany({
      where: {
        OR: [
          { expires_at: null },
          { expires_at: { gt: new Date() } },
        ],
      },
      select: { domain: true, reason: true },
    });

    const dbBlacklistCheck = checkBlacklist(url, dbBlacklist);
    if (dbBlacklistCheck.isBlocked) {
      throw new ApiError(
        `This domain is blocked: ${dbBlacklistCheck.reason}`,
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // --- 10. REJECT SOCIAL DOMAINS ---
    if (isSocialDomain(domain)) {
      throw new ApiError(
        'Social media URLs are not valid chapter links',
        400,
        ErrorCodes.VALIDATION_ERROR
      );
    }

    // --- 11. VERIFY SERIES AND CHAPTER EXIST ---
    const [series, chapter] = await Promise.all([
      prisma.series.findUnique({
        where: { id: seriesId },
        select: { id: true, title: true },
      }),
      prisma.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true, chapter_number: true, series_id: true },
      }),
    ]);

    if (!series) {
      throw new ApiError('Series not found', 404, ErrorCodes.NOT_FOUND);
    }
    if (!chapter) {
      throw new ApiError('Chapter not found', 404, ErrorCodes.NOT_FOUND);
    }
    if (chapter.series_id !== seriesId) {
      throw new ApiError('Chapter does not belong to this series', 400, ErrorCodes.BAD_REQUEST);
    }

    // --- 12. DETERMINE INITIAL STATUS ---
    // Trusted users (level >= threshold) get visible status immediately
    // Others get unverified status
    const isTrustedUser = dbUser.level >= TRUST_LEVEL_THRESHOLD;
    const isOfficial = isOfficialDomain(domain);
    
    let initialStatus: ChapterLinkStatus = 'unverified';
    let verifiedBy: string | null = null;
    let verifiedAt: Date | null = null;

    if (isOfficial) {
      // Official domains are auto-verified
      initialStatus = 'visible';
      verifiedBy = 'system';
      verifiedAt = new Date();
    } else if (isTrustedUser) {
      initialStatus = 'visible';
    }

    // --- 13. TRANSACTIONAL INSERT WITH ADVISORY LOCK ---
    const chapterNumber = chapter.chapter_number.toString();
    const lockKey = generateChapterLockKey(seriesId, chapterId);

    const result = await prisma.$transaction(async (tx) => {
      // Acquire advisory lock (released automatically at end of transaction)
      const lockResult = await tx.$queryRaw<{ pg_try_advisory_xact_lock: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) as pg_try_advisory_xact_lock
      `;

      if (!lockResult?.[0]?.pg_try_advisory_xact_lock) {
        throw new ApiError(
          'Unable to process request. Please try again.',
          429,
          ErrorCodes.RATE_LIMITED
        );
      }

      // Check for existing link with same URL hash
      const existingLink = await tx.chapterLink.findFirst({
        where: {
          series_id: seriesId,
          chapter_id: chapterId,
          url_hash: urlHash,
          deleted_at: null,
        },
        include: {
          votes: {
            where: { user_id: authUser.id },
            select: { id: true, vote: true },
          },
        },
      });

      if (existingLink) {
        // Link already exists - add upvote if not already voted
        if (existingLink.votes.length === 0) {
          // Add upvote
          await tx.linkVote.create({
            data: {
              chapter_link_id: existingLink.id,
              user_id: authUser.id,
              vote: 1,
            },
          });

          // Update visibility score
          await tx.chapterLink.update({
            where: { id: existingLink.id },
            data: { visibility_score: { increment: 1 } },
          });

          // Log audit
          await tx.linkSubmissionAudit.create({
            data: {
              chapter_link_id: existingLink.id,
              action: 'vote',
              actor_id: authUser.id,
              actor_ip: ip,
              payload: { vote: 1, reason: 'duplicate_submission' },
            },
          });
        }

        // Return existing link (idempotent)
        return {
          link: existingLink,
          isExisting: true,
          votedNow: existingLink.votes.length === 0,
        };
      }

      // Count current visible/unverified links
      const currentCount = await tx.chapterLink.count({
        where: {
          series_id: seriesId,
          chapter_id: chapterId,
          status: { in: ['visible', 'unverified'] },
          deleted_at: null,
        },
      });

      if (currentCount >= MAX_VISIBLE_LINKS_PER_CHAPTER) {
        throw new ApiError(
          `Maximum of ${MAX_VISIBLE_LINKS_PER_CHAPTER} links per chapter reached`,
          409,
          ErrorCodes.CONFLICT
        );
      }

      // Determine source name
      const finalSourceName = source_name || urlValidation.sourceName || getSourceName(domain);

      // Create the link
      const newLink = await tx.chapterLink.create({
        data: {
          series_id: seriesId,
          chapter_id: chapterId,
          chapter_number: chapterNumber,
          source_name: finalSourceName,
          url: url,
          url_normalized: urlNormalized,
          url_hash: urlHash,
          status: initialStatus,
          visibility_score: 1, // Self-upvote
          submitted_by: authUser.id,
          verified_by: verifiedBy,
          verified_at: verifiedAt,
          metadata: {
            displayName: finalSourceName,
            domain: domain,
            note: note || null,
            tier: urlValidation.tier,
            userAgent: userAgent?.slice(0, 200),
          },
        },
      });

      // Auto-upvote by submitter
      await tx.linkVote.create({
        data: {
          chapter_link_id: newLink.id,
          user_id: authUser.id,
          vote: 1,
        },
      });

      // Create audit record
      await tx.linkSubmissionAudit.create({
        data: {
          chapter_link_id: newLink.id,
          action: 'submit',
          actor_id: authUser.id,
          actor_ip: ip,
          payload: {
            url: url,
            domain: domain,
            source_name: finalSourceName,
            initial_status: initialStatus,
            is_trusted_user: isTrustedUser,
            is_official_domain: isOfficial,
            user_level: dbUser.level,
            user_trust_score: dbUser.trust_score,
          },
        },
      });

      return {
        link: newLink,
        isExisting: false,
        votedNow: false,
      };
    }, {
      ...DEFAULT_TX_OPTIONS,
      timeout: 10000, // 10s timeout for this transaction
    });

    // --- 14. LOG SECURITY EVENT ---
    await logSecurityEvent({
      userId: authUser.id,
      event: result.isExisting ? 'CHAPTER_LINK_DUPLICATE' : 'CHAPTER_LINK_SUBMIT',
      status: 'success',
      ipAddress: ip,
      userAgent,
      metadata: {
        link_id: result.link.id,
        series_id: seriesId,
        chapter_id: chapterId,
        domain: domain,
        status: result.link.status,
        is_existing: result.isExisting,
      },
    });

    // --- 15. RETURN RESPONSE ---
    const statusCode = result.isExisting ? 200 : 201;
    
    return NextResponse.json({
      id: result.link.id,
      url: result.link.url,
      domain: domain,
      source_name: htmlEncode(result.link.source_name),
      status: result.link.status,
      visibility_score: result.link.visibility_score,
      submitted_at: result.link.submitted_at.toISOString(),
      is_verified: result.link.verified_at !== null,
      tier: urlValidation.tier,
      message: result.isExisting
        ? (result.votedNow ? 'Link already exists. Your upvote was added.' : 'Link already exists.')
        : 'Link submitted successfully.',
    }, { status: statusCode });

  } catch (error) {
    return handleApiError(error);
  }
}
