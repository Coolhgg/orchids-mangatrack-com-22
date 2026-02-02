"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { Star, Users, Flame, BookOpen, TrendingUp, Sparkles, Zap, Clock } from "lucide-react"
import { TrendingSeries } from "@/components/series/TrendingSeries"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { NSFWCover } from "@/components/ui/nsfw-cover"

interface Series {
  id: string
  title: string
  cover_url: string | null
  content_rating: string | null
  type: string
  status: string
  genres: string[]
  average_rating: number | null
  total_follows: number
  updated_at: string
  is_fallback?: boolean
  match_reasons?: string[]
  catalog_tier?: string
}

interface FeedItem {
  id: string
  chapter_number: number
  chapter_title: string | null
  discovered_at: string
  series: {
    id: string
    title: string
    cover_url: string | null
    content_rating: string | null
    status: string | null
    type: string
    catalog_tier: string
  }
  primary_source: {
    id: string
    chapter_url: string
    source_name: string
    language: string | null
  } | null
}

function SeriesSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-6">
      {[...Array(6)].map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="aspect-[3/4] rounded-2xl" />
          <div className="space-y-2 px-1">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-3 w-16" />
          </div>
        </div>
      ))}
    </div>
  )
}

function FeedSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(4)].map((_, i) => (
        <div key={i} className="flex gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50">
          <Skeleton className="w-16 h-24 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

function SeriesCard({ 
  series, 
  index, 
}: { 
  series: Series; 
  index?: number;
}) {
  const handleClick = () => {
    fetch('/api/analytics/record-activity', {
      method: 'POST',
      body: JSON.stringify({ seriesId: series.id, eventType: 'update_click' })
    }).catch(() => {})
  }

  return (
    <div className="group space-y-3 relative" onClick={handleClick}>
      <Link href={`/series/${series.id}`} className="block relative">
        <div className="overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all group-hover:ring-2 group-hover:ring-zinc-900 dark:group-hover:ring-zinc-50 shadow-sm group-hover:shadow-md relative">
            <NSFWCover
              src={series.cover_url}
              alt={series.title}
              contentRating={series.content_rating}
              className="transition-transform duration-500 group-hover:scale-110"
              aspectRatio="aspect-[3/4]"
              showBadge={true}
              size="512"
            />
          {typeof index === 'number' && (
            <div className="absolute top-2 left-2 bg-zinc-900/90 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-lg z-20">
              #{index + 1}
            </div>
          )}
          <Badge className="absolute top-2 right-2 capitalize text-[10px] z-20" variant="secondary">
            {series.type}
          </Badge>
        </div>
      </Link>
      <div className="space-y-1 px-1">
          <h3 className="font-bold text-sm leading-tight truncate">{series.title}</h3>
          {series.match_reasons && series.match_reasons.length > 0 && (
            <p className="text-[10px] text-zinc-400 font-medium truncate italic">
              {series.match_reasons[0]}
            </p>
          )}
          <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-medium">

          <span className="flex items-center gap-1">
            <Star className="size-3 text-yellow-500 fill-yellow-500" /> {series.average_rating || "N/A"}
          </span>
          <span className="flex items-center gap-1">
            <Users className="size-3" /> {series.total_follows >= 1000 ? `${Math.round(series.total_follows / 1000)}K` : series.total_follows}
          </span>
        </div>
      </div>
    </div>
  )
}

function FeedCard({ item, isNewRelease }: { item: FeedItem; isNewRelease?: boolean }) {
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    if (hours < 1) return 'Just now'
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days === 1) return '1 day ago'
    return `${days} days ago`
  }

  return (
    <Link 
      href={`/series/${item.series.id}`}
      className="flex gap-4 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors group"
    >
      <div className="w-16 h-24 rounded-lg overflow-hidden shrink-0 bg-zinc-200 dark:bg-zinc-800">
        <NSFWCover
          src={item.series.cover_url}
          alt={item.series.title}
          contentRating={item.series.content_rating}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform"
          aspectRatio=""
          showBadge={false}
          size="256"
        />
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <h4 className="font-semibold text-sm truncate group-hover:text-zinc-600 dark:group-hover:text-zinc-300">
          {item.series.title}
        </h4>
        <p className="text-xs text-zinc-500">
          {isNewRelease ? 'Chapter 1' : `Chapter ${item.chapter_number}`}
          {item.chapter_title && ` - ${item.chapter_title}`}
        </p>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <span className="flex items-center gap-1">
            <Clock className="size-3" />
            {timeAgo(item.discovered_at)}
          </span>
          {item.primary_source && (
            <Badge variant="outline" className="text-[9px] px-1.5 py-0">
              {item.primary_source.source_name}
            </Badge>
          )}
          <Badge 
            variant="secondary" 
            className={`text-[9px] px-1.5 py-0 ${
              item.series.catalog_tier === 'A' 
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' 
                : item.series.catalog_tier === 'B'
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'
            }`}
          >
            Tier {item.series.catalog_tier}
          </Badge>
        </div>
      </div>
    </Link>
  )
}

  const DiscoverPageContent = () => {
    const [trendingWindow, setTrendingWindow] = useState<'today' | 'week' | 'month'>('week')
    const [recommended, setRecommended] = useState<Series[]>([])
    const [newReleases, setNewReleases] = useState<FeedItem[]>([])
    const [latestUpdates, setLatestUpdates] = useState<FeedItem[]>([])
    const [popularManga, setPopularManga] = useState<Series[]>([])
    const [popularManhwa, setPopularManhwa] = useState<Series[]>([])
    const [loadingRecommended, setLoadingRecommended] = useState(true)
    const [loadingNewReleases, setLoadingNewReleases] = useState(true)
    const [loadingLatestUpdates, setLoadingLatestUpdates] = useState(true)
    const [loadingPopular, setLoadingPopular] = useState(true)


  const fetchRecommended = useCallback(async () => {
    setLoadingRecommended(true)
    try {
      const res = await fetch("/api/series/recommendations")
      if (res.ok) {
        const data = await res.json()
        setRecommended(data.results || [])
      }
    } catch (error) {
      console.error("Failed to fetch recommendations:", error)
    } finally {
      setLoadingRecommended(false)
    }
  }, [])

  const fetchNewReleases = useCallback(async () => {
    setLoadingNewReleases(true)
    try {
      const res = await fetch("/api/feed/new-releases?limit=4")
      if (res.ok) {
        const data = await res.json()
        setNewReleases(data.results || [])
      }
    } catch (error) {
      console.error("Failed to fetch new releases:", error)
    } finally {
      setLoadingNewReleases(false)
    }
  }, [])

  const fetchLatestUpdates = useCallback(async () => {
    setLoadingLatestUpdates(true)
    try {
      const res = await fetch("/api/feed/latest-updates?limit=4")
      if (res.ok) {
        const data = await res.json()
        setLatestUpdates(data.results || [])
      }
    } catch (error) {
      console.error("Failed to fetch latest updates:", error)
    } finally {
      setLoadingLatestUpdates(false)
    }
  }, [])

  const fetchPopular = useCallback(async () => {
    setLoadingPopular(true)
    try {
      const [mangaRes, manhwaRes] = await Promise.all([
        fetch("/api/series/trending?type=manga&limit=6"),
        fetch("/api/series/trending?type=manhwa&limit=6"),
      ])
      
      if (mangaRes.ok) {
        const data = await mangaRes.json()
        setPopularManga(data.results || [])
      }
      if (manhwaRes.ok) {
        const data = await manhwaRes.json()
        setPopularManhwa(data.results || [])
      }
    } catch (error) {
      console.error("Failed to fetch popular:", error)
    } finally {
      setLoadingPopular(false)
    }
  }, [])

    useEffect(() => {
      fetchRecommended()
      fetchNewReleases()
      fetchLatestUpdates()
      fetchPopular()
    }, [fetchRecommended, fetchNewReleases, fetchLatestUpdates, fetchPopular])


  return (
    <div className="p-6 space-y-12 max-w-7xl mx-auto pb-24">
      <div className="space-y-2">
        <h1 className="text-4xl font-extrabold tracking-tight">Discover</h1>
        <p className="text-zinc-500 text-lg">Inspiration, trending, and curated discovery.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <Zap className="size-5 text-emerald-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">New Releases</h2>
              <p className="text-xs text-zinc-500">Fresh manga entering the scene (Tier A/B, Ch. 1)</p>
            </div>
          </div>
          {loadingNewReleases ? (
            <FeedSkeleton />
          ) : newReleases.length > 0 ? (
            <div className="space-y-3">
              {newReleases.map((item) => (
                <FeedCard key={item.id} item={item} isNewRelease />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500 text-xs">No new releases in the last 30 days.</p>
            </div>
          )}
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-cyan-100 dark:bg-cyan-900/30">
              <Clock className="size-5 text-cyan-500" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Latest Updates</h2>
              <p className="text-xs text-zinc-500">Recent chapter drops (Tier B/C, excludes Ch. 1 spam)</p>
            </div>
          </div>
          {loadingLatestUpdates ? (
            <FeedSkeleton />
          ) : latestUpdates.length > 0 ? (
            <div className="space-y-3">
              {latestUpdates.map((item) => (
                <FeedCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
              <p className="text-zinc-500 text-xs">No recent updates found.</p>
            </div>
          )}
        </section>
      </div>

        <section className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-orange-100 dark:bg-orange-900/30">
                <Flame className="size-5 text-orange-500" />
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Trending</h2>
            </div>
          <div className="flex items-center bg-zinc-100 dark:bg-zinc-900 rounded-lg p-1">
                {(['today', 'week', 'month'] as const).map((window) => (
                  <button
                    key={window}
                    onClick={() => setTrendingWindow(window)}
                    className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
                      trendingWindow === window
                        ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-sm'
                        : 'text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-300'
                    }`}
                  >
                    {window.charAt(0).toUpperCase() + window.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <TrendingSeries window={trendingWindow} limit={6} />
        </section>


      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-900/30">
              <Sparkles className="size-5 text-indigo-500" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Recommended for You</h2>
          </div>
        </div>
        {loadingRecommended ? (
          <SeriesSkeleton />
        ) : recommended.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
            {recommended.map((series) => (
              <SeriesCard key={series.id} series={series} />
            ))}
          </div>
        ) : (
          <div className="py-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-2xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <p className="text-zinc-500 text-sm">Follow more series to get personalized recommendations!</p>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <BookOpen className="size-5 text-blue-500" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Popular Manga</h2>
          </div>
        </div>
        {loadingPopular ? (
          <SeriesSkeleton />
        ) : popularManga.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
            {popularManga.map((series) => (
              <SeriesCard key={series.id} series={series} />
            ))}
          </div>
        ) : (
          <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <p className="text-zinc-500 text-xs">No popular manga found.</p>
          </div>
        )}
      </section>

      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
              <TrendingUp className="size-5 text-purple-500" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight">Popular Manhwa</h2>
          </div>
        </div>
        {loadingPopular ? (
          <SeriesSkeleton />
        ) : popularManhwa.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-6">
            {popularManhwa.map((series) => (
              <SeriesCard key={series.id} series={series} />
            ))}
          </div>
        ) : (
          <div className="py-10 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800">
            <p className="text-zinc-500 text-xs">No popular manhwa found.</p>
          </div>
        )}
      </section>
    </div>
  )
}

function DiscoverPageSkeleton() {
  return (
    <div className="p-6 space-y-12 max-w-7xl mx-auto pb-24">
      <div className="space-y-2">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-6 w-72" />
      </div>
      <section className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <SeriesSkeleton />
      </section>
    </div>
  )
}

export default function DiscoverPage() {
  return (
    <Suspense fallback={<DiscoverPageSkeleton />}>
      <DiscoverPageContent />
    </Suspense>
  )
}
