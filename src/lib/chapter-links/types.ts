/**
 * Chapter Links Types
 * 
 * TypeScript types for the chapter links feature.
 */

import type { ChapterLinkStatus, LinkReportReason } from '@prisma/client';

// =============================================================================
// SOURCE TIER ENUM
// =============================================================================

export type SourceTier = 'official' | 'aggregator' | 'user';

// =============================================================================
// URL VALIDATION
// =============================================================================

export interface UrlValidationResult {
  isValid: boolean;
  normalized?: string;
  hash?: string;
  domain?: string;
  sourceName?: string;
  tier?: SourceTier;
  error?: string;
}

export interface BlacklistCheckResult {
  isBlocked: boolean;
  reason?: string;
  domain?: string;
}

// =============================================================================
// LINK SUBMISSION
// =============================================================================

export interface SubmitLinkInput {
  seriesId: string;
  chapterId?: string;
  chapterNumber: string;
  url: string;
  note?: string;
}

export interface SubmitLinkResult {
  success: boolean;
  linkId?: string;
  error?: string;
  errorCode?: 'DUPLICATE' | 'BLACKLISTED' | 'MAX_LINKS' | 'INVALID_URL' | 'RATE_LIMITED';
}

// =============================================================================
// LINK DISPLAY
// =============================================================================

export interface ChapterLinkDisplay {
  id: string;
  url: string;
  sourceName: string;
  displayName?: string;
  tier: SourceTier;
  status: ChapterLinkStatus;
  visibilityScore: number;
  submittedAt: Date;
  isVerified: boolean;
  domain: string;
  scanlationGroup?: string;
}

// =============================================================================
// REPORTING
// =============================================================================

export interface ReportLinkInput {
  linkId: string;
  reason: LinkReportReason;
  details?: string;
}

export interface ReportLinkResult {
  success: boolean;
  error?: string;
  linkHidden?: boolean; // True if report caused link to be auto-hidden
}

// =============================================================================
// VOTING
// =============================================================================

export interface VoteLinkInput {
  linkId: string;
  vote: 1 | -1;
}

export interface VoteLinkResult {
  success: boolean;
  newScore?: number;
  error?: string;
}

// =============================================================================
// AUDIT LOG
// =============================================================================

export type LinkAuditAction = 
  | 'submit'
  | 'approve'
  | 'reject'
  | 'report'
  | 'remove'
  | 'restore'
  | 'vote'
  | 'verify';

export interface LinkAuditEntry {
  linkId: string | null;
  action: LinkAuditAction;
  actorId: string | null;
  actorIp?: string;
  payload: Record<string, unknown>;
}

// =============================================================================
// DMCA
// =============================================================================

export interface DmcaSubmitInput {
  requesterContact: string;
  requesterName?: string;
  requesterCompany?: string;
  targetUrl?: string;
  targetLinkId?: string;
  targetSeriesId?: string;
  workTitle?: string;
  claimDetails?: string;
}

export type DmcaStatus = 'pending' | 'processing' | 'resolved' | 'rejected';

// =============================================================================
// API RESPONSES
// =============================================================================

export interface ChapterLinksResponse {
  links: ChapterLinkDisplay[];
  canSubmit: boolean; // True if < 3 visible links
  userVotes?: Record<string, 1 | -1>; // User's votes if authenticated
}

export interface AdminLinkQueueResponse {
  links: Array<ChapterLinkDisplay & {
    reportCount: number;
    reportScore: number;
  }>;
  total: number;
  page: number;
  pageSize: number;
}
