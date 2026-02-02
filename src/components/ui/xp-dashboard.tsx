"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { LevelBadge, SeasonBadge, RankBadge } from "@/components/ui/xp-badges"
import { XpProgressBar, SeasonCountdown, XpStat } from "@/components/ui/xp-progress"
import { 
  Star, 
  Flame, 
  BookOpen, 
  Trophy, 
  Calendar,
  TrendingUp,
  Clock,
  Sparkles,
  ChevronRight
} from "lucide-react"
import { cn } from "@/lib/utils"

type SeasonKey = 'winter' | 'spring' | 'summer' | 'fall'

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
    key: SeasonKey
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

interface XpDashboardProps {
  /** Compact mode for sidebar/header display */
  compact?: boolean
  /** Show only the essential stats */
  minimal?: boolean
  /** Additional class names */
  className?: string
}

function XpDashboardSkeleton({ compact }: { compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <Skeleton className="size-10 rounded-full" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-2 w-full" />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="grid grid-cols-2 gap-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-20" />
      </div>
    </div>
  )
}

/**
 * XP Dashboard Component
 * 
 * Displays user XP progress with:
 * - Current level and progress to next
 * - Seasonal XP with countdown
 * - Lifetime XP
 * - Seasonal leaderboard rank
 * - Activity stats (streak, chapters)
 * 
 * All data is read-only and fetched from API.
 * No XP calculations happen in the frontend.
 */
export function XpDashboard({ compact = false, minimal = false, className }: XpDashboardProps) {
  const [data, setData] = useState<XpProgressData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchXpProgress() {
      try {
        const res = await fetch('/api/users/me/xp-progress')
        if (!res.ok) {
          if (res.status === 401) {
            setError('unauthorized')
            return
          }
          throw new Error('Failed to fetch XP data')
        }
        const json = await res.json()
        setData(json)
      } catch (err) {
        console.error('Failed to fetch XP progress:', err)
        setError('Failed to load XP data')
      } finally {
        setLoading(false)
      }
    }

    fetchXpProgress()
  }, [])

  // Don't render for unauthenticated users
  if (error === 'unauthorized') {
    return null
  }

  if (loading) {
    return <XpDashboardSkeleton compact={compact} />
  }

  if (error || !data) {
    return (
      <div className={cn("text-sm text-muted-foreground", className)}>
        {error || 'Unable to load XP data'}
      </div>
    )
  }

  // Compact mode - for header/sidebar display
  if (compact) {
    return (
      <Link 
        href="/settings" 
        className={cn(
          "flex items-center gap-3 p-2 rounded-xl hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors group",
          className
        )}
      >
        <LevelBadge level={data.level.current} size="lg" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">Level {data.level.current}</span>
            <SeasonBadge 
              seasonKey={data.season.key}
              seasonName={data.season.name}
              year={data.season.year}
              size="sm"
              showYear={false}
            />
          </div>
          <XpProgressBar 
            current={data.level.xp_in_level}
            total={data.level.xp_for_next}
            size="sm"
            className="mt-1"
          />
        </div>
        <ChevronRight className="size-4 text-muted-foreground group-hover:text-foreground transition-colors" />
      </Link>
    )
  }

  // Minimal mode - quick stats only
  if (minimal) {
    return (
      <div className={cn("space-y-4", className)}>
        <div className="flex items-center gap-4">
          <LevelBadge level={data.level.current} size="xl" />
          <div className="flex-1">
            <div className="text-lg font-bold">Level {data.level.current}</div>
            <XpProgressBar 
              current={data.level.xp_in_level}
              total={data.level.xp_for_next}
              showLabel
              size="md"
              className="mt-2"
            />
          </div>
        </div>
        <div className="flex gap-4">
          <XpStat 
            label="Lifetime XP" 
            value={data.xp.lifetime}
            icon={<Star className="size-3" />}
          />
          <XpStat 
            label="Season XP" 
            value={data.xp.seasonal}
            icon={<Sparkles className="size-3" />}
          />
        </div>
      </div>
    )
  }

  // Full dashboard
  return (
    <div className={cn("space-y-6", className)}>
      {/* Level Progress Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <LevelBadge level={data.level.current} size="xl" />
              <div>
                <CardTitle>Level {data.level.current}</CardTitle>
                <CardDescription>
                  {data.level.xp_in_level.toLocaleString()} / {data.level.xp_for_next.toLocaleString()} XP to Level {data.level.current + 1}
                </CardDescription>
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <div className="text-2xl font-bold">{data.xp.lifetime.toLocaleString()}</div>
              <div className="text-xs text-muted-foreground">Lifetime XP</div>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <XpProgressBar 
            current={data.level.xp_in_level}
            total={data.level.xp_for_next}
            size="lg"
            variant="lifetime"
          />
        </CardContent>
      </Card>

      {/* Seasonal XP Card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <SeasonBadge 
                seasonKey={data.season.key}
                seasonName={data.season.name}
                year={data.season.year}
                size="lg"
              />
              <div>
                <CardTitle className="text-base">Seasonal Progress</CardTitle>
                <CardDescription>
                  Resets at the end of {data.season.display_name}
                </CardDescription>
              </div>
            </div>
            <Link 
              href="/leaderboard?category=season"
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Trophy className="size-4" />
              View Rankings
            </Link>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <XpStat 
              label="Season XP" 
              value={data.xp.seasonal}
              icon={<Sparkles className="size-3" />}
              variant="highlight"
            />
            <RankBadge 
              rank={data.rank.seasonal}
              totalParticipants={data.rank.total_participants}
              percentile={data.rank.percentile}
            />
          </div>
          
          <SeasonCountdown 
            daysRemaining={data.season.days_remaining}
            seasonProgress={data.season.progress}
          />

          {data.rank.percentile <= 25 && (
            <div className="flex items-center gap-2 text-sm text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3">
              <TrendingUp className="size-4" />
              <span>
                You're in the top {data.rank.percentile}% this season!
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Activity Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="p-4">
          <XpStat 
            label="Current Streak" 
            value={`${data.stats.streak_days} days`}
            sublabel={data.stats.longest_streak > data.stats.streak_days 
              ? `Best: ${data.stats.longest_streak}` 
              : "Personal best!"
            }
            icon={<Flame className="size-3 text-orange-500" />}
          />
        </Card>
        
        <Card className="p-4">
          <XpStat 
            label="Chapters Read" 
            value={data.stats.chapters_read}
            icon={<BookOpen className="size-3 text-blue-500" />}
          />
        </Card>
        
        <Card className="p-4">
          <XpStat 
            label="Active Days" 
            value={data.stats.active_days}
            icon={<Calendar className="size-3 text-green-500" />}
          />
        </Card>
        
        <Card className="p-4">
          <XpStat 
            label="XP per Day" 
            value={data.stats.active_days > 0 
              ? Math.round(data.xp.lifetime / data.stats.active_days) 
              : 0
            }
            icon={<Clock className="size-3 text-purple-500" />}
          />
        </Card>
      </div>

      {/* Info about XP system */}
      <div className="text-xs text-muted-foreground space-y-1 px-1">
        <p>
          <strong>Seasonal XP</strong> resets each anime season (quarterly). 
          Compete on seasonal leaderboards!
        </p>
        <p>
          <strong>Lifetime XP</strong> never resets - your permanent achievement record.
        </p>
      </div>
    </div>
  )
}

/**
 * Compact XP display for headers/nav
 */
export function XpCompactDisplay({ className }: { className?: string }) {
  return <XpDashboard compact className={className} />
}

/**
 * Mini XP widget for profile cards
 */
export function XpMiniWidget({ className }: { className?: string }) {
  return <XpDashboard minimal className={className} />
}
