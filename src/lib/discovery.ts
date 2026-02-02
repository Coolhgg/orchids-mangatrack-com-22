
import { CatalogTier } from "@prisma/client";

export const DISCOVERY_THRESHOLDS = {
  MIN_VOTES_FOR_RATING: 10,
  NEW_SERIES_DAYS: 60,
  ACTIVE_SERIES_DAYS: 14,
};

export const DISCOVERY_SECTIONS = {
  TRENDING: 'trending',
  POPULAR: 'popular',
  TOP_RATED: 'top_rated',
  ACTIVE: 'active',
  NEW: 'new',
} as const;

export type DiscoverySection = typeof DISCOVERY_SECTIONS[keyof typeof DISCOVERY_SECTIONS];

/**
 * Discovery Ranking Formulas (Reference)
 * 
 * 1. Trending Now
 * Score = (chapter_events_7d * 0.4) + (new_follows_7d * 0.3) + (views_7d * 0.2) + (rating_normalized * 0.1)
 * 
 * 2. Most Popular (Last 30 Days)
 * Score = (new_follows_30d * 0.5) + (views_30d * 0.3) + (chapter_events_30d * 0.2)
 * 
 * 3. Highest Rated
 * Score = average_rating * log10(total_votes + 1)
 * Eligibility: rating_count >= 10
 * 
 * 4. Recently Active
 * Score = time_decay(last_chapter_event_at)
 * Eligibility: chapter event in last 14 days
 * 
 * 5. New & Noteworthy
 * Score = (new_follows_14d * 0.5) + (chapter_events_14d * 0.3) + (rating_normalized * 0.2)
 * Eligibility: first_seen_at <= 60 days
 * 
 * Eligibility (All): Only Tier B and C (Tier 2 and 3)
 */

export interface DiscoveryResult {
  id: string;
  title: string;
  cover_url: string | null;
  type: string;
  status: string;
  catalog_tier: CatalogTier;
  average_rating: number | null;
  total_follows: number;
  last_chapter_at: string | null;
  score: number;
}
