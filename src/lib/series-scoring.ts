import { Series, SeriesStats } from '@prisma/client'

/**
 * TRENDING SCORE DECAY CONSTANTS
 * Weight multipliers for different activity types
 */
export const TRENDING_WEIGHTS = {
  CHAPTER_DETECTED: 3.0,
  SERIES_FOLLOWED: 2.0,
  CHAPTER_READ: 1.0,
  UPDATE_CLICK: 1.0
}

/**
 * DECAY WINDOWS AND HALF-LIVES (in hours)
 */
export const TRENDING_WINDOWS = {
  TODAY: { window: 24, halfLife: 12 },
  WEEK: { window: 24 * 7, halfLife: 72 },
  MONTH: { window: 24 * 30, halfLife: 360 }
}

/**
 * CALCULATES DECAYED ACTIVITY SCORE

 * Formula: Score = Engagement * DecayFactor(UpdateRecency, EngagementRecency)
 * 
 * Engagement = (Follows * 1.0) + (LibraryCount * 2.0) + (WeeklyReaders * 0.5)
 */
export function calculateDecayedScore(
  series: Series & { stats?: SeriesStats | null },
  now: Date = new Date()
): number {
  const followCount = series.total_follows || 0
  const libraryCount = series.stats?.total_readers || 0
  const viewVelocity = series.stats?.weekly_readers || 0
  
  const engagementScore = (followCount * 1.0) + (libraryCount * 2.0) + (viewVelocity * 0.5)
  
  // Months since last chapter update
  const monthsSinceUpdate = series.last_chapter_at 
    ? (now.getTime() - new Date(series.last_chapter_at).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : 100
    
  // Months since last user activity (tracked via last_activity_at)
  const monthsSinceEngagement = series.last_activity_at
    ? (now.getTime() - new Date(series.last_activity_at).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : 100
    
  let decayFactor = 1.0
  
  if (monthsSinceUpdate >= 24) {
    // Suppress if no update in 2 years AND no engagement in 6 months
    if (monthsSinceEngagement >= 6) {
      decayFactor = 0.0
    } else {
      decayFactor = 0.1
    }
  } else if (monthsSinceUpdate >= 12) {
    decayFactor = 0.5
  }
  
  return Math.round(engagementScore * decayFactor)
}

export const SUPPRESSION_THRESHOLDS = {
  SOFT: 100,   // Hidden from Trending/Featured
  MEDIUM: 10,  // Hidden from Discover
  HARD: 0      // Hidden from all feeds
}

export function isEligibleForDiscover(
  series: Series & { stats?: SeriesStats | null }, 
  score: number,
  now: Date = new Date()
): boolean {
  if (score < SUPPRESSION_THRESHOLDS.MEDIUM) return false
  
  const monthsSinceUpdate = series.last_chapter_at 
    ? (now.getTime() - new Date(series.last_chapter_at).getTime()) / (1000 * 60 * 60 * 24 * 30.44)
    : 100

  // Criteria for Discover:
  // 1. Updated in last 12 months
  // 2. OR High legacy popularity (>1000 readers)
  // 3. OR Active binge-reading velocity (>5.0 weekly)
  // 4. OR High engagement override (score > SOFT threshold)
  return (
    monthsSinceUpdate < 12 || 
    (series.stats?.total_readers || 0) > 1000 || 
    (series.stats?.weekly_readers || 0) > 5.0 ||
    score > SUPPRESSION_THRESHOLDS.SOFT
  )
}
