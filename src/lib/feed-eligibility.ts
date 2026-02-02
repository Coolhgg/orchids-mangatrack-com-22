import { CatalogTier } from '@prisma/client';

export const FEED_TYPE = {
  NEW_RELEASES: 'new_releases',
  LATEST_UPDATES: 'latest_updates',
} as const;

export type FeedType = typeof FEED_TYPE[keyof typeof FEED_TYPE];

export interface FeedEligibilityRules {
  allowedTiers: CatalogTier[];
  chapterFilter: 'chapter_1_only' | 'chapter_gt_1' | 'all';
  excludeUntrackedChapter1: boolean;
}

export const FEED_RULES: Record<FeedType, FeedEligibilityRules> = {
  [FEED_TYPE.NEW_RELEASES]: {
    allowedTiers: ['A', 'B'],
    chapterFilter: 'chapter_1_only',
    excludeUntrackedChapter1: false,
  },
  [FEED_TYPE.LATEST_UPDATES]: {
    allowedTiers: ['B', 'C'],
    chapterFilter: 'all',
    excludeUntrackedChapter1: true,
  },
};

export function isChapterEligibleForFeed(
  feedType: FeedType,
  tier: CatalogTier,
  chapterNumber: number | string
): boolean {
  const rules = FEED_RULES[feedType];
  const chNum = typeof chapterNumber === 'string' ? parseFloat(chapterNumber) : chapterNumber;

  if (!rules.allowedTiers.includes(tier)) {
    return false;
  }

  if (feedType === FEED_TYPE.NEW_RELEASES) {
    return chNum === 1;
  }

  if (feedType === FEED_TYPE.LATEST_UPDATES) {
    if (rules.excludeUntrackedChapter1 && tier === 'C' && chNum === 1) {
      return false;
    }
    return true;
  }

  return false;
}

export function getNewReleasesWhereClause() {
  return {
    series: {
      catalog_tier: { in: ['A', 'B'] as CatalogTier[] },
      deleted_at: null,
    },
    chapter_number: '1',
    deleted_at: null,
  };
}

export function getLatestUpdatesWhereClause() {
  return {
    series: {
      catalog_tier: { in: ['B', 'C'] as CatalogTier[] },
      deleted_at: null,
    },
    deleted_at: null,
    OR: [
      { series: { catalog_tier: 'B' } },
      { 
        series: { catalog_tier: 'C' },
        NOT: { chapter_number: '1' }
      },
    ],
  };
}

export const NEW_RELEASES_SQL = `
SELECT 
  lc.id,
  lc.chapter_number,
  lc.chapter_title,
  lc.volume_number,
  lc.published_at,
  lc.first_seen_at as first_detected_at,
  s.id as series_id,
  s.title as series_title,
  s.cover_url,
  s.content_rating,
  s.status as series_status,
  s.type as series_type,
  s.catalog_tier,
  s.tier_promoted_at
FROM chapters lc
JOIN series s ON lc.series_id = s.id
WHERE s.catalog_tier IN ('A', 'B')
  AND s.deleted_at IS NULL
  AND lc.deleted_at IS NULL
  AND lc.chapter_number = '1'
  AND lc.first_seen_at > NOW() - INTERVAL '30 days'
ORDER BY lc.first_seen_at DESC
LIMIT $1
OFFSET $2
`;

export const LATEST_UPDATES_SQL = `
SELECT 
  lc.id,
  lc.chapter_number,
  lc.chapter_title,
  lc.volume_number,
  lc.published_at,
  lc.first_seen_at as first_detected_at,
  s.id as series_id,
  s.title as series_title,
  s.cover_url,
  s.content_rating,
  s.status as series_status,
  s.type as series_type,
  s.catalog_tier
FROM chapters lc
JOIN series s ON lc.series_id = s.id
WHERE s.catalog_tier IN ('B', 'C')
  AND s.deleted_at IS NULL
  AND lc.deleted_at IS NULL
  AND (
    s.catalog_tier = 'B'
    OR (s.catalog_tier = 'C' AND CAST(lc.chapter_number AS DECIMAL) > 1)
  )
ORDER BY lc.first_seen_at DESC
LIMIT $1
OFFSET $2
`;

export const NEW_RELEASES_COUNT_SQL = `
SELECT COUNT(*) as total
FROM chapters lc
JOIN series s ON lc.series_id = s.id
WHERE s.catalog_tier IN ('A', 'B')
  AND s.deleted_at IS NULL
  AND lc.deleted_at IS NULL
  AND lc.chapter_number = '1'
  AND lc.first_seen_at > NOW() - INTERVAL '30 days'
`;

export const LATEST_UPDATES_COUNT_SQL = `
SELECT COUNT(*) as total
FROM chapters lc
JOIN series s ON lc.series_id = s.id
WHERE s.catalog_tier IN ('B', 'C')
  AND s.deleted_at IS NULL
  AND lc.deleted_at IS NULL
  AND (
    s.catalog_tier = 'B'
    OR (s.catalog_tier = 'C' AND CAST(lc.chapter_number AS DECIMAL) > 1)
  )
`;

export const AVAILABILITY_FEED_SQL = `
SELECT 
  ca.id as event_id,
  ca.discovered_at as occurred_at,
  s.id as series_id,
  s.title as series_title,
  s.cover_url as series_cover,
  s.catalog_tier,
  ca.chapter_number,
  ca.source_name,
  ca.source_url,
  NULL as scanlation_group
FROM chapter_availability ca
JOIN series s ON s.id = ca.series_id
WHERE s.deleted_at IS NULL
  AND (
    s.catalog_tier = 'B'
    OR (s.catalog_tier = 'C' AND ca.chapter_number > 1)
  )
ORDER BY ca.discovered_at DESC
LIMIT $1
OFFSET $2
`;

export const AVAILABILITY_FEED_COUNT_SQL = `
SELECT COUNT(*) as total
FROM chapter_availability ca
JOIN series s ON s.id = ca.series_id
WHERE s.deleted_at IS NULL
  AND (
    s.catalog_tier = 'B'
    OR (s.catalog_tier = 'C' AND ca.chapter_number > 1)
  )
`;
