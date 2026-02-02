"use client"

import { useState, useEffect } from "react"
import { TrendingUp, Users, BookOpen, Zap, Flame, ArrowUpRight } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { NSFWCover } from "@/components/ui/nsfw-cover"
import { formatDistanceToNow } from "date-fns"

interface TrendingVelocity {
  chapters: number
  follows: number
  activity: number
  chapters_24h: number
  chapters_72h: number
  follows_24h: number
  follows_72h: number
  last_chapter_event_at: string | null
}

interface TrendingSeriesItem {
  id: string
  title: string
  cover_url: string | null
  content_rating: string | null
  type: string
  status: string
  total_follows: number
  latest_chapter: number | null
  last_chapter_at: string | null
  trending_score: number
  velocity: TrendingVelocity
}

export function TrendingCard({ series, index }: { series: TrendingSeriesItem; index: number }) {
  const hasRecentFollows = series.velocity.follows_24h > 0
  const hasRecentChapters = series.velocity.chapters_24h > 0
  
  return (
    <div className="group relative flex flex-col space-y-3 bg-white dark:bg-zinc-900/50 rounded-3xl p-3 border border-zinc-100 dark:border-zinc-800 hover:border-orange-200 dark:hover:border-orange-900/50 transition-all duration-500 hover:shadow-xl hover:shadow-orange-500/5">
      <Link href={`/series/${series.id}`} className="relative aspect-[3/4] rounded-2xl overflow-hidden bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-800 group-hover:ring-2 group-hover:ring-orange-500/20 transition-all">
        <NSFWCover
          src={series.cover_url}
          alt={series.title}
          contentRating={series.content_rating}
          className="transition-transform duration-700 group-hover:scale-110"
          aspectRatio="aspect-[3/4]"
          showBadge={false}
          size="512"
        />
        
        {/* Rank Badge */}
        <div className="absolute top-3 left-3 flex items-center justify-center size-8 bg-zinc-950/90 backdrop-blur-md border border-white/10 text-white rounded-xl z-20 shadow-lg">
          <span className="text-sm font-black italic">#{index + 1}</span>
        </div>

        {/* Momentum Indicator */}
        {(hasRecentFollows || hasRecentChapters) && (
          <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 bg-orange-500 text-white rounded-xl z-20 shadow-lg animate-pulse-subtle">
            <Flame className="size-3 fill-current" />
            <span className="text-[10px] font-black uppercase tracking-tight italic">Hot</span>
          </div>
        )}

        {/* Overlay Content */}
        <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-4">
           <div className="space-y-2">
              <div className="flex flex-wrap gap-1">
                {series.velocity.follows_24h > 0 && (
                  <Badge className="bg-orange-500/90 border-none text-[9px] font-black uppercase italic">
                    +{series.velocity.follows_24h} New Followers
                  </Badge>
                )}
                {series.velocity.chapters_24h > 0 && (
                  <Badge className="bg-blue-500/90 border-none text-[9px] font-black uppercase italic">
                    {series.velocity.chapters_24h} New Chapters
                  </Badge>
                )}
              </div>
           </div>
        </div>
      </Link>

      <div className="px-1 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <Link href={`/series/${series.id}`} className="flex-1 min-w-0">
            <h3 className="text-sm font-black tracking-tight leading-tight line-clamp-2 uppercase italic group-hover:text-orange-500 transition-colors">
              {series.title}
            </h3>
          </Link>
          <Badge variant="outline" className="text-[9px] uppercase font-black tracking-widest px-1.5 py-0 bg-zinc-50 dark:bg-zinc-800 border-none text-zinc-500 italic shrink-0">
            {series.type}
          </Badge>
        </div>

        <div className="flex items-center gap-3 pt-1 border-t border-zinc-100 dark:border-zinc-800/50">
          <div className="flex items-center gap-1 text-zinc-400">
            <Users className="size-3" />
            <span className="text-[10px] font-black uppercase tracking-tight italic">
              {series.total_follows >= 1000 ? `${(series.total_follows / 1000).toFixed(1)}K` : series.total_follows}
            </span>
          </div>
          {series.latest_chapter && (
            <div className="flex items-center gap-1 text-zinc-400">
              <BookOpen className="size-3" />
              <span className="text-[10px] font-black uppercase tracking-tight italic">
                Ch. {series.latest_chapter}
              </span>
            </div>
          )}
          {series.velocity.follows_24h > 0 && (
             <div className="flex items-center gap-1 text-orange-500 ml-auto">
               <TrendingUp className="size-3" />
               <span className="text-[10px] font-black italic">+{series.velocity.follows_24h}</span>
             </div>
          )}
        </div>
      </div>
    </div>
  )
}

function TrendingSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="space-y-4">
          <Skeleton className="aspect-[3/4] rounded-3xl" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TrendingSeries({ 
  window = 'week',
  type,
  limit = 6
}: { 
  window?: 'today' | 'week' | 'month'
  type?: string
  limit?: number
}) {
  const [series, setSeries] = useState<TrendingSeriesItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchTrending() {
      setLoading(true)
      try {
        const url = `/api/series/trending?mode=velocity&limit=${limit}${type ? `&type=${type}` : ''}`
        const res = await fetch(url)
        if (res.ok) {
          const data = await res.json()
          setSeries(data.results || [])
        }
      } catch (error) {
        console.error("Failed to fetch trending:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchTrending()
  }, [window, type, limit])

  if (loading) return <TrendingSkeleton />
  if (series.length === 0) return (
    <div className="py-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
      <p className="text-zinc-500 text-sm font-medium">No trending series found for this window.</p>
    </div>
  )

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
      {series.map((item, index) => (
        <TrendingCard key={item.id} series={item} index={index} />
      ))}
    </div>
  )
}
