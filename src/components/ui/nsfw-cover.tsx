"use client"

import { useState } from "react"
import { useSafeBrowsing } from "@/lib/context/safe-browsing-context"
import { isNSFW } from "@/lib/constants/safe-browsing"
import { Badge } from "@/components/ui/badge"
import { EyeOff, AlertTriangle } from "lucide-react"
import { isValidCoverUrl, getOptimizedCoverUrl, type CoverSize } from "@/lib/cover-utils"

function getProxiedUrl(url: string | null): string | null {
  if (!url) return null
  if (url.startsWith('/') || url.startsWith('data:')) return url
  return `/api/proxy/image?url=${encodeURIComponent(url)}`
}

interface NSFWCoverProps {
  src: string | null | undefined
  alt: string
  contentRating: string | null | undefined
  className?: string
  aspectRatio?: string
  showBadge?: boolean
  forceMode?: SafeBrowsingMode
  size?: CoverSize
}

type SafeBrowsingMode = "sfw" | "sfw_plus" | "nsfw"

const PLACEHOLDER_IMAGE = "/placeholder-nsfw.svg"

export function NSFWCover({
  src,
  alt,
  contentRating,
  className = "",
  aspectRatio = "aspect-[3/4]",
  showBadge = true,
  forceMode,
  size = "original",
}: NSFWCoverProps) {
  const { mode: contextMode } = useSafeBrowsing()
  const mode = forceMode ?? contextMode
  const [revealed, setRevealed] = useState(false)
  const isNSFWContent = isNSFW(contentRating)
  const optimizedSrc = getProxiedUrl(getOptimizedCoverUrl(src, size))
  const isValidSrc = isValidCoverUrl(src)

  if (!isNSFWContent || mode === "nsfw") {
    return (
      <div className={`${aspectRatio} overflow-hidden ${className} relative`}>
        {isValidSrc ? (
          <img
            src={optimizedSrc!}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="h-full w-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
            <EyeOff className="size-8 text-zinc-400" />
          </div>
        )}
        {showBadge && isNSFWContent && (
          <Badge className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5">
            18+
          </Badge>
        )}
      </div>
    )
  }

  if (mode === "sfw") {
    return (
      <div className={`${aspectRatio} overflow-hidden ${className} relative bg-zinc-900 flex flex-col items-center justify-center`}>
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-900" />
        <div className="relative z-10 flex flex-col items-center justify-center gap-2 p-4 text-center">
          <div className="size-12 rounded-full bg-zinc-800 flex items-center justify-center">
            <EyeOff className="size-6 text-zinc-500" />
          </div>
          <span className="text-zinc-400 text-xs font-medium">Mature Content</span>
        </div>
        {showBadge && (
          <Badge className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5 z-10">
            18+
          </Badge>
        )}
      </div>
    )
  }

  if (mode === "sfw_plus") {
    if (revealed) {
      return (
        <div className={`${aspectRatio} overflow-hidden ${className} relative`}>
          {isValidSrc ? (
            <img
              src={optimizedSrc!}
              alt={alt}
              loading="lazy"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="h-full w-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center">
              <EyeOff className="size-8 text-zinc-400" />
            </div>
          )}
          {showBadge && (
            <Badge className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5">
              18+
            </Badge>
          )}
        </div>
      )
    }

    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setRevealed(true)
        }}
        className={`${aspectRatio} overflow-hidden ${className} relative cursor-pointer group`}
      >
        {isValidSrc ? (
          <img
            src={optimizedSrc!}
            alt={alt}
            loading="lazy"
            className="h-full w-full object-cover blur-xl scale-110"
          />
        ) : (
          <div className="h-full w-full bg-zinc-100 dark:bg-zinc-900" />
        )}
        <div className="absolute inset-0 bg-black/40 flex flex-col items-center justify-center gap-2 transition-colors group-hover:bg-black/50">
          <div className="size-10 rounded-full bg-white/10 backdrop-blur-sm flex items-center justify-center">
            <AlertTriangle className="size-5 text-white" />
          </div>
          <span className="text-white text-xs font-bold">18+ Content</span>
          <span className="text-white/70 text-[10px]">Click to reveal</span>
        </div>
        {showBadge && (
          <Badge className="absolute top-2 left-2 bg-red-600 text-white text-[10px] px-1.5 py-0.5 z-10">
            18+
          </Badge>
        )}
      </button>
    )
  }

  return null
}
