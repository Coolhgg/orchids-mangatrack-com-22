import { toast } from 'sonner'

export const gamificationToast = {
  xpGain: (amount: number) =>
    toast.success(`+${amount} XP`, { duration: 3000 }),

  streakBonus: (xp: number, days?: number) =>
    toast.success(`+${xp} XP (${days ? `${days}-day ` : ''}Streak)`, { duration: 3000 }),

  achievementUnlocked: (name: string, xp: number) =>
    toast.success(`Achievement Unlocked: ${name} (+${xp} XP)`, { duration: 4000 }),

  levelUp: (level: number) =>
    toast.success(`Level Up! You reached Level ${level}`, { duration: 4000 }),

  streakMilestone: (days: number) =>
    toast.success(`${days}-Day Streak! Keep it up!`, { duration: 4000 }),

  seasonRank: (rank: string) =>
    toast.success(`New Rank: ${rank}`, { duration: 4000 }),
}

export type GamificationEvent = {
  xp_gained?: number | null
  streak_bonus?: number | null
  streak_days?: number | null
  level_up?: number | null
  achievements_unlocked?: Array<{ name: string; xp_reward: number }> | null
  streak_milestone?: number | null
}

/**
 * Smartly displays toasts based on gamification events.
 * Major events (Level Up, Achievements) are always shown.
 * Minor events (Streak Bonus, Base XP) are suppressed if a major event is shown to reduce noise.
 */
export function showGamificationToasts(event: GamificationEvent) {
  let majorEventShown = false

  if (event.level_up) {
    gamificationToast.levelUp(event.level_up)
    majorEventShown = true
  }

  if (event.achievements_unlocked?.length) {
    event.achievements_unlocked.forEach(achievement => {
      gamificationToast.achievementUnlocked(achievement.name, achievement.xp_reward)
    })
    majorEventShown = true
  }

  if (event.streak_milestone) {
    gamificationToast.streakMilestone(event.streak_milestone)
    majorEventShown = true
  }

  // Only show streak bonus/XP if no major event was shown, or if they are significant
  if (!majorEventShown) {
    if (event.streak_bonus && event.streak_bonus > 0) {
      gamificationToast.streakBonus(event.streak_bonus, event.streak_days ?? undefined)
    } else if (event.xp_gained && event.xp_gained > 0) {
      gamificationToast.xpGain(event.xp_gained)
    }
  }
}
