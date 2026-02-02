"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { 
  Star, 
  Flame, 
  BookOpen, 
  Calendar, 
  Trophy,
  TrendingUp,
  Sparkles,
  Snowflake,
  Sun,
  Leaf,
  CloudSun,
  Clock,
  ChevronRight,
  Zap,
  RefreshCw,
  AlertCircle,
  Target
} from "lucide-react"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { AchievementCard } from "@/components/ui/achievement-card"
import type { AchievementProgress } from "@/lib/gamification/achievement-progress"

interface XpProgressData {
  level: {
    current: number
    xp_in_level: number
    xp_for_next: number
    progress: number
    next_level_total_xp: number
  }
  xp: {
    lifetime: number
    seasonal: number
  }
  season: {
    code: string
    key: 'winter' | 'spring' | 'summer' | 'fall'
    name: string
    year: number
    display_name: string
    days_remaining: number
    progress: number
    starts_at: string
    ends_at: string
  }
  rank: {
    seasonal: number
    total_participants: number
    percentile: number
  }
  stats: {
    streak_days: number
    longest_streak: number
    chapters_read: number
    active_days: number
  }
}

const SEASON_STYLES = {
  winter: { 
    icon: Snowflake, 
    color: 'text-sky-400', 
    bg: 'bg-sky-50 dark:bg-sky-950/30',
    gradient: 'from-sky-500 to-indigo-600',
    accent: 'sky'
  },
  spring: { 
    icon: Leaf, 
    color: 'text-pink-400', 
    bg: 'bg-pink-50 dark:bg-pink-950/30',
    gradient: 'from-pink-500 to-rose-600',
    accent: 'pink'
  },
  summer: { 
    icon: Sun, 
    color: 'text-amber-400', 
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    gradient: 'from-amber-500 to-orange-600',
    accent: 'amber'
  },
  fall: { 
    icon: CloudSun, 
    color: 'text-orange-400', 
    bg: 'bg-orange-50 dark:bg-orange-950/30',
    gradient: 'from-orange-500 to-red-600',
    accent: 'orange'
  },
}

const LEVEL_BADGES = [
  { level: 1, name: 'Novice', color: 'bg-zinc-400' },
  { level: 5, name: 'Reader', color: 'bg-green-500' },
  { level: 10, name: 'Enthusiast', color: 'bg-blue-500' },
  { level: 25, name: 'Dedicated', color: 'bg-purple-500' },
  { level: 50, name: 'Expert', color: 'bg-amber-500' },
  { level: 100, name: 'Master', color: 'bg-rose-500' },
  { level: 200, name: 'Legend', color: 'bg-gradient-to-r from-amber-400 to-orange-500' },
]

function getBadgeForLevel(level: number) {
  for (let i = LEVEL_BADGES.length - 1; i >= 0; i--) {
    if (level >= LEVEL_BADGES[i].level) {
      return LEVEL_BADGES[i]
    }
  }
  return LEVEL_BADGES[0]
}

function getNextBadge(level: number) {
  for (const badge of LEVEL_BADGES) {
    if (badge.level > level) {
      return badge
    }
  }
  return null
}

function formatCountdown(days: number) {
  if (days <= 0) return 'Season ending soon'
  if (days === 1) return '1 day left'
  if (days < 7) return `${days} days left`
  const weeks = Math.floor(days / 7)
  const remainingDays = days % 7
  if (remainingDays === 0) return `${weeks} week${weeks > 1 ? 's' : ''} left`
  return `${weeks}w ${remainingDays}d left`
}

function ProgressSkeleton() {
  return (
    <div className="p-6 md:p-12 space-y-8 max-w-5xl mx-auto">
      <div className="text-center space-y-4">
        <Skeleton className="size-20 rounded-full mx-auto" />
        <Skeleton className="h-8 w-48 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
      </div>
      <div className="grid md:grid-cols-2 gap-6">
        <Skeleton className="h-64 rounded-3xl" />
        <Skeleton className="h-64 rounded-3xl" />
      </div>
      <div className="grid md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Skeleton key={i} className="h-32 rounded-2xl" />
        ))}
      </div>
    </div>
  )
}

interface NextUpAchievementsData {
  achievements: AchievementProgress[]
  stats: {
    unlockedCount: number
    totalVisible: number
  }
}

export default function ProgressPage() {
  const [data, setData] = useState<XpProgressData | null>(null)
  const [nextUpData, setNextUpData] = useState<NextUpAchievementsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchProgress = useCallback(async (isRetry = false) => {
    if (isRetry) {
      setRetrying(true)
      setError(null)
    }
    
    try {
      const [progressRes, achievementsRes] = await Promise.all([
        fetch('/api/users/me/xp-progress'),
        fetch('/api/users/me/achievements?view=next_up&limit=4')
      ])
      
      if (!progressRes.ok) {
        if (progressRes.status === 401) {
          setError('Please sign in to view your progress')
          return
        }
        if (progressRes.status === 429) {
          setError('Too many requests. Please wait a moment.')
          return
        }
        if (progressRes.status === 503) {
          setError('Service temporarily unavailable. Please try again.')
          return
        }
        if (progressRes.status === 404) {
          setError('User profile not found')
          return
        }
        throw new Error(`Failed to fetch progress (${progressRes.status})`)
      }
      
      const progressJson = await progressRes.json()
      
      if (!progressJson.level || !progressJson.xp || !progressJson.season || !progressJson.rank || !progressJson.stats) {
        throw new Error('Invalid response format')
      }
      
      setData(progressJson)
      
      if (achievementsRes.ok) {
        const achievementsJson = await achievementsRes.json()
        setNextUpData(achievementsJson)
      }
      
      setError(null)
    } catch (err) {
      console.error('Failed to fetch XP progress:', err)
      setError('Unable to load progress data. Please try again.')
    } finally {
      setLoading(false)
      setRetrying(false)
    }
  }, [])

  useEffect(() => {
    fetchProgress()
  }, [fetchProgress])

  if (loading) return <ProgressSkeleton />

  if (error || !data) {
    const isAuthError = error?.includes('sign in')
    const isRateLimitError = error?.includes('Too many')
    
    return (
      <div className="p-6 md:p-12 flex flex-col items-center justify-center min-h-[60vh] text-center space-y-4">
        <div className={`size-20 rounded-full flex items-center justify-center ${
          isAuthError ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-zinc-100 dark:bg-zinc-900'
        }`}>
          {isAuthError ? (
            <AlertCircle className="size-10 text-amber-500" />
          ) : (
            <Star className="size-10 text-zinc-300" />
          )}
        </div>
        <h2 className="text-xl font-bold">{error || 'Unable to load progress'}</h2>
        <p className="text-zinc-500 max-w-sm">
          {isAuthError 
            ? 'Sign in to track your reading journey with XP, levels, and seasonal achievements.'
            : 'Track your reading journey with XP, levels, and seasonal achievements.'}
        </p>
        {isAuthError ? (
          <Button asChild>
            <Link href="/login">Sign In</Link>
          </Button>
        ) : (
          <Button 
            onClick={() => fetchProgress(true)} 
            variant="outline"
            disabled={retrying || isRateLimitError}
          >
            {retrying ? (
              <>
                <RefreshCw className="size-4 mr-2 animate-spin" />
                Retrying...
              </>
            ) : (
              'Try Again'
            )}
          </Button>
        )}
      </div>
    )
  }

  const seasonStyle = SEASON_STYLES[data.season.key] || SEASON_STYLES.winter
  const SeasonIcon = seasonStyle.icon
  const currentBadge = getBadgeForLevel(data.level.current)
  const nextBadge = getNextBadge(data.level.current)

  return (
    <div className="p-6 md:p-12 space-y-10 max-w-5xl mx-auto pb-24">
      {/* Header with Level */}
      <div className="text-center space-y-6">
        <div className="relative inline-block">
          <div className={`size-28 md:size-32 rounded-full ${currentBadge.color} flex items-center justify-center shadow-2xl`}>
            <span className="text-4xl md:text-5xl font-black text-white">{data.level.current}</span>
          </div>
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 px-4 py-1 bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 rounded-full text-xs font-bold uppercase tracking-wider">
            {currentBadge.name}
          </div>
        </div>
        
        <div className="space-y-2">
          <h1 className="text-3xl md:text-4xl font-black tracking-tight">Level {data.level.current}</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            {data.xp.lifetime.toLocaleString()} lifetime XP
          </p>
        </div>

        {/* Level Progress Bar */}
        <div className="max-w-md mx-auto space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-zinc-500">Level {data.level.current}</span>
            <span className="text-zinc-500">Level {data.level.current + 1}</span>
          </div>
          <div className="relative">
            <Progress value={data.level.progress} className="h-4 bg-zinc-200 dark:bg-zinc-800" />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] font-bold text-zinc-600 dark:text-zinc-300 drop-shadow">
                {data.level.xp_in_level.toLocaleString()} / {data.level.xp_for_next.toLocaleString()} XP
              </span>
            </div>
          </div>
          {nextBadge && (
            <p className="text-xs text-zinc-400">
              {nextBadge.level - data.level.current} levels to {nextBadge.name} badge
            </p>
          )}
        </div>
      </div>

      {/* XP Cards */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Seasonal XP Card */}
        <div className={`${seasonStyle.bg} rounded-3xl p-6 border border-zinc-200/50 dark:border-zinc-800/50 space-y-6`}>
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <SeasonIcon className={`size-5 ${seasonStyle.color}`} />
                <h2 className="text-lg font-bold">{data.season.display_name}</h2>
              </div>
              <p className="text-sm text-zinc-500">Seasonal XP (resets quarterly)</p>
            </div>
            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/80 dark:bg-zinc-900/80 text-xs font-medium ${seasonStyle.color}`}>
              <Clock className="size-3" />
              {formatCountdown(data.season.days_remaining)}
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <span className={`text-5xl font-black bg-gradient-to-r ${seasonStyle.gradient} bg-clip-text text-transparent`}>
                {data.xp.seasonal.toLocaleString()}
              </span>
              <span className="text-zinc-400 text-lg mb-1">XP</span>
            </div>

            {/* Season Progress */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-zinc-500">
                <span>Season Progress</span>
                <span>{data.season.progress}%</span>
              </div>
              <Progress 
                value={data.season.progress} 
                className="h-2 bg-white/50 dark:bg-zinc-800/50" 
              />
            </div>

            {/* Seasonal Rank */}
            <div className="flex items-center justify-between pt-4 border-t border-zinc-200/50 dark:border-zinc-700/50">
              <div className="flex items-center gap-2">
                <Trophy className="size-4 text-amber-500" />
                <span className="text-sm font-medium">Season Rank</span>
              </div>
              <div className="text-right">
                <span className="text-2xl font-black">#{data.rank.seasonal}</span>
                <span className="text-xs text-zinc-500 block">
                  Top {data.rank.percentile}% of {data.rank.total_participants.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <Link 
            href="/leaderboard?category=season" 
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-white/80 dark:bg-zinc-900/80 text-sm font-medium hover:bg-white dark:hover:bg-zinc-900 transition-colors"
          >
            View Season Leaderboard
            <ChevronRight className="size-4" />
          </Link>
        </div>

        {/* Lifetime XP Card */}
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800 space-y-6">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Star className="size-5 text-amber-500" />
              <h2 className="text-lg font-bold">Lifetime XP</h2>
            </div>
            <p className="text-sm text-zinc-500">Permanent progress (never resets)</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-end gap-2">
              <span className="text-5xl font-black">
                {data.xp.lifetime.toLocaleString()}
              </span>
              <span className="text-zinc-400 text-lg mb-1">XP</span>
            </div>

            {/* XP Breakdown */}
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-white dark:bg-zinc-800 rounded-xl p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <BookOpen className="size-3" />
                  Chapters
                </div>
                <p className="font-bold">{data.stats.chapters_read.toLocaleString()}</p>
              </div>
              <div className="bg-white dark:bg-zinc-800 rounded-xl p-3 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                  <Calendar className="size-3" />
                  Active Days
                </div>
                <p className="font-bold">{data.stats.active_days}</p>
              </div>
            </div>

            {/* Average XP per Day */}
            <div className="flex items-center justify-between pt-4 border-t border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-violet-500" />
                <span className="text-sm font-medium">XP per Day</span>
              </div>
              <span className="text-2xl font-black">
                {data.stats.active_days > 0 
                  ? (data.xp.lifetime / data.stats.active_days).toFixed(1) 
                  : '0'}
              </span>
            </div>
          </div>

          <Link 
            href="/leaderboard?category=xp" 
            className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-zinc-200 dark:bg-zinc-800 text-sm font-medium hover:bg-zinc-300 dark:hover:bg-zinc-700 transition-colors"
          >
            View All-Time Leaderboard
            <ChevronRight className="size-4" />
          </Link>
        </div>
      </div>

{/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gradient-to-br from-orange-500 to-red-600 rounded-2xl p-5 text-white space-y-3">
            <Flame className="size-6" />
            <div>
              <p className="text-3xl font-black">{data.stats.streak_days}</p>
              <p className="text-sm opacity-80">Day Streak</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-violet-500 to-purple-600 rounded-2xl p-5 text-white space-y-3">
            <TrendingUp className="size-6" />
            <div>
              <p className="text-3xl font-black">{data.stats.longest_streak}</p>
              <p className="text-sm opacity-80">Best Streak</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl p-5 text-white space-y-3">
            <BookOpen className="size-6" />
            <div>
              <p className="text-3xl font-black">{data.stats.chapters_read.toLocaleString()}</p>
              <p className="text-sm opacity-80">Chapters Read</p>
            </div>
          </div>

          <div className="bg-gradient-to-br from-blue-500 to-indigo-600 rounded-2xl p-5 text-white space-y-3">
            <Sparkles className="size-6" />
            <div>
              <p className="text-3xl font-black">
                {data.rank.total_participants > 0 
                  ? `Top ${data.rank.percentile}%` 
                  : '—'}
              </p>
              <p className="text-sm opacity-80">This Season</p>
            </div>
          </div>
        </div>

        {/* Next Up Achievements */}
        {nextUpData && nextUpData.achievements.length > 0 && (
          <div className="bg-gradient-to-br from-violet-50 to-purple-50 dark:from-violet-950/30 dark:to-purple-950/30 rounded-3xl p-6 border border-violet-200/50 dark:border-violet-800/50">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-violet-500 flex items-center justify-center">
                  <Target className="size-5 text-white" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Next Up</h3>
                  <p className="text-sm text-zinc-500">Achievements you&apos;re closest to unlocking</p>
                </div>
              </div>
              <Link 
                href="/users/me?tab=achievements"
                className="text-sm font-medium text-violet-600 dark:text-violet-400 hover:underline flex items-center gap-1"
              >
                View All
                <ChevronRight className="size-4" />
              </Link>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {nextUpData.achievements.map((achievement) => (
                <AchievementCard
                  key={achievement.achievementId}
                  progress={achievement}
                  size="md"
                  showTooltip={true}
                />
              ))}
            </div>
            
            {nextUpData.stats && (
              <div className="mt-4 pt-4 border-t border-violet-200/50 dark:border-violet-700/50 flex items-center justify-center gap-6 text-sm">
                <div className="flex items-center gap-2">
                  <Trophy className="size-4 text-amber-500" />
                  <span className="text-zinc-600 dark:text-zinc-400">
                    <span className="font-bold text-zinc-900 dark:text-zinc-100">{nextUpData.stats.unlockedCount}</span> unlocked
                  </span>
                </div>
                <div className="w-px h-4 bg-zinc-300 dark:bg-zinc-700" />
                <div className="text-zinc-500">
                  {nextUpData.stats.totalVisible - nextUpData.stats.unlockedCount} more to discover
                </div>
              </div>
            )}
          </div>
        )}

        {/* How XP Works */}
      <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl p-6 border border-zinc-200 dark:border-zinc-800">
        <h3 className="font-bold text-lg mb-4">How XP Works</h3>
        <div className="grid md:grid-cols-2 gap-6 text-sm text-zinc-600 dark:text-zinc-400">
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="size-6 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <BookOpen className="size-3 text-green-600" />
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">+1 XP per chapter</p>
                <p>Mark chapters as read to earn XP</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="size-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Flame className="size-3 text-amber-600" />
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">+5 XP streak bonus</p>
                <p>Read every day to build streaks</p>
              </div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="flex items-start gap-3">
              <div className="size-6 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <Star className="size-3 text-purple-600" />
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">+100 XP series complete</p>
                <p>Finish a series for a big bonus</p>
              </div>
            </div>
            <div className="flex items-start gap-3">
              <div className="size-6 rounded-full bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center flex-shrink-0 mt-0.5">
                <SeasonIcon className="size-3 text-sky-600" />
              </div>
              <div>
                <p className="font-medium text-zinc-900 dark:text-zinc-100">Seasonal resets quarterly</p>
                <p>Compete fresh each anime season</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
