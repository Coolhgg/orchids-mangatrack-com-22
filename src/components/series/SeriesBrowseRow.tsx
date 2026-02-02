import { Star, Users, BookOpen, Clock } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { NSFWCover } from "@/components/ui/nsfw-cover"
import { formatDistanceToNow } from "date-fns"

interface Series {
  id: string
  title: string
  cover_url: string | null
  type: string
  status: string
  genres: string[]
  themes?: string[]
  average_rating: number | null
  total_follows: number
  updated_at: string
  last_chapter_date?: string
  content_rating: string | null
  chapter_count?: number
}

export function SeriesBrowseRow({ series }: { series: Series }) {
  const lastUpdate = series.last_chapter_date 
    ? formatDistanceToNow(new Date(series.last_chapter_date), { addSuffix: true })
    : null

  return (
    <div className="group relative flex gap-6 p-4 rounded-3xl bg-zinc-50/50 dark:bg-zinc-900/50 border border-zinc-100 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-white dark:hover:bg-zinc-900 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4">
      {/* Cover Image */}
      <Link href={`/series/${series.id}`} className="shrink-0">
        <div className="relative w-24 sm:w-32 aspect-[3/4] rounded-2xl overflow-hidden border border-zinc-200 dark:border-zinc-800 shadow-sm transition-transform duration-500 group-hover:scale-[1.02]">
          <NSFWCover
            src={series.cover_url}
            alt={series.title}
            contentRating={series.content_rating}
            className="object-cover"
            showBadge={false}
            size="256"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      </Link>

      {/* Content */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-4">
            <Link href={`/series/${series.id}`} className="block">
              <h3 className="text-lg font-black tracking-tight leading-tight line-clamp-1 group-hover:text-zinc-600 dark:group-hover:text-zinc-300 transition-colors uppercase italic">
                {series.title}
              </h3>
            </Link>
            <div className="flex items-center gap-1.5 shrink-0">
              <Star className="size-3.5 text-amber-500 fill-amber-500" />
              <span className="text-sm font-black italic">
                {series.average_rating ? Number(series.average_rating).toFixed(1) : "N/A"}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-widest bg-white dark:bg-black border-zinc-200 dark:border-zinc-800">
              {series.type}
            </Badge>
            <Badge variant="outline" className="text-[10px] uppercase font-bold tracking-widest bg-zinc-100 dark:bg-zinc-800 border-none text-zinc-500">
              {series.status}
            </Badge>
            {series.chapter_count !== undefined && series.chapter_count > 0 && (
              <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400 flex items-center gap-1 ml-1">
                <BookOpen className="size-3" /> {series.chapter_count} chapters
              </span>
            )}
          </div>

            <div className="flex flex-wrap gap-1.5 pt-1">
              {(series.genres || []).slice(0, 4).map((genre) => (
                <span key={genre} className="text-[10px] font-medium text-zinc-500 bg-zinc-100/50 dark:bg-zinc-800/50 px-2 py-0.5 rounded-md">
                  {genre}
                </span>
              ))}
            </div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5 text-zinc-400">
              <Users className="size-3.5" />
              <span className="text-[11px] font-black uppercase tracking-tight">
                {series.total_follows >= 1000 ? `${(series.total_follows / 1000).toFixed(1)}K` : series.total_follows} followers
              </span>
            </div>
            {lastUpdate && (
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Clock className="size-3.5" />
                <span className="text-[11px] font-black uppercase tracking-tight">
                  Updated {lastUpdate}
                </span>
              </div>
            )}
          </div>
          
          <Link 
            href={`/series/${series.id}`}
            className="text-[10px] font-black uppercase tracking-[0.2em] text-zinc-900 dark:text-zinc-100 opacity-0 group-hover:opacity-100 translate-x-2 group-hover:translate-x-0 transition-all duration-300"
          >
            View Details →
          </Link>
        </div>
      </div>
    </div>
  )
}
