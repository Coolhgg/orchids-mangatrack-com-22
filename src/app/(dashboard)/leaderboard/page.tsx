"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Trophy, Medal, Crown, Star, Calendar, Flame, BookOpen, Zap, ChevronDown, Snowflake, Sun, Leaf, CloudSun } from "lucide-react"
import Link from "next/link"
import { Skeleton } from "@/components/ui/skeleton"

interface LeaderboardUser {
  username: string
  avatar_url: string | null
  xp: number
  level: number
  streak_days?: number
  chapters_read?: number
  active_days?: number
  normalized_xp?: number
  season_xp?: number
  current_season?: string
}

interface LeaderboardResponse {
  users: LeaderboardUser[]
  category: string
  period: string
  total: number
  // Seasonal context
  season?: string
  season_display?: string
  season_key?: 'winter' | 'spring' | 'summer' | 'fall'
  season_name?: string
  season_year?: number
  days_remaining?: number
  available_seasons?: string[]
  current_season?: string
}

type TimePeriod = "weekly" | "monthly" | "all-time"
type Category = "xp" | "streak" | "chapters" | "efficiency" | "season"

// Season icons and colors for anime-style display
const SEASON_STYLES = {
  winter: { icon: Snowflake, color: 'text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
  spring: { icon: Leaf, color: 'text-pink-400', bg: 'bg-pink-50 dark:bg-pink-900/20' },
  summer: { icon: Sun, color: 'text-orange-400', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  fall: { icon: CloudSun, color: 'text-amber-500', bg: 'bg-amber-50 dark:bg-amber-900/20' },
}

function LeaderboardSkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4 items-end pt-12 pb-8">
        <div className="flex flex-col items-center space-y-4">
          <Skeleton className="size-20 rounded-3xl" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-24 w-full rounded-t-2xl" />
        </div>
        <div className="flex flex-col items-center space-y-4">
          <Skeleton className="size-28 rounded-3xl" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-32 w-full rounded-t-2xl" />
        </div>
        <div className="flex flex-col items-center space-y-4">
          <Skeleton className="size-20 rounded-3xl" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-20 w-full rounded-t-2xl" />
        </div>
      </div>
      <div className="space-y-2">
        {[...Array(7)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  )
}

/**
 * Convert season code to anime-style display name
 * "2026-Q1" -> "Winter 2026"
 * "2026-Q2" -> "Spring 2026"
 * etc.
 */
function getSeasonLabel(season: string): string {
  // New quarterly format: YYYY-Q[1-4]
  const quarterMatch = season.match(/^(\d{4})-Q([1-4])$/)
  if (quarterMatch) {
    const year = quarterMatch[1]
    const quarter = parseInt(quarterMatch[2], 10)
    const seasonNames = ['Winter', 'Spring', 'Summer', 'Fall']
    return `${seasonNames[quarter - 1]} ${year}`
  }
  
  // Legacy monthly format: YYYY-MM (convert to quarter name)
  const monthMatch = season.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const year = monthMatch[1]
    const month = parseInt(monthMatch[2], 10)
    let seasonName: string
    if (month >= 1 && month <= 3) seasonName = 'Winter'
    else if (month >= 4 && month <= 6) seasonName = 'Spring'
    else if (month >= 7 && month <= 9) seasonName = 'Summer'
    else seasonName = 'Fall'
    return `${seasonName} ${year}`
  }
  
  return season
}

/**
 * Get season key from season code for styling
 */
function getSeasonKey(season: string): 'winter' | 'spring' | 'summer' | 'fall' {
  const quarterMatch = season.match(/^(\d{4})-Q([1-4])$/)
  if (quarterMatch) {
    const quarter = parseInt(quarterMatch[2], 10)
    return ['winter', 'spring', 'summer', 'fall'][quarter - 1] as any
  }
  
  const monthMatch = season.match(/^(\d{4})-(\d{2})$/)
  if (monthMatch) {
    const month = parseInt(monthMatch[2], 10)
    if (month >= 1 && month <= 3) return 'winter'
    if (month >= 4 && month <= 6) return 'spring'
    if (month >= 7 && month <= 9) return 'summer'
    return 'fall'
  }
  
  return 'winter'
}

export default function LeaderboardPage() {
  const [users, setUsers] = useState<LeaderboardUser[]>([])
  const [loading, setLoading] = useState(true)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("all-time")
  const [category, setCategory] = useState<Category>("xp")
  const [selectedSeason, setSelectedSeason] = useState<string>("")
  const [availableSeasons, setAvailableSeasons] = useState<string[]>([])
  const [showSeasonDropdown, setShowSeasonDropdown] = useState(false)
  const [seasonInfo, setSeasonInfo] = useState<{
    display: string
    key: 'winter' | 'spring' | 'summer' | 'fall'
    daysRemaining: number
  } | null>(null)

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      params.set("period", timePeriod)
      params.set("category", category)
      params.set("limit", "50")
      if (category === "season" && selectedSeason) {
        params.set("season", selectedSeason)
      }

      const res = await fetch(`/api/leaderboard?${params.toString()}`)
      if (res.ok) {
        const data: LeaderboardResponse = await res.json()
        setUsers(data.users || [])
        
        // Update season info from API
        if (data.available_seasons) {
          setAvailableSeasons(data.available_seasons)
        }
        if (data.current_season && !selectedSeason) {
          setSelectedSeason(data.current_season)
        }
        if (data.season_display) {
          setSeasonInfo({
            display: data.season_display,
            key: data.season_key || getSeasonKey(data.season || ''),
            daysRemaining: data.days_remaining || 0
          })
        }
      }
    } catch (error) {
      console.error("Failed to fetch leaderboard:", error)
    } finally {
      setLoading(false)
    }
  }, [timePeriod, category, selectedSeason])

  useEffect(() => {
    fetchLeaderboard()
  }, [fetchLeaderboard])

  const getCategoryLabel = () => {
    switch (category) {
      case "xp": return "Lifetime XP"
      case "streak": return "Streak"
      case "chapters": return "Chapters"
      case "efficiency": return "XP/Day"
      case "season": return "Season XP"
    }
  }

  const getCategoryValue = (user: LeaderboardUser) => {
    switch (category) {
      case "xp": return user.xp.toLocaleString()
      case "streak": return `${user.streak_days || 0} days`
      case "chapters": return (user.chapters_read || 0).toLocaleString()
      case "efficiency": return `${(user.normalized_xp || 0).toFixed(1)}`
      case "season": return (user.season_xp || 0).toLocaleString()
    }
  }

  // Get season styling
  const currentSeasonStyle = seasonInfo ? SEASON_STYLES[seasonInfo.key] : SEASON_STYLES.winter
  const SeasonIcon = currentSeasonStyle.icon

  return (
    <div className="p-6 md:p-12 space-y-12 max-w-4xl mx-auto pb-24">
      <div className="text-center space-y-4">
        <div className="size-16 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center mx-auto text-yellow-600 dark:text-yellow-500">
          <Trophy className="size-8" />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-zinc-900 dark:text-zinc-50">Global Leaderboard</h1>
        <p className="text-zinc-500 dark:text-zinc-400">The most dedicated readers in the MangaTrack community</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 justify-center">
        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800">
          <Button
            variant={timePeriod === "weekly" ? "default" : "ghost"}
            size="sm"
            className="rounded-xl"
            onClick={() => setTimePeriod("weekly")}
          >
            <Calendar className="size-4 mr-2" />
            This Week
          </Button>
          <Button
            variant={timePeriod === "monthly" ? "default" : "ghost"}
            size="sm"
            className="rounded-xl"
            onClick={() => setTimePeriod("monthly")}
          >
            This Month
          </Button>
          <Button
            variant={timePeriod === "all-time" ? "default" : "ghost"}
            size="sm"
            className="rounded-xl"
            onClick={() => setTimePeriod("all-time")}
          >
            All Time
          </Button>
        </div>

        <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-2xl border border-zinc-200 dark:border-zinc-800 flex-wrap">
            <Button
              variant={category === "xp" ? "default" : "ghost"}
              size="sm"
              className="rounded-xl"
              onClick={() => setCategory("xp")}
            >
              <Star className="size-4 mr-2" />
              Lifetime
            </Button>
            <div className="relative">
              <Button
                variant={category === "season" ? "default" : "ghost"}
                size="sm"
                className="rounded-xl"
                onClick={() => {
                  setCategory("season")
                  setShowSeasonDropdown(!showSeasonDropdown)
                }}
                title="Quarterly anime season leaderboard - resets each season"
              >
                <SeasonIcon className={`size-4 mr-2 ${category === "season" ? "" : currentSeasonStyle.color}`} />
                Season
                <ChevronDown className="size-3 ml-1" />
              </Button>
              {showSeasonDropdown && category === "season" && availableSeasons.length > 0 && (
                <div className="absolute top-full mt-2 left-0 z-50 bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-lg py-1 min-w-[180px]">
                  {availableSeasons.map((season) => {
                    const seasonKey = getSeasonKey(season)
                    const style = SEASON_STYLES[seasonKey]
                    const Icon = style.icon
                    return (
                      <button
                        key={season}
                        className={`w-full px-4 py-2 text-left text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800 flex items-center gap-2 ${
                          selectedSeason === season ? 'bg-zinc-100 dark:bg-zinc-800 font-semibold' : ''
                        }`}
                        onClick={() => {
                          setSelectedSeason(season)
                          setShowSeasonDropdown(false)
                        }}
                      >
                        <Icon className={`size-4 ${style.color}`} />
                        {getSeasonLabel(season)}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            <Button
              variant={category === "efficiency" ? "default" : "ghost"}
              size="sm"
              className="rounded-xl"
              onClick={() => setCategory("efficiency")}
              title="XP per active day - rewards consistent reading"
            >
              <Zap className="size-4 mr-2" />
              Efficiency
            </Button>
            <Button
              variant={category === "streak" ? "default" : "ghost"}
              size="sm"
              className="rounded-xl"
              onClick={() => setCategory("streak")}
            >
              <Flame className="size-4 mr-2" />
              Streak
            </Button>
            <Button
              variant={category === "chapters" ? "default" : "ghost"}
              size="sm"
              className="rounded-xl"
              onClick={() => setCategory("chapters")}
            >
              <BookOpen className="size-4 mr-2" />
              Chapters
            </Button>
          </div>
      </div>

      {/* Anime-style season banner */}
      {category === "season" && seasonInfo && (
        <div className="text-center space-y-2">
          <div className={`inline-flex items-center gap-3 px-6 py-3 ${currentSeasonStyle.bg} rounded-2xl`}>
            <SeasonIcon className={`size-6 ${currentSeasonStyle.color}`} />
            <div className="text-left">
              <div className={`font-bold ${currentSeasonStyle.color}`}>{seasonInfo.display} Season</div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {seasonInfo.daysRemaining > 0 
                  ? `${seasonInfo.daysRemaining} days remaining`
                  : 'Season ended'
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <LeaderboardSkeleton />
      ) : users.length >= 3 ? (
        <>
          <div className="grid grid-cols-3 gap-4 items-end pt-12 pb-8">
            <div className="flex flex-col items-center space-y-4">
              <Link href={`/users/${users[1].username}`} className="group">
                <div className="relative">
                  <div className="size-20 md:size-24 rounded-3xl bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                    {users[1].avatar_url ? (
                      <img src={users[1].avatar_url} className="h-full w-full object-cover" alt="" />
                    ) : (
                      <span className="text-2xl font-bold text-zinc-400 uppercase">{users[1].username[0]}</span>
                    )}
                  </div>
                  <div className="absolute -top-3 -right-3 size-8 rounded-full bg-zinc-300 dark:bg-zinc-600 flex items-center justify-center border-4 border-white dark:border-zinc-950">
                    <Medal className="size-4 text-white" />
                  </div>
                </div>
              </Link>
              <div className="text-center">
                <p className="font-bold text-sm truncate max-w-[100px]">{users[1].username}</p>
                <p className="text-xs text-zinc-500">{getCategoryValue(users[1])}</p>
              </div>
              <div className="w-full h-24 bg-zinc-100 dark:bg-zinc-900 rounded-t-2xl border-x border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-center font-black text-2xl text-zinc-300">2</div>
            </div>

            <div className="flex flex-col items-center space-y-4">
              <Link href={`/users/${users[0].username}`} className="group">
                <div className="relative">
                  <div className="size-24 md:size-32 rounded-3xl bg-zinc-900 dark:bg-zinc-50 border-4 border-white dark:border-zinc-950 shadow-2xl flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                    {users[0].avatar_url ? (
                      <img src={users[0].avatar_url} className="h-full w-full object-cover" alt="" />
                    ) : (
                      <span className="text-4xl font-black text-zinc-500 dark:text-zinc-400 uppercase">{users[0].username[0]}</span>
                    )}
                  </div>
                  <div className="absolute -top-4 -right-4 size-10 rounded-full bg-yellow-500 flex items-center justify-center border-4 border-white dark:border-zinc-950">
                    <Crown className="size-5 text-white fill-white" />
                  </div>
                </div>
              </Link>
              <div className="text-center">
                <p className="font-bold text-lg truncate max-w-[120px]">{users[0].username}</p>
                <p className="text-xs font-bold text-yellow-600 uppercase tracking-widest">{getCategoryValue(users[0])}</p>
              </div>
              <div className="w-full h-32 bg-zinc-900 dark:bg-zinc-50 rounded-t-2xl flex items-center justify-center font-black text-4xl text-white dark:text-zinc-900 shadow-xl">1</div>
            </div>

            <div className="flex flex-col items-center space-y-4">
              <Link href={`/users/${users[2].username}`} className="group">
                <div className="relative">
                  <div className="size-20 md:size-24 rounded-3xl bg-zinc-100 dark:bg-zinc-800 border-2 border-zinc-200 dark:border-zinc-700 flex items-center justify-center overflow-hidden group-hover:scale-105 transition-transform">
                    {users[2].avatar_url ? (
                      <img src={users[2].avatar_url} className="h-full w-full object-cover" alt="" />
                    ) : (
                      <span className="text-2xl font-bold text-zinc-400 uppercase">{users[2].username[0]}</span>
                    )}
                  </div>
                  <div className="absolute -top-3 -right-3 size-8 rounded-full bg-orange-400 dark:bg-orange-700 flex items-center justify-center border-4 border-white dark:border-zinc-950">
                    <Medal className="size-4 text-white" />
                  </div>
                </div>
              </Link>
              <div className="text-center">
                <p className="font-bold text-sm truncate max-w-[100px]">{users[2].username}</p>
                <p className="text-xs text-zinc-500">{getCategoryValue(users[2])}</p>
              </div>
              <div className="w-full h-20 bg-zinc-100 dark:bg-zinc-900 rounded-t-2xl border-x border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-center font-black text-2xl text-zinc-300">3</div>
            </div>
          </div>

          <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            <div className="p-4 border-b border-zinc-100 dark:border-zinc-800 bg-white/50 dark:bg-zinc-950/50 grid grid-cols-12 gap-4 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
              <div className="col-span-1 text-center">Rank</div>
              <div className="col-span-7 pl-4">User</div>
              <div className="col-span-2 text-right">Level</div>
              <div className="col-span-2 text-right pr-4">{getCategoryLabel()}</div>
            </div>
            <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {users.slice(3).map((user, i) => (
                <Link 
                  key={user.username} 
                  href={`/users/${user.username}`}
                  className="p-4 grid grid-cols-12 gap-4 items-center hover:bg-white dark:hover:bg-zinc-950 transition-colors"
                >
                  <div className="col-span-1 text-center font-bold text-zinc-400">{i + 4}</div>
                  <div className="col-span-7 flex items-center gap-3 pl-4">
                    <div className="size-8 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center text-xs font-bold text-zinc-500 uppercase overflow-hidden">
                      {user.avatar_url ? (
                        <img src={user.avatar_url} className="h-full w-full object-cover" alt="" />
                      ) : (
                        user.username[0]
                      )}
                    </div>
                    <span className="font-bold text-sm">{user.username}</span>
                  </div>
                  <div className="col-span-2 text-right font-medium text-sm">{user.level || 1}</div>
                  <div className="col-span-2 text-right pr-4 font-black text-sm text-blue-500">{getCategoryValue(user)}</div>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : users.length > 0 ? (
        <div className="bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
          <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {users.map((user, i) => (
              <Link 
                key={user.username} 
                href={`/users/${user.username}`}
                className="p-4 flex items-center gap-4 hover:bg-white dark:hover:bg-zinc-950 transition-colors"
              >
                <div className="text-center font-bold text-zinc-400 w-8">{i + 1}</div>
                <div className="size-10 rounded-lg bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                  {user.avatar_url ? (
                    <img src={user.avatar_url} className="h-full w-full object-cover" alt="" />
                  ) : (
                    <span className="font-bold text-zinc-500">{user.username[0]}</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-bold text-sm">{user.username}</p>
                  <p className="text-xs text-zinc-500">Level {user.level || 1}</p>
                </div>
                <div className="font-black text-blue-500">{getCategoryValue(user)}</div>
              </Link>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <Trophy className="size-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">No data yet</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              {category === "season" 
                ? "No activity this season yet. Start reading to climb the seasonal rankings!"
                : "Start reading and earning XP to appear on the leaderboard!"}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
