import { supabaseAdmin } from "@/lib/supabase/admin"
import { ALLOWED_CONTENT_RATINGS } from "@/lib/constants/safe-browsing"

export interface RecommendationResult {
  id: string
  title: string
  cover_url: string | null
  content_rating: string | null
  original_language?: string | null
  type: string | null
  status: string | null
  genres: string[]
  total_follows: number
  average_rating: number | null
  updated_at: string
  recommendation_score: number
  match_reasons: string[]
}

export enum UserState {
  COLD = 'cold_user',
  WARM = 'warm_user',
  ACTIVE = 'active_user'
}

interface UserProfile {
  userId: string
  state: UserState
  topGenres: string[]
  topThemes: string[]
  librarySeriesIds: Set<string>
  caughtUpSeriesIds: Set<string>
  excludedStatusSeriesIds: Set<string>
  completionRatios: Record<string, number>
  safeBrowsing: 'sfw' | 'nsfw'
  affinities: {
    genre: Record<string, number>
    theme: Record<string, number>
    type: Record<string, number>
    series: Record<string, number>
  }
}

export function getUserState(interactionCount: number): UserState {
  if (interactionCount === 0) return UserState.COLD
  if (interactionCount < 10) return UserState.WARM
  return UserState.ACTIVE
}

/**
 * Calculates user profile and fetches affinities
 */
async function getUserProfile(userId: string, interactionCount: number): Promise<UserProfile> {
  const [{ data: user }, { data: library }, { data: affinities }] = await Promise.all([
    supabaseAdmin.from('users').select('safe_browsing_mode').eq('id', userId).single(),
    supabaseAdmin.from('library_entries')
      .select('series_id, status, last_read_chapter, series:series(genres, themes, latest_chapter)')
      .eq('user_id', userId)
      .is('deleted_at', null),
    supabaseAdmin.from('user_affinities').select('attribute_type, attribute_id, score').eq('user_id', userId)
  ])

  const librarySeriesIds = new Set<string>()
  const caughtUpSeriesIds = new Set<string>()
  const excludedStatusSeriesIds = new Set<string>()
  const genreCounts: Record<string, number> = {}
  const themeCounts: Record<string, number> = {}
  const completionRatios: Record<string, number> = {}

  if (library) {
    library.forEach((entry: any) => {
      if (entry.series_id) {
        librarySeriesIds.add(entry.series_id)
        if (['completed', 'dropped'].includes(entry.status?.toLowerCase())) {
          excludedStatusSeriesIds.add(entry.series_id)
        }
        
        const latest = entry.series?.latest_chapter ? Number(entry.series.latest_chapter) : 0
        const current = entry.last_read_chapter ? Number(entry.last_read_chapter) : 0
        
        if (latest > 0) {
          const ratio = Math.min(1, current / latest)
          completionRatios[entry.series_id] = ratio
          if (ratio >= 0.95) {
            caughtUpSeriesIds.add(entry.series_id)
          }
        }

        if (entry.series?.genres) {
          entry.series.genres.forEach((genre: string) => {
            genreCounts[genre] = (genreCounts[genre] || 0) + (completionRatios[entry.series_id] || 0.5)
          })
        }
        if (entry.series?.themes) {
          entry.series.themes.forEach((theme: string) => {
            themeCounts[theme] = (themeCounts[theme] || 0) + (completionRatios[entry.series_id] || 0.5)
          })
        }
      }
    })
  }

  const userAffinities = {
    genre: {} as Record<string, number>,
    theme: {} as Record<string, number>,
    type: {} as Record<string, number>,
    series: {} as Record<string, number>
  }

  if (affinities) {
    affinities.forEach(a => {
      if (a.attribute_type === 'genre') userAffinities.genre[a.attribute_id] = a.score
      if (a.attribute_type === 'theme') userAffinities.theme[a.attribute_id] = a.score
      if (a.attribute_type === 'type') userAffinities.type[a.attribute_id] = a.score
      if (a.attribute_type === 'series') userAffinities.series[a.attribute_id] = a.score
    })
  }

  const topGenres = Object.entries(genreCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([genre]) => genre)

  const topThemes = Object.entries(themeCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([theme]) => theme)

  return {
    userId,
    state: getUserState(interactionCount),
    topGenres,
    topThemes,
    librarySeriesIds,
    caughtUpSeriesIds,
    excludedStatusSeriesIds,
    completionRatios,
    safeBrowsing: (user?.safe_browsing_mode as 'sfw' | 'nsfw') || 'sfw',
    affinities: userAffinities
  }
}

/**
 * State-based Hybrid Weights
 */
export function getHybridWeights(state: UserState) {
  switch (state) {
    case UserState.COLD:
      return { gw: 1.0, pw: 0.0 }
    case UserState.WARM:
      return { gw: 0.6, pw: 0.4 }
    case UserState.ACTIVE:
      return { gw: 0.3, pw: 0.7 }
    default:
      return { gw: 0.5, pw: 0.5 }
  }
}

/**
 * Scoring Formula per User State
 */
function calculateAffinity(series: any, profile: UserProfile): number {
  if (profile.state === UserState.COLD) return 0

  let score = 0
  
  // 1. Genre Match (35%)
  if (series.genres && series.genres.length > 0) {
    let genreScore = 0
    series.genres.forEach((g: string) => {
      // Use affinities or top genres with completion bias
      genreScore += profile.affinities.genre[g] || (profile.topGenres.includes(g) ? 1 : 0)
    })
    score += (Math.min(1, genreScore / 3)) * 0.35
  }

  // 2. Theme Match (25%)
  if (series.themes && series.themes.length > 0) {
    let themeScore = 0
    series.themes.forEach((t: string) => {
      themeScore += profile.affinities.theme[t] || (profile.topThemes.includes(t) ? 1 : 0)
    })
    score += (Math.min(1, themeScore / 3)) * 0.25
  }

  // 3. Type Match (10%)
  if (series.type && profile.affinities.type[series.type]) {
    score += (Math.min(1, profile.affinities.type[series.type] / 2)) * 0.10
  }

  // 4. Reading Completion / Similarity (15%)
  // For ACTIVE users, we explicitly look for similarity to highly completed series
  if (profile.state === UserState.ACTIVE) {
    // Boost based on average completion of matching genres/themes
    let completionBoost = 0
    const matchingGenres = series.genres?.filter((g: string) => profile.topGenres.includes(g)) || []
    if (matchingGenres.length > 0) {
      completionBoost += 0.10
    }
    score += completionBoost
  } else {
    // WARM user baseline
    score += 0.05
  }

  // 5. Velocity & Availability Signals (20%)
  // - Recent chapter availability count (weighted)
  // - Follow velocity (library adds)
  let velocityScore = 0
  if (series.chapter_events_7d > 0) {
    velocityScore += Math.min(1, series.chapter_events_7d / 3) * 0.6 // Weighted by count
  }
  if (series.library_adds_7d > 0) {
    velocityScore += Math.min(1, series.library_adds_7d / 10) * 0.4 // Follow velocity
  }
  score += velocityScore * 0.20

  // 6. Baseline (5%)
  score += 0.05

  // 7. Recency Boost (ACTIVE User logic)
  if (profile.state === UserState.ACTIVE && series.last_chapter_at) {
    const daysSinceUpdate = (Date.now() - new Date(series.last_chapter_at).getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceUpdate < 7) {
      score *= 1.2 
    }
  }

  return Math.min(1, score)
}

// CONTENT POLICY: Get allowed content ratings based on safe browsing mode
// NOTE: 'pornographic' is BLOCKED platform-wide and never included
function getContentRatingsForMode(safeBrowsing: 'sfw' | 'nsfw'): string[] {
  if (safeBrowsing === 'sfw') {
    return ['safe', 'suggestive']
  }
  // NSFW mode includes erotica but NOT pornographic (blocked platform-wide)
  return [...ALLOWED_CONTENT_RATINGS]
}

/**
 * Hybrid Global + Personal Ranking
 */
export async function getHybridRecommendations(
  userId: string, 
  totalInteractions: number
): Promise<RecommendationResult[]> {
  const profile = await getUserProfile(userId, totalInteractions)
  
  if (profile.state === UserState.COLD) {
    return getColdStartRecommendations(profile.safeBrowsing)
  }

  const { gw, pw } = getHybridWeights(profile.state)
  const contentRatings = getContentRatingsForMode(profile.safeBrowsing)
  
  // Fetch Candidates from materialized views
  const [trending, popular, noteworthy] = await Promise.all([
    supabaseAdmin.from('discover_trending').select('*').in('content_rating', contentRatings).order('rank', { ascending: true }).limit(100),
    supabaseAdmin.from('discover_popular_30d').select('*').in('content_rating', contentRatings).order('rank', { ascending: true }).limit(100),
    supabaseAdmin.from('discover_new_and_noteworthy').select('*').in('content_rating', contentRatings).order('rank', { ascending: true }).limit(50)
  ])

  const candidates = new Map<string, any>()
  
  const processTier = (data: any[] | null, tierWeight: number) => {
    if (!data) return
    data.forEach(s => {
      // Never recommend already tracked series
      if (profile.librarySeriesIds.has(s.series_id)) return

      const globalScore = (1.0 - (s.rank / 100)) * tierWeight
      const existing = candidates.get(s.series_id)
      
      if (!existing || globalScore > existing.globalScore) {
        candidates.set(s.series_id, { ...s, globalScore })
      }
    })
  }

  processTier(trending.data, 1.0)
  processTier(popular.data, 0.8)
  processTier(noteworthy.data, 0.6)

  // Score and Rank
  const scored = Array.from(candidates.values()).map(s => {
    const personalAffinity = calculateAffinity(s, profile)
    const finalScore = (s.globalScore * gw) + (personalAffinity * pw)
    
    let reason = 'Trending Now'
    if (profile.state === UserState.ACTIVE && personalAffinity > 0.75) reason = 'Perfect Match for You'
    else if (personalAffinity > 0.6) reason = 'Based on your interests'
    else if (s.globalScore > 0.8) reason = 'Highly Popular'
    else if (personalAffinity > 0.4) reason = 'Recommended for you'

    return {
      id: s.series_id,
      title: s.title,
      cover_url: s.cover_url,
      content_rating: s.content_rating,
      original_language: s.original_language,
      type: s.type,
      status: s.status,
      genres: s.genres,
      total_follows: s.total_follows,
      average_rating: s.average_rating ? Number(s.average_rating) : null,
      updated_at: s.last_chapter_at || new Date().toISOString(),
      recommendation_score: finalScore,
      match_reasons: [reason]
    }
  })

  // Diversity Pass
  const sorted = scored.sort((a, b) => b.recommendation_score - a.recommendation_score)
  const diversified: typeof scored = []
  const genreCountTop10: Record<string, number> = {}

  for (const item of sorted) {
    const primaryGenre = item.genres?.[0] || 'Unknown'
    if (diversified.length < 10) {
      if ((genreCountTop10[primaryGenre] || 0) < 3) {
        diversified.push(item)
        genreCountTop10[primaryGenre] = (genreCountTop10[primaryGenre] || 0) + 1
      }
    } else {
      diversified.push(item)
    }
    if (diversified.length >= 30) break
  }

  return diversified
}

export async function getPersonalRecommendations(userId: string): Promise<RecommendationResult[]> {
  const { data: materializedRecs, error } = await supabaseAdmin
    .from('user_recommendations')
    .select(`
      score,
      reason,
      series:series_id (
        id,
        title,
        cover_url,
        content_rating,
        original_language,
        type,
        status,
        genres,
        total_follows,
        average_rating,
        updated_at
      )
    `)
    .eq('user_id', userId)
    .order('score', { ascending: false })
    .limit(20)

  if (error || !materializedRecs || materializedRecs.length === 0) return []

  return materializedRecs.map((rec: any) => {
    const series = rec.series
    return {
      id: series.id,
      title: series.title,
      cover_url: series.cover_url,
      content_rating: series.content_rating,
      original_language: series.original_language,
      type: series.type,
      status: series.status,
      genres: series.genres,
      total_follows: series.total_follows,
      average_rating: series.average_rating ? Number(series.average_rating) : null,
      updated_at: series.updated_at,
      recommendation_score: rec.score,
      match_reasons: [rec.reason]
    }
  })
}

export async function getColdStartRecommendations(
  safeBrowsing: 'sfw' | 'nsfw' = 'sfw',
  language?: string
): Promise<RecommendationResult[]> {
  const contentRatings = getContentRatingsForMode(safeBrowsing)
  const results: RecommendationResult[] = []
  const seenIds = new Set<string>()

  const fetchTier = async (view: string, limit: number, reason: string) => {
    let query = supabaseAdmin.from(view).select('*').in('content_rating', contentRatings).order('rank', { ascending: true })
    if (language) query = query.eq('original_language', language)
    if (seenIds.size > 0) query = query.not('series_id', 'in', `(${Array.from(seenIds).join(',')})`)
    
    const { data } = await query.limit(limit)
    if (data) {
      data.forEach((s: any) => {
        seenIds.add(s.series_id)
        results.push({
          id: s.series_id,
          title: s.title,
          cover_url: s.cover_url,
          content_rating: s.content_rating,
          original_language: s.original_language,
          type: s.type,
          status: s.status,
          genres: s.genres,
          total_follows: s.total_follows,
          average_rating: s.average_rating ? Number(s.average_rating) : null,
          updated_at: s.last_chapter_at || new Date().toISOString(),
          recommendation_score: 1.0 - (s.rank / 500),
          match_reasons: [reason]
        })
      })
    }
  }

  await fetchTier('discover_trending', 10, 'Trending Now')
  await fetchTier('discover_popular_30d', 10, 'Popular this Month')
  await fetchTier('discover_new_and_noteworthy', 10, 'New & Noteworthy')
  return results
}
