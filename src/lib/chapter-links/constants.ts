/**
 * Chapter Links Constants
 * 
 * Defines source tiers, trusted domains, and validation patterns.
 */

// =============================================================================
// SOURCE TIERS
// =============================================================================
// Tier 1: Official sources - auto-linked, highest trust, no user submission needed
// Tier 2: Trusted aggregators - auto-linked from MangaDex
// Tier 3: User-submitted - requires moderation

export const OFFICIAL_DOMAINS = [
  // English official publishers
  'viz.com',
  'mangaplus.shueisha.co.jp',
  'shonenjump.com',
  'kodansha.us',
  'kodansha.com',
  'comikey.com',
  'azuki.co',
  'inkr.com',
  'comixology.com',
  'amazon.com', // Kindle manga
  'amazon.co.jp',
  'bookwalker.jp',
  'bookwalker.com',
  
  // Korean official
  'webtoons.com',
  'tappytoon.com',
  'lezhin.com',
  'tapas.io',
  
  // Japanese official
  'comic.pixiv.net',
  'piccoma.com',
  
  // Chinese official
  'webcomics.com',
  'kuaikanmanhua.com',
] as const;

export const AGGREGATOR_DOMAINS = [
  'mangadex.org',
] as const;

// Domains to never accept (hardcoded for security)
export const PERMANENTLY_BLOCKED_DOMAINS = [
  // Known malware/phishing - add as needed
  'bit.ly', // URL shorteners can mask destinations
  'tinyurl.com',
  'goo.gl',
  't.co',
] as const;

// =============================================================================
// SOURCE NAME NORMALIZATION
// =============================================================================
// Maps hostnames to canonical source names for display

export const SOURCE_NAME_MAP: Record<string, string> = {
  // Official
  'viz.com': 'VIZ Media',
  'mangaplus.shueisha.co.jp': 'MANGA Plus',
  'shonenjump.com': 'Shonen Jump',
  'kodansha.us': 'Kodansha',
  'kodansha.com': 'Kodansha',
  'comikey.com': 'Comikey',
  'azuki.co': 'Azuki',
  'inkr.com': 'INKR',
  'comixology.com': 'comiXology',
  'amazon.com': 'Amazon Kindle',
  'webtoons.com': 'WEBTOON',
  'tappytoon.com': 'Tappytoon',
  'lezhin.com': 'Lezhin Comics',
  'tapas.io': 'Tapas',
  
  // Aggregators
  'mangadex.org': 'MangaDex',
  
  // Common fan scanlation sites (for display only - links may not be auto-approved)
  'mangapark.net': 'MangaPark',
  'mangapark.me': 'MangaPark',
  'mangapark.com': 'MangaPark',
  'mangasee123.com': 'MangaSee',
  'manga4life.com': 'Manga4Life',
  'comick.io': 'ComicK',
  'comick.app': 'ComicK',
  'asurascans.com': 'Asura Scans',
  'asuracomic.net': 'Asura Scans',
  'flamescans.org': 'Flame Scans',
  'reaperscans.com': 'Reaper Scans',
  'luminousscans.com': 'Luminous Scans',
};

// =============================================================================
// LINK SUBMISSION LIMITS
// =============================================================================

export const MAX_VISIBLE_LINKS_PER_CHAPTER = 3;
export const MAX_LINKS_PER_USER_PER_HOUR = 10;
export const MAX_REPORTS_PER_USER_PER_DAY = 20;

// Report score threshold for auto-hiding links
export const AUTO_HIDE_REPORT_THRESHOLD = 3;

// =============================================================================
// URL VALIDATION PATTERNS
// =============================================================================

// Patterns that indicate suspicious URLs (never accept)
export const SUSPICIOUS_URL_PATTERNS = [
  /\.(exe|bat|cmd|msi|dll|scr|com|pif)$/i,  // Executable files
  /javascript:/i,                             // JavaScript injection
  /^data:/i,                                   // Data URIs
  /^file:/i,                                   // Local files
  /^blob:/i,                                   // Blob URLs
  /&#/,                                        // HTML entities (potential obfuscation)
  /%[0-9a-f]{2}%[0-9a-f]{2}%[0-9a-f]{2}/i,   // Triple URL encoding (obfuscation)
] as const;

// Valid URL protocols
export const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

// Maximum URL length
export const MAX_URL_LENGTH = 2000;
