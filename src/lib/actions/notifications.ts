'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type GamificationNotificationType =
  | 'achievement'
  | 'level_up'
  | 'streak_milestone'
  | 'season_rank'
  | 'season_ending'

export interface CreateGamificationNotificationParams {
  userId: string
  type: GamificationNotificationType
  title: string
  message: string
  metadata?: Record<string, unknown>
  priority?: number
}

export async function createGamificationNotification(
  params: CreateGamificationNotificationParams
) {
  const supabase = await createClient()

  const { error } = await supabase.from('notifications').insert({
    user_id: params.userId,
    type: params.type,
    title: params.title,
    message: params.message,
    metadata: params.metadata || {},
    priority: params.priority ?? (params.type === 'season_ending' ? 1 : 2),
  })

  if (error) {
    console.error('Failed to create gamification notification:', error)
    return { error }
  }

  return { success: true }
}

export async function createAchievementNotification(
  userId: string,
  achievementName: string,
  xpReward: number
) {
  return createGamificationNotification({
    userId,
    type: 'achievement',
    title: 'Achievement Unlocked!',
    message: `You earned "${achievementName}" (+${xpReward} XP)`,
    metadata: { achievement_name: achievementName, xp_reward: xpReward },
  })
}

export async function createLevelUpNotification(userId: string, newLevel: number) {
  return createGamificationNotification({
    userId,
    type: 'level_up',
    title: 'Level Up!',
    message: `Congratulations! You reached Level ${newLevel}`,
    metadata: { level: newLevel },
  })
}

export async function createStreakMilestoneNotification(userId: string, days: number) {
  return createGamificationNotification({
    userId,
    type: 'streak_milestone',
    title: `${days}-Day Streak!`,
    message: `Amazing! You've maintained a ${days}-day reading streak!`,
    metadata: { streak_days: days },
  })
}

export async function createSeasonRankNotification(userId: string, rank: string, season: string) {
  return createGamificationNotification({
    userId,
    type: 'season_rank',
    title: 'New Rank Achieved!',
    message: `You've reached ${rank} rank in ${season}`,
    metadata: { rank, season },
  })
}

export async function createSeasonEndingNotification(userId: string, daysLeft: number, season: string) {
  return createGamificationNotification({
    userId,
    type: 'season_ending',
    title: 'Season Ending Soon',
    message: `Only ${daysLeft} days left in ${season}! Make your final push!`,
    metadata: { days_left: daysLeft, season },
    priority: 1,
  })
}

export async function markAllNotificationsAsRead() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return
  }

  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null)

  revalidatePath('/notifications')
}

export async function markNotificationAsRead(notificationId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  
  if (!user) {
    return
  }

  await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
    .eq('user_id', user.id)

  revalidatePath('/notifications')
}
