"use client"

import { BookOpen, CheckCircle2, Zap, ExternalLink } from "lucide-react"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"

export interface FeedEntry {
  id: string;
  series: {
    id: string;
    title: string;
    cover_url: string | null;
    content_rating?: string | null;
    status?: string | null;
    type?: string;
  };
  chapter_number: number;
  chapter_title: string | null;
  chapter_display?: string;
  volume_number?: number | null;
  is_unseen: boolean;
  is_read: boolean;
  sources: {
    name: string;
    url: string;
    group?: string;
    discovered_at: string;
  }[];
  first_discovered_at: string;
  last_updated_at: string;
}

interface AvailabilityCardProps {
  release: FeedEntry
  isChecking: boolean
  onClick: () => void
  formatDate: (date: string) => string
}

export function AvailabilityCard({ release, isChecking, onClick, formatDate }: AvailabilityCardProps) {
  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`size-10 rounded-xl flex items-center justify-center ${release.is_read ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-400' : 'bg-blue-100 dark:bg-blue-900/30 text-blue-600'}`}>
            {release.is_read ? <CheckCircle2 className="size-5" /> : <Zap className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-bold flex items-center gap-2">
              {release.is_read ? 'Read Release' : 'New Release'}
              {release.is_unseen && !release.is_read && (
                <Badge className="bg-blue-500 hover:bg-blue-600 text-[8px] h-4 px-1 rounded-sm uppercase">New</Badge>
              )}
            </p>
            <p className="text-[10px] text-zinc-500 font-medium">
              {formatDate(release.first_discovered_at)}
            </p>
          </div>
        </div>
      </div>

      <div 
        className={`rounded-3xl border p-4 flex gap-4 transition-all cursor-pointer group relative overflow-hidden ${
          isChecking 
            ? 'ring-2 ring-blue-500 bg-blue-50/10'
            : release.is_read 
              ? 'bg-zinc-50/50 dark:bg-zinc-900/30 border-zinc-100 dark:border-zinc-800 opacity-70' 
              : 'bg-white dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 hover:border-blue-300 dark:hover:border-blue-900 shadow-sm hover:shadow-md'
        }`}
        onClick={onClick}
      >
        <div className="size-20 shrink-0 rounded-xl overflow-hidden border border-zinc-200 dark:border-zinc-800 group-hover:scale-105 transition-transform">
          {release.series.cover_url ? (
            <img src={release.series.cover_url} className="h-full w-full object-cover" alt="" />
          ) : (
            <div className="h-full w-full bg-zinc-200 dark:bg-zinc-800 flex items-center justify-center">
              <BookOpen className="size-6 text-zinc-400" />
            </div>
          )}
        </div>
        
        <div className="flex-1 space-y-2 py-1">
          <div className="flex items-start justify-between gap-2">
            <Link 
              href={`/series/${release.series.id}`}
              onClick={(e) => e.stopPropagation()}
              className="hover:underline"
            >
              <h3 className="font-bold text-sm leading-tight line-clamp-1">{release.series.title}</h3>
            </Link>
          </div>
          
          <p className={`text-xs font-bold ${release.is_read ? 'text-zinc-500' : 'text-zinc-900 dark:text-zinc-100'}`}>
            Chapter {release.chapter_number}
            {release.chapter_title && <span className="text-zinc-500 font-normal ml-1">- {release.chapter_title}</span>}
          </p>
          
          <div className="flex flex-wrap gap-2 pt-1">
            {release.sources.map((source) => (
              <a
                key={source.name + source.url}
                href={source.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-blue-100 dark:hover:bg-blue-900/40 text-zinc-600 dark:text-zinc-400 hover:text-blue-600 dark:hover:text-blue-400 border border-zinc-200 dark:border-zinc-700 transition-colors"
              >
                <span className="text-[10px] font-bold uppercase tracking-tight">{source.name}</span>
                <ExternalLink className="size-3" />
              </a>
            ))}
          </div>
        </div>

        <div className="flex items-center pr-2">
          <div className={`p-2 rounded-full transition-colors ${release.is_read ? 'text-zinc-400' : 'bg-zinc-100 dark:bg-zinc-800 group-hover:bg-blue-500 group-hover:text-white'}`}>
            <BookOpen className="size-4" />
          </div>
        </div>
      </div>
    </div>
  )
}
