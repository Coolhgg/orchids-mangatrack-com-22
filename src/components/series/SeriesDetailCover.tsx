"use client"

import { NSFWCover } from "@/components/ui/nsfw-cover"

interface SeriesDetailCoverProps {
  coverUrl: string | null
  title: string
  contentRating: string | null
  variant: "background" | "main"
}

export function SeriesDetailCover({ coverUrl, title, contentRating, variant }: SeriesDetailCoverProps) {
    if (variant === "background") {
      return (
        <NSFWCover
          src={coverUrl}
          alt=""
          contentRating={contentRating}
          className="w-full h-full blur-sm opacity-30 scale-110"
          showBadge={false}
          aspectRatio=""
          size="256"
        />
      )
    }

    return (
      <NSFWCover
        src={coverUrl}
        alt={title}
        contentRating={contentRating}
        className="w-full h-full"
        showBadge={true}
        aspectRatio=""
        size="512"
      />
    )

}
