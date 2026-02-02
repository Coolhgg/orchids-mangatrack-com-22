"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { Sparkles, Clock, Trophy, XCircle, ChevronDown, ChevronUp, Loader2 } from "lucide-react"

interface SeasonalAchievement {
  code: string
  name: string
  description: string
  xp_reward: number
  rarity: string
  current_value: number
  threshold: number
  progress_percent: number
  is_unlocked: boolean
  unlocked_at: string | null
  is_end_of_season: boolean
}

interface PastSeasonAchievement {
  code: string
  name: string
  description: string
  xp_reward: number
  rarity: string
  status: "completed" | "missed"
  unlocked_at: string | null
  season_code: string
  season_name: string
}

interface PastSeason {
  season_code: string
  season_name: string
  final_xp: number
  final_rank: number | null
  achievements: PastSeasonAchievement[]
}

interface SeasonalData {
  season: {
    code: string
    name: string
    days_remaining: number
    ends_at: string
  }
  achievements: SeasonalAchievement[]
  stats: {
    chapters_read: number
    series_completed: number
    series_added: number
    streak_max: number
    seasonal_xp: number
    unlocked_count: number
    total_count: number
    in_progress_count: number
  }
  past_seasons?: PastSeason[]
}

const RARITY_COLORS: Record<string, string> = {
  common: "from-zinc-400 to-zinc-500",
  rare: "from-blue-400 to-blue-600",
  legendary: "from-amber-400 to-orange-500",
}

const RARITY_BG: Record<string, string> = {
  common: "bg-zinc-100 dark:bg-zinc-800",
  rare: "bg-blue-50 dark:bg-blue-900/30",
  legendary: "bg-amber-50 dark:bg-amber-900/30",
}

const RARITY_BORDER: Record<string, string> = {
  common: "border-zinc-200 dark:border-zinc-700",
  rare: "border-blue-200 dark:border-blue-700",
  legendary: "border-amber-300 dark:border-amber-600",
}

export function SeasonalAchievementsSection({ className }: { className?: string }) {
  const [data, setData] = useState<SeasonalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [expandedPastSeasons, setExpandedPastSeasons] = useState<Set<string>>(new Set())

  useEffect(() => {
    async function fetchSeasonalAchievements() {
      setLoading(true)
      try {
        const res = await fetch("/api/users/me/achievements/seasonal?include_history=true")
        if (res.ok) {
          const json = await res.json()
          setData(json)
        }
      } catch (error) {
        console.error("Failed to fetch seasonal achievements:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchSeasonalAchievements()
  }, [])

  const togglePastSeason = (seasonCode: string) => {
    setExpandedPastSeasons((prev) => {
      const next = new Set(prev)
      if (next.has(seasonCode)) {
        next.delete(seasonCode)
      } else {
        next.add(seasonCode)
      }
      return next
    })
  }

  if (loading) {
    return (
      <div className={cn("flex items-center justify-center py-12", className)}>
        <Loader2 className="size-6 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className={cn("p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800", className)}>
        <Sparkles className="size-8 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
        <p className="text-zinc-500 text-sm font-medium">No seasonal data available</p>
      </div>
    )
  }

  return (
    <div className={cn("space-y-8", className)}>
      <div className="p-6 rounded-2xl bg-gradient-to-br from-violet-500/10 to-fuchsia-500/10 border border-violet-200/50 dark:border-violet-700/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 flex items-center justify-center">
              <Sparkles className="size-5 text-white" />
            </div>
            <div>
              <h3 className="font-bold text-lg">{data.season.name}</h3>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Season {data.season.code}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
            <Clock className="size-4" />
            <span className="text-sm font-medium">{data.season.days_remaining} days left</span>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <div className="p-3 rounded-xl bg-white/50 dark:bg-zinc-800/50">
            <div className="text-2xl font-bold">{data.stats.chapters_read}</div>
            <div className="text-xs text-zinc-500">Chapters Read</div>
          </div>
          <div className="p-3 rounded-xl bg-white/50 dark:bg-zinc-800/50">
            <div className="text-2xl font-bold">{data.stats.series_added}</div>
            <div className="text-xs text-zinc-500">Series Added</div>
          </div>
          <div className="p-3 rounded-xl bg-white/50 dark:bg-zinc-800/50">
            <div className="text-2xl font-bold">{data.stats.series_completed}</div>
            <div className="text-xs text-zinc-500">Completed</div>
          </div>
          <div className="p-3 rounded-xl bg-white/50 dark:bg-zinc-800/50">
            <div className="text-2xl font-bold">{data.stats.seasonal_xp}</div>
            <div className="text-xs text-zinc-500">Season XP</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-sm">
          <span className="text-zinc-600 dark:text-zinc-400">
            <span className="font-semibold text-foreground">{data.stats.unlocked_count}</span> / {data.stats.total_count} achievements
          </span>
          {data.stats.in_progress_count > 0 && (
            <span className="text-violet-600 dark:text-violet-400">
              {data.stats.in_progress_count} in progress
            </span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
          Current Season Achievements
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.achievements.map((achievement) => (
            <SeasonalAchievementCard key={achievement.code} achievement={achievement} />
          ))}
        </div>
      </div>

      {data.past_seasons && data.past_seasons.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
            Past Seasons
          </h3>
          <div className="space-y-3">
            {data.past_seasons.map((pastSeason) => {
              const isExpanded = expandedPastSeasons.has(pastSeason.season_code)
              const completedCount = pastSeason.achievements.filter((a) => a.status === "completed").length
              const missedCount = pastSeason.achievements.filter((a) => a.status === "missed").length

              return (
                <div
                  key={pastSeason.season_code}
                  className="rounded-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden"
                >
                  <button
                    onClick={() => togglePastSeason(pastSeason.season_code)}
                    className="w-full p-4 flex items-center justify-between bg-zinc-50 dark:bg-zinc-900/50 hover:bg-zinc-100 dark:hover:bg-zinc-800/50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center">
                        <Trophy className="size-4 text-zinc-500" />
                      </div>
                      <div className="text-left">
                        <div className="font-medium">{pastSeason.season_name}</div>
                        <div className="text-xs text-zinc-500 flex items-center gap-2">
                          {pastSeason.final_xp > 0 && (
                            <span>{pastSeason.final_xp.toLocaleString()} XP</span>
                          )}
                          {pastSeason.final_rank && (
                            <span>Rank #{pastSeason.final_rank}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-emerald-600 dark:text-emerald-400">{completedCount} completed</span>
                        <span className="text-zinc-400">·</span>
                        <span className="text-zinc-500">{missedCount} missed</span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="size-5 text-zinc-400" />
                      ) : (
                        <ChevronDown className="size-5 text-zinc-400" />
                      )}
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="p-4 border-t border-zinc-200 dark:border-zinc-800">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {pastSeason.achievements.map((achievement) => (
                          <PastSeasonAchievementCard key={achievement.code} achievement={achievement} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function SeasonalAchievementCard({ achievement }: { achievement: SeasonalAchievement }) {
  const rarity = achievement.rarity.toLowerCase()
  const isUnlocked = achievement.is_unlocked
  const isEndOfSeason = achievement.is_end_of_season

  return (
    <div
      className={cn(
        "relative p-4 rounded-xl border transition-all",
        isUnlocked
          ? "bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/20 dark:to-emerald-800/20 border-emerald-200 dark:border-emerald-700"
          : cn(RARITY_BG[rarity], RARITY_BORDER[rarity])
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold truncate">{achievement.name}</span>
            <span
              className={cn(
                "px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r text-white",
                RARITY_COLORS[rarity]
              )}
            >
              {achievement.rarity}
            </span>
          </div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">{achievement.description}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-bold text-violet-600 dark:text-violet-400">+{achievement.xp_reward} XP</div>
        </div>
      </div>

      {!isEndOfSeason && !isUnlocked && (
        <div className="mt-3">
          <div className="flex items-center justify-between text-xs text-zinc-500 mb-1">
            <span>{achievement.current_value} / {achievement.threshold}</span>
            <span>{achievement.progress_percent}%</span>
          </div>
          <div className="h-2 rounded-full bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full bg-gradient-to-r transition-all",
                RARITY_COLORS[rarity]
              )}
              style={{ width: `${achievement.progress_percent}%` }}
            />
          </div>
        </div>
      )}

      {isEndOfSeason && !isUnlocked && (
        <div className="mt-3 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
          <Clock className="size-3" />
          <span>Awarded at season end</span>
        </div>
      )}

      {isUnlocked && (
        <div className="absolute top-3 right-3">
          <div className="size-6 rounded-full bg-emerald-500 flex items-center justify-center">
            <Trophy className="size-3 text-white" />
          </div>
        </div>
      )}
    </div>
  )
}

function PastSeasonAchievementCard({ achievement }: { achievement: PastSeasonAchievement }) {
  const isCompleted = achievement.status === "completed"

  return (
    <div
      className={cn(
        "p-3 rounded-xl border transition-all",
        isCompleted
          ? "bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-700"
          : "bg-zinc-100 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 opacity-60"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isCompleted ? (
            <Trophy className="size-4 text-emerald-500 shrink-0" />
          ) : (
            <XCircle className="size-4 text-zinc-400 shrink-0" />
          )}
          <span className="font-medium text-sm truncate">{achievement.name}</span>
        </div>
        <span
          className={cn(
            "px-2 py-0.5 rounded-full text-xs font-medium shrink-0",
            isCompleted
              ? "bg-emerald-100 dark:bg-emerald-800 text-emerald-700 dark:text-emerald-300"
              : "bg-zinc-200 dark:bg-zinc-700 text-zinc-500"
          )}
        >
          {isCompleted ? "Completed" : "Missed"}
        </span>
      </div>
      <div className="mt-1 flex items-center justify-between text-xs text-zinc-500">
        <span>{achievement.description}</span>
        <span className={cn("font-medium", isCompleted ? "text-violet-600 dark:text-violet-400" : "line-through")}>
          +{achievement.xp_reward} XP
        </span>
      </div>
    </div>
  )
}
