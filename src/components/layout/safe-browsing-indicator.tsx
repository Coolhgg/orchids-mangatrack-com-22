"use client"

import { useSafeBrowsing } from "@/lib/context/safe-browsing-context"
import { Eye, EyeOff, Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SafeBrowsingMode, SAFE_BROWSING_MODES } from "@/lib/constants/safe-browsing"

const MODE_ICONS = {
  sfw: Shield,
  sfw_plus: EyeOff,
  nsfw: Eye,
}

const MODE_COLORS = {
  sfw: "text-green-600 dark:text-green-400",
  sfw_plus: "text-amber-600 dark:text-amber-400",
  nsfw: "text-red-600 dark:text-red-400",
}

const MODE_BG = {
  sfw: "bg-green-50 dark:bg-green-950/30",
  sfw_plus: "bg-amber-50 dark:bg-amber-950/30",
  nsfw: "bg-red-50 dark:bg-red-950/30",
}

export function SafeBrowsingIndicator() {
  const { mode, indicator, setMode, isLoading } = useSafeBrowsing()

  if (isLoading || indicator === "hidden") {
    return null
  }

  const Icon = MODE_ICONS[mode]
  const label = SAFE_BROWSING_MODES.find((m) => m.value === mode)?.label || "Unknown"

  if (indicator === "icon") {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className={`${MODE_COLORS[mode]} h-8 w-8`}
              onClick={() => {
                const modes: SafeBrowsingMode[] = ["sfw", "sfw_plus", "nsfw"]
                const currentIndex = modes.indexOf(mode)
                const nextIndex = (currentIndex + 1) % modes.length
                setMode(modes[nextIndex])
              }}
            >
              <Icon className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>{label}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={`${MODE_BG[mode]} ${MODE_COLORS[mode]} h-8 gap-2 px-3 text-xs font-medium`}
        >
          <Icon className="size-3.5" />
          <span className="hidden sm:inline">{mode === "sfw" ? "SFW" : mode === "sfw_plus" ? "SFW+" : "NSFW"}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {SAFE_BROWSING_MODES.map((m) => {
          const ModeIcon = MODE_ICONS[m.value]
          return (
            <DropdownMenuItem
              key={m.value}
              onClick={() => setMode(m.value)}
              className={`${mode === m.value ? MODE_BG[m.value] : ""} cursor-pointer`}
            >
              <ModeIcon className={`size-4 mr-2 ${MODE_COLORS[m.value]}`} />
              <div className="flex flex-col">
                <span className="font-medium">{m.value === "sfw" ? "SFW" : m.value === "sfw_plus" ? "SFW+" : "NSFW"}</span>
                <span className="text-xs text-zinc-500">{m.label.split("(")[0].trim()}</span>
              </div>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
