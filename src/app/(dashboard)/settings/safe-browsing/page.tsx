"use client"

import { useSafeBrowsing } from "@/lib/context/safe-browsing-context"
import { SAFE_BROWSING_MODES, SAFE_BROWSING_INDICATORS, SafeBrowsingMode, SafeBrowsingIndicator } from "@/lib/constants/safe-browsing"
import { Shield, EyeOff, Eye, Info } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

const MODE_ICONS = {
  sfw: Shield,
  sfw_plus: EyeOff,
  nsfw: Eye,
}

const MODE_COLORS = {
  sfw: "border-green-500 bg-green-50 dark:bg-green-950/30",
  sfw_plus: "border-amber-500 bg-amber-50 dark:bg-amber-950/30",
  nsfw: "border-red-500 bg-red-50 dark:bg-red-950/30",
}

const MODE_ICON_COLORS = {
  sfw: "text-green-600 dark:text-green-400",
  sfw_plus: "text-amber-600 dark:text-amber-400",
  nsfw: "text-red-600 dark:text-red-400",
}

export default function SafeBrowsingSettingsPage() {
  const { mode, indicator, setMode, setIndicator, isLoading } = useSafeBrowsing()

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-8">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-96" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-8 pb-24">
      <div className="space-y-2">
        <h1 className="text-3xl font-extrabold tracking-tight">Safe Browsing</h1>
        <p className="text-zinc-500">Control how mature content is displayed across the application.</p>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold">Browsing Mode</h2>
        <div className="space-y-3">
          {SAFE_BROWSING_MODES.map((m) => {
            const Icon = MODE_ICONS[m.value]
            const isSelected = mode === m.value
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
                  isSelected
                    ? MODE_COLORS[m.value]
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`shrink-0 size-10 rounded-lg flex items-center justify-center ${
                      isSelected ? MODE_ICON_COLORS[m.value] : "text-zinc-400"
                    } ${isSelected ? "" : "bg-zinc-100 dark:bg-zinc-900"}`}
                  >
                    <Icon className="size-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{m.label}</span>
                      {isSelected && (
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900">
                          Active
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-zinc-500 mt-1">{m.description}</p>
                  </div>
                  <div
                    className={`shrink-0 size-5 rounded-full border-2 transition-all ${
                      isSelected
                        ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100"
                        : "border-zinc-300 dark:border-zinc-700"
                    }`}
                  >
                    {isSelected && (
                      <div className="size-full flex items-center justify-center">
                        <div className="size-2 rounded-full bg-white dark:bg-zinc-900" />
                      </div>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold">Header Indicator</h2>
        <p className="text-sm text-zinc-500">Choose how the safe browsing toggle appears in the header.</p>
        <div className="space-y-2">
          {SAFE_BROWSING_INDICATORS.map((ind) => {
            const isSelected = indicator === ind.value
            return (
              <button
                key={ind.value}
                type="button"
                onClick={() => setIndicator(ind.value)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all flex items-center justify-between ${
                  isSelected
                    ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-900"
                    : "border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700"
                }`}
              >
                <span className={`font-medium ${isSelected ? "" : "text-zinc-600 dark:text-zinc-400"}`}>
                  {ind.label}
                </span>
                <div
                  className={`size-5 rounded-full border-2 transition-all ${
                    isSelected
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-900 dark:bg-zinc-100"
                      : "border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {isSelected && (
                    <div className="size-full flex items-center justify-center">
                      <div className="size-2 rounded-full bg-white dark:bg-zinc-900" />
                    </div>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800">
        <Info className="size-5 text-zinc-400 shrink-0 mt-0.5" />
        <p className="text-sm text-zinc-500">
          This application displays metadata and external links only. Content availability and ratings are provided by third-party sources.
        </p>
      </div>
    </div>
  )
}
