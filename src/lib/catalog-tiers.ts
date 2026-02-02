import { prisma } from './prisma';
import { CatalogTier } from '@prisma/client';
import { calculateDecayedScore } from './series-scoring';

// Activity weights (MangaTrack Parity / Anti-Ban Design)
export const ACTIVITY_WEIGHTS = {
  chapter_detected: 1,      // New chapter found by scraper
  chapter_source_added: 2,  // New translation source available
  search_impression: 5,     // Series appeared in search results
  chapter_read: 50,         // User opened a chapter
  series_followed: 100,     // User added series to library
} as const;

export type ActivityEventType = keyof typeof ACTIVITY_WEIGHTS | 'inactivity_decay';

// Thresholds for tier promotion
export const TIER_THRESHOLDS = {
  A: {
    recentChapterDays: 30,      // Chapter in last 30 days
    minActivityScore: 5000,     // 5k points (e.g. 100 reads or 1k impressions)
    minFollowers: 10,           // OR 10+ followers
  },
  B: {
    minActivityScore: 1000,     // Requires 1,000 points (e.g. 20 reads or 200 impressions)
    minFollowers: 1,            // OR at least 1 follower
  }
} as const;

/**
 * Record an activity event for a series (source-agnostic)
 * SECURITY: Uses parameterized query to prevent SQL injection.
 */
export async function recordActivityEvent(
  seriesId: string,
  eventType: ActivityEventType,
  sourceName?: string,
  chapterId?: string,
  userId?: string
): Promise<void> {
  const weight = eventType === 'inactivity_decay' ? 0 : (ACTIVITY_WEIGHTS[eventType as keyof typeof ACTIVITY_WEIGHTS] || 0);
  
  // 1. Create activity event in the new canonical table
  // SECURITY: Use tagged template literal for parameterized query to prevent SQL injection
  await prisma.$executeRaw`
    INSERT INTO activity_events (series_id, chapter_id, user_id, source_name, event_type, weight)
    VALUES (${seriesId}::uuid, ${chapterId || null}::uuid, ${userId || null}::uuid, ${sourceName || null}, ${eventType}, ${weight})
  `;
  
  // 2. Update last_activity_at (if not a decay event)
  if (eventType !== 'inactivity_decay') {
    await prisma.series.update({
      where: { id: seriesId },
      data: { last_activity_at: new Date() }
    });
  }

  // 3. Refresh the score using the exact formula
  await refreshActivityScore(seriesId);
}

/**
 * Evaluate if a series should be promoted based on activity
 * CRITICAL: Source-agnostic - never checks MangaDex existence
 */
export async function evaluateTierPromotion(seriesId: string): Promise<CatalogTier> {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: {
      stats: true,
      seed_list_entries: { 
        where: { seed_list: { is_active: true } },
        include: { seed_list: true } 
      },
      chapters: {
        where: {
          first_detected_at: {
            gte: new Date(Date.now() - TIER_THRESHOLDS.A.recentChapterDays * 24 * 60 * 60 * 1000)
          }
        },
        take: 1,
      }
    }
  });
  
  if (!series) return 'C';
  
  const currentTier = series.catalog_tier;
  let newTier: CatalogTier = currentTier;
  let reason = series.tier_reason;
  
  // ========================================
  // TIER A CONDITIONS (any ONE is sufficient)
  // ========================================
  
  // 1. Recent chapter from ANY source
  if (series.chapters.length > 0) {
    newTier = 'A';
    reason = 'recent_chapter';
  }
  
  // 2. High activity score
  else if (series.activity_score >= TIER_THRESHOLDS.A.minActivityScore) {
    newTier = 'A';
    reason = 'high_engagement';
  }
  
  // 3. Many followers
  else if (series.stats && series.stats.total_readers >= TIER_THRESHOLDS.A.minFollowers) {
    newTier = 'A';
    reason = 'popular';
  }
  
  // 4. In active seed list
  else if (series.seed_list_entries.length > 0) {
    newTier = 'A';
    reason = 'seed_list';
  }
  
    // ========================================
    // TIER B CONDITIONS (user-relevant)
    // ========================================
    else if (newTier === 'C' && (
      series.activity_score >= TIER_THRESHOLDS.B.minActivityScore || 
      (series.stats && series.stats.total_readers >= TIER_THRESHOLDS.B.minFollowers)
    )) {
      newTier = 'B';
      reason = 'user_relevant';
    }
  
  // ========================================
  // Apply tier change if needed
  // ========================================
  if (newTier !== currentTier) {
    await prisma.series.update({
      where: { id: seriesId },
      data: {
        catalog_tier: newTier,
        tier_promoted_at: new Date(),
        tier_reason: reason,
      }
    });
    
    console.log(`[TierManager] Series ${seriesId} promoted: ${currentTier} → ${newTier} (reason: ${reason})`);
  }
  
  return newTier;
}

/**
 * Legacy support for promoteSeriesTier
 */
export async function promoteSeriesTier(
  seriesId: string, 
  reason: 'chapter_first_appearance' | 'chapter_detected' | 'user_search' | 'user_follow' | 'activity'
) {
  let eventType: ActivityEventType = 'chapter_detected';
  if (reason === 'chapter_first_appearance') eventType = 'chapter_detected';
  if (reason === 'chapter_detected') eventType = 'chapter_source_added';
  if (reason === 'user_search') eventType = 'search_impression';
  if (reason === 'user_follow') eventType = 'series_followed';
  
  await recordActivityEvent(seriesId, eventType);
}

/**
 * Refresh activity score based on aggregated data and decay logic
 */
export async function refreshActivityScore(seriesId: string) {
  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    include: { stats: true }
  });

  if (!series) return;

  // Use the new decay-adjusted scoring formula
  const score = calculateDecayedScore(series);
  
  await prisma.series.update({
    where: { id: seriesId },
    data: { activity_score: score }
  });
  
  await evaluateTierPromotion(seriesId);
}

/**
 * Demote stale series and apply inactivity decay (run periodically)
 * Formula: -5 per week of inactivity
 */
export async function runTierDemotionCheck(): Promise<void> {
  // 1. Identify series that need decay or demotion
  const staleCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 1 week
  
  const affectedSeries = await prisma.series.findMany({
    where: {
      OR: [
        { activity_score: { gt: 0 }, last_activity_at: { lt: staleCutoff } },
        { catalog_tier: { in: ['A', 'B'] }, last_activity_at: { lt: staleCutoff } }
      ]
    },
    select: { id: true }
  });

  for (const series of affectedSeries) {
    await refreshActivityScore(series.id);
  }

  // 2. Legacy demotion logic for hard cutoffs (optional if refreshActivityScore + evaluateTierPromotion is robust)
  const hardStaleCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  await prisma.series.updateMany({
    where: {
      catalog_tier: 'A',
      last_activity_at: { lt: hardStaleCutoff },
      seed_list_entries: { none: {} },
    },
    data: {
      catalog_tier: 'B',
      tier_reason: 'stale_demoted',
    }
  });
}
