'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { UUIDSchema, StatusSchema, ChapterSchema, RatingSchema } from '@/lib/schemas/actions'
import { promoteSeriesTier } from '@/lib/catalog-tiers'
import { XP_PER_CHAPTER, XP_SERIES_COMPLETED, addXp, calculateLevel } from '@/lib/gamification/xp'
import { calculateSeasonXpUpdate } from '@/lib/gamification/seasons'
import { calculateNewStreak, calculateStreakBonus } from '@/lib/gamification/streaks'
import { checkAchievements, UnlockedAchievement } from '@/lib/gamification/achievements'
import {
  createAchievementNotification,
  createLevelUpNotification,
  createStreakMilestoneNotification,
} from './notifications'

const STREAK_MILESTONES = [7, 30, 100, 365]

export async function addToLibrary(seriesId: string, status: string = 'reading') {
  const seriesIdResult = UUIDSchema.safeParse(seriesId)
  if (!seriesIdResult.success) {
    return { error: 'Invalid series ID format' }
  }
  
  const statusResult = StatusSchema.safeParse(status)
  if (!statusResult.success) {
    return { error: 'Invalid status. Must be one of: reading, completed, planning, dropped, paused' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    const entry = await prisma.$transaction(async (tx) => {
      // 1. Get series and its primary source
      const series = await tx.series.findUnique({
        where: { id: seriesIdResult.data },
        include: {
          sources: {
            take: 1,
            orderBy: { trust_score: 'desc' }
          }
        }
      })

      if (!series) {
        throw new Error('Series not found')
      }

      const primarySource = series.sources[0]
      if (!primarySource || !primarySource.source_url) {
        throw new Error('Series has no valid source URL. Cannot add to library.')
      }

      // 2. Check if already exists
      const existingEntry = await tx.libraryEntry.findUnique({
        where: {
          user_id_source_url: {
            user_id: user.id,
            source_url: primarySource.source_url,
          }
        },
        select: { id: true, deleted_at: true }
      })

      // 3. Upsert entry
      const entry = await tx.libraryEntry.upsert({
        where: {
          user_id_source_url: {
            user_id: user.id,
            source_url: primarySource.source_url,
          }
        },
        update: {
          series_id: seriesIdResult.data,
          status: statusResult.data as any,
          deleted_at: null,
          updated_at: new Date(),
        },
        create: {
          user_id: user.id,
          series_id: seriesIdResult.data,
          source_url: primarySource.source_url,
          source_name: primarySource.source_name,
          status: statusResult.data as any,
          last_read_chapter: 0,
          sync_priority: 'WARM',
          metadata_status: 'enriched',
        }
      })

      // 4. Update follow count and tier if new or restored
      let shouldPromote = false
      if (!existingEntry || existingEntry.deleted_at) {
        await tx.series.update({
          where: { id: seriesIdResult.data },
          data: { total_follows: { increment: 1 } }
        })
        shouldPromote = true
      }

      return { entry, shouldPromote }
    })

    // 5. Side effects outside transaction to avoid deadlocks
    if (entry.shouldPromote) {
      await promoteSeriesTier(seriesIdResult.data, 'user_follow')
    }

    // Log activity
    await supabase.from('activities').insert({
      user_id: user.id,
      type: 'series_added',
      series_id: seriesIdResult.data,
      metadata: { status: statusResult.data }
    })

    revalidatePath('/library')
    revalidatePath('/discover')
    revalidatePath('/feed')
    
    const { sanitizePrismaObject } = await import('@/lib/utils')
    
    return { 
      data: sanitizePrismaObject(entry.entry)
    }
  } catch (error: any) {
    console.error('Failed to add to library:', error)
    return { error: error.message || 'Failed to add to library' }
  }
}

export async function removeFromLibrary(entryId: string) {
  const entryIdResult = UUIDSchema.safeParse(entryId)
  if (!entryIdResult.success) {
    return { error: 'Invalid entry ID format' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const entry = await tx.libraryEntry.findUnique({
        where: { id: entryIdResult.data, user_id: user.id },
        select: { series_id: true, deleted_at: true },
      })

      if (!entry || entry.deleted_at) {
        throw new Error('Library entry not found')
      }

      // Soft delete - preserves last_read_chapter and other progress data
      await tx.libraryEntry.update({
        where: { id: entryIdResult.data },
        data: { deleted_at: new Date() },
      })

      if (entry.series_id) {
        await tx.$executeRaw`
          UPDATE series 
          SET total_follows = GREATEST(0, total_follows - 1)
          WHERE id = ${entry.series_id}::uuid
        `
      }
    })

    revalidatePath('/library')
    revalidatePath('/feed')
    return { success: true }
  } catch (error: any) {
    return { error: error.message || 'Failed to remove from library' }
  }
}

export async function updateProgress(entryId: string, chapter: number, seriesId: string, sourceId?: string) {
  const entryIdResult = UUIDSchema.safeParse(entryId)
  if (!entryIdResult.success) {
    return { error: 'Invalid entry ID format' }
  }
  
  const seriesIdResult = UUIDSchema.safeParse(seriesId)
  if (!seriesIdResult.success) {
    return { error: 'Invalid series ID format' }
  }
  
  const chapterResult = ChapterSchema.safeParse(chapter)
  if (!chapterResult.success) {
    return { error: 'Invalid chapter number. Must be a number between 0 and 100000' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // XP NORMALIZATION: Fetch current progress to check monotonicity
  const { data: currentEntry } = await supabase
    .from('library_entries')
    .select('last_read_chapter')
    .eq('id', entryIdResult.data)
    .eq('user_id', user.id)
    .single()

  const currentLastRead = currentEntry?.last_read_chapter ?? 0
  const isProgressingForward = chapterResult.data > currentLastRead

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      last_read_chapter: chapterResult.data,
      last_read_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryIdResult.data)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  // Gamification payload
  let xpGained = 0
  let streakBonus = 0
  let streakDays = 0
  let levelUp: number | null = null
  let achievementsUnlocked: UnlockedAchievement[] = []
  let streakMilestone: number | null = null

  try {
    await supabase
      .from('users')
      .update({
        last_read_at: new Date().toISOString(),
      })
      .eq('id', user.id)
  } catch (e) {
    console.error('Failed to update user last_read_at:', e)
  }

  // XP NORMALIZATION: Only award XP when progressing forward (monotonic)
  if (isProgressingForward) {
    try {
      // Use Prisma transaction to update XP, streak, and check achievements atomically
      const result = await prisma.$transaction(async (tx) => {
        const userProfile = await tx.user.findUnique({
          where: { id: user.id },
          select: { 
            xp: true, 
            level: true,
            season_xp: true, 
            current_season: true,
            streak_days: true,
            last_read_at: true,
            chapters_read: true,
          }
        })
        
        if (!userProfile) return null

        const oldLevel = userProfile.level ?? 1
        const oldStreak = userProfile.streak_days ?? 0

        // Calculate new streak
        const newStreak = calculateNewStreak(oldStreak, userProfile.last_read_at)
        const isStreakIncreased = newStreak > oldStreak
        
        // Calculate streak bonus XP (only on streak increase)
        const streakXp = isStreakIncreased ? calculateStreakBonus(newStreak) : 0
        
        // Total XP = base chapter XP + streak bonus
        const totalXpGain = XP_PER_CHAPTER + streakXp
        const newXp = addXp(userProfile.xp || 0, totalXpGain)
        const newLevel = calculateLevel(newXp)
        
        const seasonUpdate = calculateSeasonXpUpdate(
          userProfile.season_xp,
          userProfile.current_season,
          totalXpGain
        )
        
        // Update user profile
        await tx.user.update({
          where: { id: user.id },
          data: {
            xp: newXp,
            level: newLevel,
            season_xp: seasonUpdate.season_xp,
            current_season: seasonUpdate.current_season,
            streak_days: newStreak,
            chapters_read: { increment: 1 },
          }
        })

        // Check for achievements
        const achievements = await checkAchievements(tx, user.id, 'chapter_read')
        
        // Check streak achievements if streak changed
        let streakAchievements: UnlockedAchievement[] = []
        if (isStreakIncreased) {
          streakAchievements = await checkAchievements(tx, user.id, 'streak_reached', { currentStreak: newStreak })
        }

        return {
          xpGained: XP_PER_CHAPTER,
          streakBonus: streakXp,
          streakDays: newStreak,
          levelUp: newLevel > oldLevel ? newLevel : null,
          achievementsUnlocked: [...achievements, ...streakAchievements],
          streakMilestone: STREAK_MILESTONES.includes(newStreak) && isStreakIncreased ? newStreak : null,
        }
      })

      if (result) {
        xpGained = result.xpGained
        streakBonus = result.streakBonus
        streakDays = result.streakDays
        levelUp = result.levelUp
        achievementsUnlocked = result.achievementsUnlocked
        streakMilestone = result.streakMilestone

        // Create persistent notifications (silent store)
        if (levelUp) {
          createLevelUpNotification(user.id, levelUp).catch(console.error)
        }
        if (streakMilestone) {
          createStreakMilestoneNotification(user.id, streakMilestone).catch(console.error)
        }
        for (const achievement of achievementsUnlocked) {
          createAchievementNotification(user.id, achievement.name, achievement.xp_reward).catch(console.error)
        }
      }
    } catch (e) {
      console.error('Failed to process gamification:', e)
    }
  }

  try {
    await supabase.from('activities').insert({
      user_id: user.id,
      type: 'chapter_read',
      series_id: seriesIdResult.data,
      metadata: { 
        chapter_number: chapterResult.data,
        source_id: sourceId 
      }
    })
  } catch (e) {
    console.error('Failed to log activity:', e)
  }

  try {
    const { data: chapter } = await supabase
      .from('chapters')
      .select('id')
      .eq('series_id', seriesIdResult.data)
      .eq('chapter_number', chapterResult.data)
      .eq('deleted_at', null)
      .limit(1)
      .maybeSingle()

    if (chapter) {
        await Promise.all([
          supabase.from('user_chapter_reads_v2').upsert({
            user_id: user.id,
            chapter_id: chapter.id,
            source_used_id: sourceId,
            read_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,chapter_id'
          }),
          supabase.from('user_chapter_reads').upsert({
            user_id: user.id,
            chapter_id: chapter.id,
            read_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id,chapter_id'
          })
        ]).catch(() => {})
      }
  } catch (e) {
    console.error('Failed to record telemetry:', e)
  }

  const { sanitizePrismaObject } = await import('@/lib/utils')

  revalidatePath('/library')
  revalidatePath('/feed')
  revalidatePath(`/series/${seriesIdResult.data}`)
  return { 
    data: sanitizePrismaObject(data), 
    xp_gained: xpGained,
    streak_bonus: streakBonus,
    streak_days: streakDays,
    level_up: levelUp,
    achievements_unlocked: achievementsUnlocked.map(a => ({ name: a.name, xp_reward: a.xp_reward })),
    streak_milestone: streakMilestone,
  }
}

export async function updateStatus(entryId: string, status: string, seriesId: string) {
  const entryIdResult = UUIDSchema.safeParse(entryId)
  if (!entryIdResult.success) {
    return { error: 'Invalid entry ID format' }
  }
  
  const seriesIdResult = UUIDSchema.safeParse(seriesId)
  if (!seriesIdResult.success) {
    return { error: 'Invalid series ID format' }
  }
  
  const statusResult = StatusSchema.safeParse(status)
  if (!statusResult.success) {
    return { error: 'Invalid status. Must be one of: reading, completed, planning, dropped, paused' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  // XP NORMALIZATION: Fetch current status and XP flag to check for idempotency
    const { data: currentEntry } = await supabase
      .from('library_entries')
      .select('status, series_completion_xp_granted')
      .eq('id', entryIdResult.data)
      .eq('user_id', user.id)
      .single()

    const previousStatus = currentEntry?.status
    const isNewCompletion = statusResult.data === 'completed' && previousStatus !== 'completed'

    const { data, error } = await supabase
      .from('library_entries')
      .update({
        status: statusResult.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', entryIdResult.data)
      .eq('user_id', user.id)
      .select()
      .single()

    if (error) {
      return { error: error.message }
    }

    // SYSTEM FIX: Use immutable series_completion_xp_granted flag to prevent XP farming
    // This flag is NEVER reset, even if status changes back to non-completed
    // SEASONAL XP: Update both lifetime_xp and season_xp atomically
    let xpGained = 0
    if (isNewCompletion && !currentEntry?.series_completion_xp_granted) {
      try {
        // Use Prisma to update both xp and season_xp atomically
        const userProfile = await prisma.user.findUnique({
          where: { id: user.id },
          select: { xp: true, season_xp: true, current_season: true }
        })
        
        if (userProfile) {
          const newXp = addXp(userProfile.xp || 0, XP_SERIES_COMPLETED)
          const newLevel = calculateLevel(newXp)
          const seasonUpdate = calculateSeasonXpUpdate(
            userProfile.season_xp,
            userProfile.current_season,
            XP_SERIES_COMPLETED
          )
          
          await prisma.user.update({
            where: { id: user.id },
            data: {
              xp: newXp,
              level: newLevel,
              season_xp: seasonUpdate.season_xp,
              current_season: seasonUpdate.current_season,
            }
          })
          xpGained = XP_SERIES_COMPLETED
        }
      } catch (e) {
        console.error('Failed to award completion XP:', e)
      }
      
      // Set immutable XP flag - this can NEVER be reset
      await supabase
        .from('library_entries')
        .update({ series_completion_xp_granted: true })
        .eq('id', entryIdResult.data)
        .eq('user_id', user.id)
      
      await supabase.from('activities').insert({
        user_id: user.id,
        type: 'series_completed',
        series_id: seriesIdResult.data
      })
    }

  const { sanitizePrismaObject } = await import('@/lib/utils')

  revalidatePath('/library')
  revalidatePath('/feed')
  revalidatePath(`/series/${seriesIdResult.data}`)
  return { 
    data: sanitizePrismaObject(data),
    xp_gained: xpGained
  }
}

export async function updateRating(entryId: string, rating: number) {
  const entryIdResult = UUIDSchema.safeParse(entryId)
  if (!entryIdResult.success) {
    return { error: 'Invalid entry ID format' }
  }
  
  const ratingResult = RatingSchema.safeParse(rating)
  if (!ratingResult.success) {
    return { error: 'Invalid rating. Must be an integer between 1 and 10' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      user_rating: ratingResult.data,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryIdResult.data)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/library')
  return { data }
}

export async function updatePreferredSource(entryId: string, sourceName: string) {
  const entryIdResult = UUIDSchema.safeParse(entryId)
  if (!entryIdResult.success) {
    return { error: 'Invalid entry ID format' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { data, error } = await supabase
    .from('library_entries')
    .update({
      preferred_source: sourceName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', entryIdResult.data)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/library')
  return { data }
}

export async function updateGlobalDefaultSource(sourceName: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return { error: 'Not authenticated' }
  }

  const { error } = await supabase
    .from('users')
    .update({
      default_source: sourceName,
      updated_at: new Date().toISOString(),
    })
    .eq('id', user.id)

  if (error) {
    return { error: error.message }
  }

  revalidatePath('/settings')
  return { success: true }
}
