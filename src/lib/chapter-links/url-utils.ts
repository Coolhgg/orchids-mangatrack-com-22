/**
 * URL Utilities for Chapter Links
 * 
 * Provides URL validation, normalization, hashing, and blacklist checking.
 * IMPORTANT: No active content fetching - only regex/hash operations.
 */

import { createHash } from 'crypto';
import type { UrlValidationResult, BlacklistCheckResult, SourceTier } from './types';
import {
  OFFICIAL_DOMAINS,
  AGGREGATOR_DOMAINS,
  PERMANENTLY_BLOCKED_DOMAINS,
  SOURCE_NAME_MAP,
  SUSPICIOUS_URL_PATTERNS,
  ALLOWED_PROTOCOLS,
  MAX_URL_LENGTH,
} from './constants';

// =============================================================================
// URL NORMALIZATION
// =============================================================================

/**
 * Normalizes a URL for consistent comparison and hashing.
 * 
 * Steps:
 * 1. Trim whitespace
 * 2. Lowercase protocol and hostname
 * 3. Remove www. prefix
 * 4. Remove trailing slashes
 * 5. Remove common tracking parameters
 * 6. Keep path case-sensitive (some sites use case-sensitive paths)
 */
export function normalizeUrl(url: string): string {
  try {
    const trimmed = url.trim();
    const parsed = new URL(trimmed);
    
    // Lowercase hostname, keep path as-is
    let normalized = `${parsed.protocol}//${parsed.hostname.toLowerCase().replace(/^www\./, '')}`;
    
    // Add path (preserve case)
    if (parsed.pathname && parsed.pathname !== '/') {
      normalized += parsed.pathname.replace(/\/+$/, ''); // Remove trailing slashes
    }
    
    // Filter out common tracking parameters
    const trackingParams = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref', 'fbclid', 'gclid'];
    const cleanParams = new URLSearchParams();
    parsed.searchParams.forEach((value, key) => {
      if (!trackingParams.includes(key.toLowerCase())) {
        cleanParams.set(key, value);
      }
    });
    
    const queryString = cleanParams.toString();
    if (queryString) {
      normalized += `?${queryString}`;
    }
    
    // Remove fragment
    return normalized;
  } catch {
    // Return original if URL parsing fails
    return url.trim().toLowerCase();
  }
}

/**
 * Extracts the domain from a URL.
 */
export function extractDomain(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    return parsed.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

// =============================================================================
// URL HASHING
// =============================================================================

/**
 * Creates a SHA256 hash of a normalized URL.
 * Used for deduplication in the database.
 */
export function hashUrl(url: string): string {
  const normalized = normalizeUrl(url);
  return createHash('sha256').update(normalized).digest('hex');
}

// =============================================================================
// SOURCE TIER DETECTION
// =============================================================================

/**
 * Determines the source tier for a domain.
 */
export function getSourceTier(domain: string): SourceTier {
  const lowerDomain = domain.toLowerCase();
  
  // Check official domains
  if (OFFICIAL_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith(`.${d}`))) {
    return 'official';
  }
  
  // Check aggregator domains
  if (AGGREGATOR_DOMAINS.some(d => lowerDomain === d || lowerDomain.endsWith(`.${d}`))) {
    return 'aggregator';
  }
  
  return 'user';
}

/**
 * Gets the display name for a source domain.
 */
export function getSourceName(domain: string): string {
  const lowerDomain = domain.toLowerCase();
  
  // Direct match
  if (SOURCE_NAME_MAP[lowerDomain]) {
    return SOURCE_NAME_MAP[lowerDomain];
  }
  
  // Check if it's a subdomain match
  for (const [key, name] of Object.entries(SOURCE_NAME_MAP)) {
    if (lowerDomain.endsWith(`.${key}`)) {
      return name;
    }
  }
  
  // Fallback: capitalize domain parts
  const parts = lowerDomain.split('.');
  const mainPart = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  return mainPart.charAt(0).toUpperCase() + mainPart.slice(1);
}

// =============================================================================
// URL VALIDATION
// =============================================================================

/**
 * Validates a URL for submission.
 * 
 * Checks:
 * - URL format validity
 * - Protocol is http or https
 * - Length limits
 * - Suspicious patterns
 * - Hardcoded permanent blocklist
 * 
 * Does NOT:
 * - Make HTTP requests to the URL
 * - Check if the URL is reachable
 * - Fetch or parse page content
 */
export function validateUrl(url: string): UrlValidationResult {
  // Length check
  if (url.length > MAX_URL_LENGTH) {
    return {
      isValid: false,
      error: `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`,
    };
  }
  
  // Empty check
  if (!url.trim()) {
    return {
      isValid: false,
      error: 'URL cannot be empty',
    };
  }
  
  // Suspicious patterns check
  for (const pattern of SUSPICIOUS_URL_PATTERNS) {
    if (pattern.test(url)) {
      return {
        isValid: false,
        error: 'URL contains suspicious patterns',
      };
    }
  }
  
  // Parse URL
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return {
      isValid: false,
      error: 'Invalid URL format',
    };
  }
  
  // Protocol check
  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol as typeof ALLOWED_PROTOCOLS[number])) {
    return {
      isValid: false,
      error: 'URL must use http or https protocol',
    };
  }
  
  // Extract domain
  const domain = parsed.hostname.toLowerCase().replace(/^www\./, '');
  
  // Permanent blocklist check
  if (PERMANENTLY_BLOCKED_DOMAINS.some(d => domain === d || domain.endsWith(`.${d}`))) {
    return {
      isValid: false,
      error: 'URL shorteners and blocked domains are not allowed',
    };
  }
  
  // All checks passed
  const normalized = normalizeUrl(url);
  const hash = hashUrl(url);
  const tier = getSourceTier(domain);
  const sourceName = getSourceName(domain);
  
  return {
    isValid: true,
    normalized,
    hash,
    domain,
    sourceName,
    tier,
  };
}

// =============================================================================
// BLACKLIST CHECKING
// =============================================================================

/**
 * Checks if a URL's domain is in the database blacklist.
 * This is a synchronous check against a provided blacklist array.
 * 
 * The actual blacklist should be fetched from the database separately.
 */
export function checkBlacklist(
  url: string,
  blacklistedDomains: Array<{ domain: string; reason: string }>
): BlacklistCheckResult {
  const domain = extractDomain(url);
  
  if (!domain) {
    return { isBlocked: false };
  }
  
  // Check exact match and subdomain match
  for (const entry of blacklistedDomains) {
    if (domain === entry.domain || domain.endsWith(`.${entry.domain}`)) {
      return {
        isBlocked: true,
        reason: entry.reason,
        domain: entry.domain,
      };
    }
  }
  
  return { isBlocked: false };
}

// =============================================================================
// ADVISORY LOCK HELPERS
// =============================================================================

/**
 * Generates a deterministic lock key for PostgreSQL advisory locks.
 * 
 * The key is derived from series_id and chapter identifier (chapter_id or chapter_number).
 * This ensures that concurrent submissions for the same chapter use the same lock.
 * 
 * @returns A BigInt that can be used with pg_advisory_xact_lock()
 */
export function generateChapterLockKey(seriesId: string, chapterIdentifier: string): bigint {
  const combined = `${seriesId}:${chapterIdentifier}`;
  const hash = createHash('md5').update(combined).digest('hex');
  // Take first 15 hex chars (60 bits) to stay within BigInt safe range
  return BigInt(`0x${hash.slice(0, 15)}`);
}

/**
 * SQL template for acquiring advisory lock in a transaction.
 * 
 * Usage in Prisma:
 * ```typescript
 * const lockKey = generateChapterLockKey(seriesId, chapterNumber);
 * await prisma.$queryRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
 * ```
 */
export const ADVISORY_LOCK_SQL_TEMPLATE = `
-- Acquire advisory lock for chapter link submission
-- Lock is automatically released at end of transaction
SELECT pg_advisory_xact_lock($1);
`;

// =============================================================================
// REPORT WEIGHT CALCULATION
// =============================================================================

/**
 * Calculates the weight of a report based on user trust score.
 * 
 * Trust score ranges from 0.5 to 1.0.
 * Report weight ranges from 1 to 2 (higher trust = higher weight).
 */
export function calculateReportWeight(trustScore: number): number {
  // Clamp trust score to valid range
  const clampedTrust = Math.max(0.5, Math.min(1.0, trustScore));
  // Weight = 1.0 to 2.0 based on trust
  return Math.round(clampedTrust * 2);
}

// =============================================================================
// URL DISPLAY HELPERS
// =============================================================================

/**
 * Creates a shortened display version of a URL.
 */
export function shortenUrlForDisplay(url: string, maxLength: number = 50): string {
  try {
    const parsed = new URL(url);
    const display = `${parsed.hostname}${parsed.pathname}`;
    if (display.length <= maxLength) {
      return display;
    }
    return display.slice(0, maxLength - 3) + '...';
  } catch {
    return url.slice(0, maxLength);
  }
}

/**
 * Checks if a URL is from an official (Tier 1) source.
 */
export function isOfficialSource(url: string): boolean {
  const domain = extractDomain(url);
  return domain ? getSourceTier(domain) === 'official' : false;
}

/**
 * Checks if a URL is from MangaDex (Tier 2).
 */
export function isMangaDexSource(url: string): boolean {
  const domain = extractDomain(url);
  return domain ? getSourceTier(domain) === 'aggregator' : false;
}
