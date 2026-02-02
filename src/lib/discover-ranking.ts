/**
 * Discover Ranking Formulas
 * 
 * Deterministic scoring system for Discover page sections.
 * All formulas use multiple signals to prevent single-metric dominance.
 * Scores decay over time to give newer series a chance.
 * 
 * IMPORTANT: Only Tier A and Tier B manga are eligible for Discover.
 * Tier C is excluded to maintain quality.
 * 
 * CONTENT POLICY: 'pornographic' content is BLOCKED platform-wide.
 * Only 'safe', 'suggestive', and 'erotica' are allowed.
 */

import { prisma } from "./prisma";
import { ALLOWED_CONTENT_RATINGS as PLATFORM_ALLOWED_RATINGS } from "@/lib/constants/safe-browsing";

// ============================================================================
// TYPES
// ============================================================================

export type DiscoverSection = 
  | 'trending_now'
  | 'most_popular_30d'
  | 'highest_rated'
  | 'recently_active'
  | 'new_and_noteworthy';

export interface RankedSeries {
  id: string;
  title: string;
  cover_url: string | null;
  type: string;
  status: string | null;
  genres: string[];
  content_rating: string | null;
  average_rating: number | null;
  total_follows: number;
  total_views: number;
  catalog_tier: string;
  score: number;
  rank: number;
}

export interface DiscoverParams {
  section: DiscoverSection;
  limit?: number;
  offset?: number;
  type?: string | null; // 'manga', 'manhwa', 'manhua', etc.
  contentRating?: string | null; // 'safe', 'suggestive', etc.
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Eligibility: Only Tier A and B are shown in Discover.
 * This prevents low-quality/spam series from surfacing.
 */
export const ELIGIBLE_TIERS = ['A', 'B'] as const;

/**
 * Time windows for signal aggregation
 */
export const TIME_WINDOWS = {
  TRENDING: 7,           // 7 days for trending
  POPULAR: 30,           // 30 days for popular
  RECENTLY_ACTIVE: 14,   // 14 days for recently active
  NEW_NOTEWORTHY: 60,    // 60 days for "new" eligibility
  NEW_SIGNALS: 14,       // 14 days for new series signals
} as const;

/**
 * Minimum thresholds to prevent gaming
 */
export const THRESHOLDS = {
  MIN_VOTES_FOR_RATING: 5,   // Minimum votes to appear in Highest Rated
  MIN_CHAPTERS_FOR_NEW: 1,   // Minimum chapters for New & Noteworthy
} as const;

// ============================================================================
// FORMULA WEIGHTS
// ============================================================================

/**
 * SECTION 1: Trending Now
 * 
 * Focus: Recent momentum - what's hot RIGHT NOW
 * 
 * Formula:
 *   score = (chapter_events_7d * 0.4)
 *         + (new_follows_7d * 0.3)
 *         + (views_7d * 0.2)
 *         + (rating_normalized * 0.1)
 * 
 * Rationale:
 * - Chapter events (40%): Active series with recent updates
 * - New follows (30%): Growing interest/buzz
 * - Views (20%): Engagement metric
 * - Rating (10%): Quality baseline (prevents pure spam)
 */
export const TRENDING_WEIGHTS = {
  CHAPTER_EVENTS: 0.4,
  NEW_FOLLOWS: 0.3,
  VIEWS: 0.2,
  RATING: 0.1,
} as const;

/**
 * SECTION 2: Most Popular (Last 30 Days)
 * 
 * Focus: Sustained popularity over a month
 * 
 * Formula:
 *   score = (new_follows_30d * 0.5)
 *         + (views_30d * 0.3)
 *         + (chapter_events_30d * 0.2)
 * 
 * Rationale:
 * - New follows (50%): People committing to the series
 * - Views (30%): General interest
 * - Chapter events (20%): Activity level
 */
export const POPULAR_WEIGHTS = {
  NEW_FOLLOWS: 0.5,
  VIEWS: 0.3,
  CHAPTER_EVENTS: 0.2,
} as const;

/**
 * SECTION 3: Highest Rated
 * 
 * Focus: Quality based on community ratings
 * 
 * Formula:
 *   score = average_rating * log10(total_votes + 1)
 * 
 * The logarithmic scaling means:
 * - 10 votes = 1x multiplier
 * - 100 votes = 2x multiplier
 * - 1000 votes = 3x multiplier
 * 
 * This balances quality vs. popularity.
 * 
 * Eligibility: total_votes >= MIN_VOTES_FOR_RATING (5)
 */
export const RATED_CONFIG = {
  MIN_VOTES: THRESHOLDS.MIN_VOTES_FOR_RATING,
} as const;

/**
 * SECTION 4: Recently Active
 * 
 * Focus: Series with recent chapter releases
 * 
 * Formula:
 *   score = time_decay(last_chapter_event_at)
 * 
 * Where time_decay = 1 / (1 + days_since_event)
 * 
 * Eligibility: last_chapter_event_at within 14 days
 */
export const ACTIVE_CONFIG = {
  MAX_DAYS: TIME_WINDOWS.RECENTLY_ACTIVE,
} as const;

/**
 * SECTION 5: New & Noteworthy
 * 
 * Focus: Promising new series that deserve attention
 * 
 * Eligibility: first_seen_at <= 60 days ago
 * 
 * Formula:
 *   score = (new_follows_14d * 0.5)
 *         + (chapter_events_14d * 0.3)
 *         + (rating_normalized * 0.2)
 * 
 * Rationale:
 * - New follows (50%): Early adoption signal
 * - Chapter events (30%): Active translation/updates
 * - Rating (20%): Early quality indicator
 */
export const NEW_WEIGHTS = {
  NEW_FOLLOWS: 0.5,
  CHAPTER_EVENTS: 0.3,
  RATING: 0.2,
} as const;

// ============================================================================
// TIE-BREAKER RULES
// ============================================================================

/**
 * When two series have the same score, break ties by:
 * 1. Higher total_follows wins
 * 2. More recent last_chapter_event_at wins
 * 3. Alphabetically by title (A-Z)
 */
export const TIE_BREAKERS = [
  'total_follows DESC',
  'last_activity_at DESC NULLS LAST',
  'title ASC',
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalizes a rating (0-10) to a 0-1 scale
 */
export function normalizeRating(rating: number | null): number {
  if (rating === null || rating < 0) return 0;
  return Math.min(rating / 10, 1);
}

/**
 * Calculates time decay: 1 / (1 + days_since)
 * Returns 1.0 for today, 0.5 for 1 day ago, 0.33 for 2 days ago, etc.
 */
export function timeDecay(date: Date | null): number {
  if (!date) return 0;
  const daysSince = Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24));
  return 1 / (1 + daysSince);
}

/**
 * Calculates logarithmic vote weight: log10(votes + 1)
 */
export function voteWeight(votes: number): number {
  return Math.log10(Math.max(1, votes + 1));
}

/**
 * Get date N days ago
 */
export function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

// ============================================================================
// SECURITY: ALLOWED VALUES FOR FILTERS
// ============================================================================

/**
 * SECURITY: Whitelist of allowed type values to prevent SQL injection
 */
const ALLOWED_TYPES = new Set(['manga', 'manhwa', 'manhua', 'webtoon', 'novel', 'light_novel', 'one_shot', 'doujinshi', 'all']);

/**
 * SECURITY: Whitelist of allowed content rating values to prevent SQL injection
 * CONTENT POLICY: 'pornographic' is BLOCKED platform-wide and NOT included
 */
const ALLOWED_CONTENT_RATINGS = new Set([...PLATFORM_ALLOWED_RATINGS, 'all']);

/**
 * SECURITY: Validate and sanitize filter values
 */
function validateFilter(value: string | null | undefined, allowedValues: Set<string>): string | null {
  if (!value || value === 'all') return null;
  const normalized = value.toLowerCase().trim();
  if (!allowedValues.has(normalized)) {
    console.warn(`[Security] Invalid filter value rejected: ${value}`);
    return null;
  }
  return normalized;
}

// ============================================================================
// SCORE CALCULATION FUNCTIONS
// ============================================================================

export interface SeriesSignals {
  chapter_events_7d: number;
  chapter_events_14d: number;
  chapter_events_30d: number;
  new_follows_7d: number;
  new_follows_14d: number;
  new_follows_30d: number;
  views_7d: number;
  views_30d: number;
  average_rating: number | null;
  total_votes: number;
  first_seen_at: Date | null;
  last_chapter_event_at: Date | null;
  total_follows: number;
}

/**
 * Calculate Trending Now score
 */
export function calculateTrendingScore(signals: SeriesSignals): number {
  const rating = normalizeRating(signals.average_rating);
  
  return (
    (signals.chapter_events_7d * TRENDING_WEIGHTS.CHAPTER_EVENTS) +
    (signals.new_follows_7d * TRENDING_WEIGHTS.NEW_FOLLOWS) +
    (signals.views_7d * TRENDING_WEIGHTS.VIEWS) +
    (rating * TRENDING_WEIGHTS.RATING * 100) // Scale rating contribution
  );
}

/**
 * Calculate Most Popular (30 Days) score
 */
export function calculatePopularScore(signals: SeriesSignals): number {
  return (
    (signals.new_follows_30d * POPULAR_WEIGHTS.NEW_FOLLOWS) +
    (signals.views_30d * POPULAR_WEIGHTS.VIEWS) +
    (signals.chapter_events_30d * POPULAR_WEIGHTS.CHAPTER_EVENTS)
  );
}

/**
 * Calculate Highest Rated score
 */
export function calculateRatedScore(signals: SeriesSignals): number {
  if (signals.total_votes < RATED_CONFIG.MIN_VOTES) {
    return 0; // Not eligible
  }
  
  const rating = signals.average_rating ?? 0;
  return rating * voteWeight(signals.total_votes);
}

/**
 * Calculate Recently Active score
 */
export function calculateActiveScore(signals: SeriesSignals): number {
  if (!signals.last_chapter_event_at) {
    return 0;
  }
  
  const daysSince = (Date.now() - signals.last_chapter_event_at.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSince > ACTIVE_CONFIG.MAX_DAYS) {
    return 0; // Not eligible
  }
  
  return timeDecay(signals.last_chapter_event_at);
}

/**
 * Calculate New & Noteworthy score
 */
export function calculateNewScore(signals: SeriesSignals): number {
  if (!signals.first_seen_at) {
    return 0;
  }
  
  const daysSinceFirst = (Date.now() - signals.first_seen_at.getTime()) / (1000 * 60 * 60 * 24);
  
  if (daysSinceFirst > TIME_WINDOWS.NEW_NOTEWORTHY) {
    return 0; // Not eligible - too old
  }
  
  const rating = normalizeRating(signals.average_rating);
  
  return (
    (signals.new_follows_14d * NEW_WEIGHTS.NEW_FOLLOWS) +
    (signals.chapter_events_14d * NEW_WEIGHTS.CHAPTER_EVENTS) +
    (rating * NEW_WEIGHTS.RATING * 100) // Scale rating contribution
  );
}

// ============================================================================
// QUERY BUILDERS - PARAMETERIZED FOR SECURITY
// ============================================================================

/**
 * Raw SQL for fetching series with all signals needed for ranking.
 * This is designed to be efficient with proper indexes.
 * SECURITY: Uses parameterized queries to prevent SQL injection.
 * CONTENT POLICY: Always excludes 'pornographic' content.
 */
function buildDiscoverSignalsSQL(typeFilter: string | null, contentRatingFilter: string | null): { sql: string, params: any[] } {
  const params: any[] = [];
  let paramIndex = 1;
  
  let typeClause = '';
  if (typeFilter) {
    typeClause = `AND s.type = $${paramIndex}`;
    params.push(typeFilter);
    paramIndex++;
  }
  
  let contentRatingClause = '';
  if (contentRatingFilter) {
    contentRatingClause = `AND s.content_rating = $${paramIndex}`;
    params.push(contentRatingFilter);
    paramIndex++;
  }

  const sql = `
WITH signals AS (
  SELECT 
    s.id,
    s.title,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.content_rating,
    s.average_rating,
    s.total_follows,
    s.total_views,
    s.catalog_tier,
    s.created_at as first_seen_at,
    s.last_activity_at,
    COALESCE(stats.total_ratings, 0) as total_votes,
    
    -- Chapter events aggregated
    COALESCE((
      SELECT SUM(weight)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'chapter_detected'
        AND sae.created_at >= NOW() - INTERVAL '7 days'
    ), 0) as chapter_events_7d,
    
    COALESCE((
      SELECT SUM(weight)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'chapter_detected'
        AND sae.created_at >= NOW() - INTERVAL '14 days'
    ), 0) as chapter_events_14d,
    
    COALESCE((
      SELECT SUM(weight)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'chapter_detected'
        AND sae.created_at >= NOW() - INTERVAL '30 days'
    ), 0) as chapter_events_30d,
    
    -- New follows aggregated
    COALESCE((
      SELECT COUNT(*)
      FROM library_entries le
      WHERE le.series_id = s.id
        AND le.added_at >= NOW() - INTERVAL '7 days'
        AND le.deleted_at IS NULL
    ), 0) as new_follows_7d,
    
    COALESCE((
      SELECT COUNT(*)
      FROM library_entries le
      WHERE le.series_id = s.id
        AND le.added_at >= NOW() - INTERVAL '14 days'
        AND le.deleted_at IS NULL
    ), 0) as new_follows_14d,
    
    COALESCE((
      SELECT COUNT(*)
      FROM library_entries le
      WHERE le.series_id = s.id
        AND le.added_at >= NOW() - INTERVAL '30 days'
        AND le.deleted_at IS NULL
    ), 0) as new_follows_30d,
    
    -- Views (using activity events with update_click type)
    COALESCE((
      SELECT COUNT(*)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'update_click'
        AND sae.created_at >= NOW() - INTERVAL '7 days'
    ), 0) as views_7d,
    
    COALESCE((
      SELECT COUNT(*)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'update_click'
        AND sae.created_at >= NOW() - INTERVAL '30 days'
    ), 0) as views_30d,
    
    -- Last chapter event
    (
      SELECT MAX(created_at)
      FROM series_activity_events sae
      WHERE sae.series_id = s.id
        AND sae.event_type = 'chapter_detected'
    ) as last_chapter_event_at
    
  FROM series s
  LEFT JOIN series_stats stats ON stats.series_id = s.id
  WHERE s.catalog_tier IN ('A', 'B')
    AND s.deleted_at IS NULL
    AND (s.content_rating IS NULL OR s.content_rating != 'pornographic')
    ${typeClause}
    ${contentRatingClause}
)
`;

  return { sql, params };
}

/**
 * Section-specific score calculations (appended to DISCOVER_SIGNALS_SQL)
 */
export const SECTION_SCORES = {
  trending_now: `
    SELECT *,
      (chapter_events_7d * 0.4) + 
      (new_follows_7d * 0.3) + 
      (views_7d * 0.2) + 
      (COALESCE(average_rating, 0) / 10 * 0.1 * 100) as score
    FROM signals
    ORDER BY score DESC, total_follows DESC, last_activity_at DESC NULLS LAST, title ASC
  `,
  
  most_popular_30d: `
    SELECT *,
      (new_follows_30d * 0.5) + 
      (views_30d * 0.3) + 
      (chapter_events_30d * 0.2) as score
    FROM signals
    ORDER BY score DESC, total_follows DESC, last_activity_at DESC NULLS LAST, title ASC
  `,
  
  highest_rated: `
    SELECT *,
      CASE 
        WHEN total_votes >= 5 
        THEN COALESCE(average_rating, 0) * LOG(total_votes + 1)
        ELSE 0
      END as score
    FROM signals
    WHERE total_votes >= 5
    ORDER BY score DESC, total_follows DESC, title ASC
  `,
  
  recently_active: `
    SELECT *,
      CASE 
        WHEN last_chapter_event_at IS NOT NULL 
          AND last_chapter_event_at >= NOW() - INTERVAL '14 days'
        THEN 1.0 / (1.0 + EXTRACT(EPOCH FROM (NOW() - last_chapter_event_at)) / 86400)
        ELSE 0
      END as score
    FROM signals
    WHERE last_chapter_event_at >= NOW() - INTERVAL '14 days'
    ORDER BY score DESC, total_follows DESC, title ASC
  `,
  
  new_and_noteworthy: `
    SELECT *,
      (new_follows_14d * 0.5) + 
      (chapter_events_14d * 0.3) + 
      (COALESCE(average_rating, 0) / 10 * 0.2 * 100) as score
    FROM signals
    WHERE first_seen_at >= NOW() - INTERVAL '60 days'
    ORDER BY score DESC, total_follows DESC, title ASC
  `,
} as const;

// ============================================================================
// MAIN QUERY FUNCTION - SECURE VERSION
// ============================================================================

/**
 * Fetches ranked series for a Discover section.
 * SECURITY: Uses parameterized queries and input validation to prevent SQL injection.
 * 
 * @param params - Section, limit, offset, and optional filters
 * @returns Array of ranked series with scores
 */
export async function getDiscoverSection(params: DiscoverParams): Promise<RankedSeries[]> {
  const { section, limit = 20, offset = 0, type, contentRating } = params;
  
  // SECURITY: Validate and sanitize limit/offset to prevent integer overflow
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.min(Math.max(0, offset), 10000);
  
  // SECURITY: Validate section against whitelist
  if (!SECTION_SCORES[section]) {
    console.warn(`[Security] Invalid section rejected: ${section}`);
    return [];
  }
  
  // SECURITY: Validate filter values against whitelist (prevents SQL injection)
  const validatedType = validateFilter(type, ALLOWED_TYPES);
  const validatedContentRating = validateFilter(contentRating, ALLOWED_CONTENT_RATINGS);
  
  // Build the parameterized query
  const { sql: baseQuery, params: queryParams } = buildDiscoverSignalsSQL(validatedType, validatedContentRating);
  const scoreQuery = SECTION_SCORES[section];
  
  // Add limit and offset as parameters
  const limitParamIndex = queryParams.length + 1;
  const offsetParamIndex = queryParams.length + 2;
  
  const fullQuery = `
    ${baseQuery}
    ${scoreQuery}
    LIMIT $${limitParamIndex}
    OFFSET $${offsetParamIndex}
  `;
  
  queryParams.push(safeLimit, safeOffset);
  
  // SECURITY: Use parameterized query instead of string interpolation
  const results = await prisma.$queryRawUnsafe<any[]>(fullQuery, ...queryParams);
  
  // Add rank to each result
  return results.map((row, index) => ({
    id: row.id,
    title: row.title,
    cover_url: row.cover_url,
    type: row.type,
    status: row.status,
    genres: row.genres || [],
    content_rating: row.content_rating,
    average_rating: row.average_rating ? parseFloat(row.average_rating) : null,
    total_follows: row.total_follows,
    total_views: row.total_views,
    catalog_tier: row.catalog_tier,
    score: parseFloat(row.score) || 0,
    rank: safeOffset + index + 1,
  }));
}

// ============================================================================
// ELIGIBILITY SUMMARY
// ============================================================================

/**
 * ELIGIBILITY RULES BY SECTION:
 * 
 * 1. Trending Now
 *    - Tier: A or B only
 *    - No additional restrictions
 *    - All series compete
 * 
 * 2. Most Popular (30 Days)
 *    - Tier: A or B only
 *    - No additional restrictions
 *    - All series compete
 * 
 * 3. Highest Rated
 *    - Tier: A or B only
 *    - total_votes >= 5
 *    - Prevents gaming with few fake votes
 * 
 * 4. Recently Active
 *    - Tier: A or B only
 *    - last_chapter_event_at within 14 days
 *    - Shows only actively updating series
 * 
 * 5. New & Noteworthy
 *    - Tier: A or B only
 *    - first_seen_at <= 60 days ago
 *    - Highlights promising newcomers
 * 
 * CONTENT POLICY: 'pornographic' content is BLOCKED platform-wide
 * and excluded from ALL sections.
 */

export const ELIGIBILITY_RULES = {
  trending_now: {
    tiers: ['A', 'B'],
    requirements: 'None - all eligible series compete',
  },
  most_popular_30d: {
    tiers: ['A', 'B'],
    requirements: 'None - all eligible series compete',
  },
  highest_rated: {
    tiers: ['A', 'B'],
    requirements: 'Minimum 5 user votes',
  },
  recently_active: {
    tiers: ['A', 'B'],
    requirements: 'Chapter event within last 14 days',
  },
  new_and_noteworthy: {
    tiers: ['A', 'B'],
    requirements: 'First seen within last 60 days',
  },
} as const;
