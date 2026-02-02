"use client"

import { useState, useEffect } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { BookOpen, Users, TrendingUp, Clock, Star, BarChart3 } from "lucide-react"

interface StatsData {
  tracking_stats: {
    total_readers: number
    reading: number
    completed: number
    plan_to_read: number
    dropped: number
    on_hold: number
  }
  rating_stats: {
    total_ratings: number
    average_rating: number | null
    distribution: Record<string, number>
  }
  popularity: {
    rank: number | null
    weekly_readers: number
    monthly_readers: number
    trending_rank: number | null
  }
}

interface SeriesStatsTabProps {
  seriesId: string
}

export function SeriesStatsTab({ seriesId }: SeriesStatsTabProps) {
  const [stats, setStats] = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch(`/api/series/${seriesId}/stats`)
        if (res.ok) {
          const data = await res.json()
          setStats(data)
        }
      } catch (error) {
        console.error("Failed to fetch stats:", error)
      } finally {
        setLoading(false)
      }
    }
    fetchStats()
  }, [seriesId])

  if (loading) {
    return (
      <div className="space-y-8 pt-8">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-2xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="text-center py-12 text-zinc-500">
        <p>Unable to load statistics</p>
      </div>
    )
  }

  const maxRating = Math.max(...Object.values(stats.rating_stats.distribution), 1)

  const statusItems = [
    { label: "Reading", value: stats.tracking_stats.reading, color: "bg-emerald-500" },
    { label: "Completed", value: stats.tracking_stats.completed, color: "bg-blue-500" },
    { label: "Plan to Read", value: stats.tracking_stats.plan_to_read, color: "bg-amber-500" },
    { label: "On Hold", value: stats.tracking_stats.on_hold, color: "bg-orange-500" },
    { label: "Dropped", value: stats.tracking_stats.dropped, color: "bg-red-500" },
  ]

  const totalTracking = statusItems.reduce((sum, item) => sum + item.value, 0) || 1

  return (
    <div className="space-y-8 pt-8">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-2xl bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 border border-emerald-100 dark:border-emerald-900/50">
          <div className="flex items-center gap-2 mb-2">
            <Users className="size-4 text-emerald-600 dark:text-emerald-400" />
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Total Readers</span>
          </div>
          <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-100">
            {stats.tracking_stats.total_readers.toLocaleString()}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 border border-amber-100 dark:border-amber-900/50">
          <div className="flex items-center gap-2 mb-2">
            <Star className="size-4 text-amber-600 dark:text-amber-400" />
            <span className="text-xs font-medium text-amber-600 dark:text-amber-400">Average Rating</span>
          </div>
          <p className="text-2xl font-bold text-amber-900 dark:text-amber-100">
            {stats.rating_stats.average_rating?.toFixed(1) || "N/A"}
            <span className="text-sm font-normal text-amber-600 dark:text-amber-400">/10</span>
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 border border-blue-100 dark:border-blue-900/50">
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="size-4 text-blue-600 dark:text-blue-400" />
            <span className="text-xs font-medium text-blue-600 dark:text-blue-400">Popularity Rank</span>
          </div>
          <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">
            #{stats.popularity.rank?.toLocaleString() || "—"}
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-gradient-to-br from-purple-50 to-purple-100/50 dark:from-purple-950/30 dark:to-purple-900/20 border border-purple-100 dark:border-purple-900/50">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="size-4 text-purple-600 dark:text-purple-400" />
            <span className="text-xs font-medium text-purple-600 dark:text-purple-400">Monthly Readers</span>
          </div>
          <p className="text-2xl font-bold text-purple-900 dark:text-purple-100">
            {stats.popularity.monthly_readers.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-6">
          <BarChart3 className="size-5" />
          <h3 className="font-bold text-lg">Rating Distribution</h3>
          <span className="text-sm text-zinc-500 ml-auto">
            {stats.rating_stats.total_ratings.toLocaleString()} ratings
          </span>
        </div>
        
        <div className="space-y-3">
          {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((rating) => {
            const count = stats.rating_stats.distribution[rating] || 0
            const percentage = maxRating > 0 ? (count / maxRating) * 100 : 0
            
            return (
              <div key={rating} className="flex items-center gap-3">
                <div className="w-8 text-sm font-medium text-right">{rating}</div>
                <div className="flex-1 h-6 bg-zinc-200 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      rating >= 8 ? 'bg-emerald-500' :
                      rating >= 6 ? 'bg-amber-500' :
                      rating >= 4 ? 'bg-orange-500' :
                      'bg-red-500'
                    }`}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
                <div className="w-12 text-sm text-zinc-500 text-right">{count}</div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="p-6 rounded-2xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800">
        <div className="flex items-center gap-2 mb-6">
          <BookOpen className="size-5" />
          <h3 className="font-bold text-lg">Reading Status Distribution</h3>
        </div>
        
        <div className="h-4 rounded-full overflow-hidden flex mb-6 bg-zinc-200 dark:bg-zinc-800">
          {statusItems.map((item, i) => (
            <div
              key={item.label}
              className={`${item.color} transition-all duration-500`}
              style={{ width: `${(item.value / totalTracking) * 100}%` }}
              title={`${item.label}: ${item.value}`}
            />
          ))}
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {statusItems.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <div className={`size-3 rounded-full ${item.color}`} />
              <div>
                <p className="text-xs text-zinc-500">{item.label}</p>
                <p className="font-bold">{item.value.toLocaleString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {(stats.popularity.trending_rank || stats.popularity.weekly_readers > 0) && (
        <div className="grid grid-cols-2 gap-4">
          {stats.popularity.trending_rank && (
            <div className="p-5 rounded-2xl bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/30 dark:to-rose-900/20 border border-rose-100 dark:border-rose-900/50">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="size-4 text-rose-600 dark:text-rose-400" />
                <span className="text-xs font-medium text-rose-600 dark:text-rose-400">Trending Rank</span>
              </div>
              <p className="text-2xl font-bold text-rose-900 dark:text-rose-100">
                #{stats.popularity.trending_rank.toLocaleString()}
              </p>
            </div>
          )}
          
          <div className="p-5 rounded-2xl bg-gradient-to-br from-cyan-50 to-cyan-100/50 dark:from-cyan-950/30 dark:to-cyan-900/20 border border-cyan-100 dark:border-cyan-900/50">
            <div className="flex items-center gap-2 mb-2">
              <Users className="size-4 text-cyan-600 dark:text-cyan-400" />
              <span className="text-xs font-medium text-cyan-600 dark:text-cyan-400">Weekly Readers</span>
            </div>
            <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-100">
              {stats.popularity.weekly_readers.toLocaleString()}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
