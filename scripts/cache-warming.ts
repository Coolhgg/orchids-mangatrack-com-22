#!/usr/bin/env npx ts-node
import { prismaRead } from '../src/lib/prisma'
import { redis } from '../src/lib/redis'
import { supabaseAdminRead } from '../src/lib/supabase/admin'

const CACHE_PREFIX = 'warm:'
const CACHE_TTL = 3600

interface WarmResult {
  key: string
  success: boolean
  duration: number
  itemCount?: number
  error?: string
}

async function warmLeaderboardCache(): Promise<WarmResult> {
  const start = Date.now()
  const key = `${CACHE_PREFIX}leaderboard:xp:top50`
  
  try {
    const users = await prismaRead.user.findMany({
      select: {
        id: true,
        username: true,
        avatar_url: true,
        xp: true,
        level: true,
        streak_days: true,
      },
      where: { xp: { gt: 0 } },
      orderBy: { xp: 'desc' },
      take: 50,
    })
    
    if (redis) {
      await redis.setex(key, CACHE_TTL, JSON.stringify(users))
    }
    
    return {
      key: 'leaderboard:xp:top50',
      success: true,
      duration: Date.now() - start,
      itemCount: users.length,
    }
  } catch (error: any) {
    return {
      key: 'leaderboard:xp:top50',
      success: false,
      duration: Date.now() - start,
      error: error.message,
    }
  }
}

async function warmTrendingSeriesCache(): Promise<WarmResult> {
  const start = Date.now()
  const key = `${CACHE_PREFIX}series:trending`
  
  try {
    const { data: series, error } = await supabaseAdminRead
      .from('series')
      .select('id, title, cover_url, type, status, genres, activity_score')
      .eq('catalog_tier', 'A')
      .is('deleted_at', null)
      .order('activity_score', { ascending: false, nullsFirst: false })
      .limit(50)
    
    if (error) throw error
    
    if (redis && series) {
      await redis.setex(key, CACHE_TTL, JSON.stringify(series))
    }
    
    return {
      key: 'series:trending',
      success: true,
      duration: Date.now() - start,
      itemCount: series?.length || 0,
    }
  } catch (error: any) {
    return {
      key: 'series:trending',
      success: false,
      duration: Date.now() - start,
      error: error.message,
    }
  }
}

async function warmGenresCache(): Promise<WarmResult> {
  const start = Date.now()
  const key = `${CACHE_PREFIX}filters:genres`
  
  try {
    const { data, error } = await supabaseAdminRead
      .from('series')
      .select('genres')
      .eq('catalog_tier', 'A')
      .is('deleted_at', null)
      .limit(5000)
    
    if (error) throw error
    
    const genreSet = new Set<string>()
    data?.forEach(row => {
      (row.genres || []).forEach((g: string) => genreSet.add(g))
    })
    
    const genres = Array.from(genreSet).sort()
    
    if (redis) {
      await redis.setex(key, CACHE_TTL * 2, JSON.stringify(genres))
    }
    
    return {
      key: 'filters:genres',
      success: true,
      duration: Date.now() - start,
      itemCount: genres.length,
    }
  } catch (error: any) {
    return {
      key: 'filters:genres',
      success: false,
      duration: Date.now() - start,
      error: error.message,
    }
  }
}

async function warmLatestUpdatesCache(): Promise<WarmResult> {
  const start = Date.now()
  const key = `${CACHE_PREFIX}feed:latest:page1`
  
  try {
    const { data, error } = await supabaseAdminRead
      .from('chapters')
      .select(`
        id,
        chapter_number,
        chapter_title,
        published_at,
        series_source:series_sources!inner(
          series:series!inner(
            id, title, cover_url, type, content_rating
          )
        )
      `)
      .not('published_at', 'is', null)
      .order('published_at', { ascending: false })
      .limit(24)
    
    if (error) throw error
    
    if (redis && data) {
      await redis.setex(key, 300, JSON.stringify(data))
    }
    
    return {
      key: 'feed:latest:page1',
      success: true,
      duration: Date.now() - start,
      itemCount: data?.length || 0,
    }
  } catch (error: any) {
    return {
      key: 'feed:latest:page1',
      success: false,
      duration: Date.now() - start,
      error: error.message,
    }
  }
}

export async function warmAllCaches(): Promise<WarmResult[]> {
  console.log('[Cache Warming] Starting cache warming...')
  
  const results = await Promise.all([
    warmLeaderboardCache(),
    warmTrendingSeriesCache(),
    warmGenresCache(),
    warmLatestUpdatesCache(),
  ])
  
  const successful = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length
  const totalDuration = results.reduce((sum, r) => sum + r.duration, 0)
  
  console.log(`[Cache Warming] Complete: ${successful} succeeded, ${failed} failed`)
  console.log(`[Cache Warming] Total duration: ${totalDuration}ms`)
  
  results.forEach(r => {
    if (r.success) {
      console.log(`  ✓ ${r.key}: ${r.itemCount} items in ${r.duration}ms`)
    } else {
      console.log(`  ✗ ${r.key}: ${r.error}`)
    }
  })
  
  return results
}

if (require.main === module) {
  warmAllCaches()
    .then(() => process.exit(0))
    .catch(err => {
      console.error('[Cache Warming] Fatal error:', err)
      process.exit(1)
    })
}
