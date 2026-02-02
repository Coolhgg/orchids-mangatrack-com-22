"use client"

import { useState, useEffect } from "react"
import { cn } from "@/lib/utils"
import { AchievementCardGrid } from "@/components/ui/achievement-card"
import { AchievementProgressBar, CompactProgressCard } from "@/components/ui/achievement-progress"
import { SeasonalAchievementsSection } from "@/components/ui/seasonal-achievements"
import { Trophy, TrendingUp, Check, Sparkles, Loader2 } from "lucide-react"
import type { AchievementProgress } from "@/lib/gamification/achievement-progress"

type TabId = "all" | "in_progress" | "unlocked" | "seasonal"

interface Tab {
  id: TabId
  label: string
  icon: React.ReactNode
}

const TABS: Tab[] = [
  { id: "all", label: "All", icon: <Trophy className="size-4" /> },
  { id: "in_progress", label: "In Progress", icon: <TrendingUp className="size-4" /> },
  { id: "unlocked", label: "Unlocked", icon: <Check className="size-4" /> },
  { id: "seasonal", label: "Seasonal", icon: <Sparkles className="size-4" /> },
]

interface AchievementsSectionProps {
  userId?: string
  isOwnProfile?: boolean
  initialTab?: TabId
  className?: string
}

export function AchievementsSection({
  userId,
  isOwnProfile = false,
  initialTab = "all",
  className,
}: AchievementsSectionProps) {
  const [activeTab, setActiveTab] = useState<TabId>(initialTab)
  const [achievements, setAchievements] = useState<AchievementProgress[]>([])
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<{
    unlockedCount: number
    totalVisible: number
    chaptersRead: number
    currentStreak: number
  } | null>(null)

  useEffect(() => {
    async function fetchAchievements() {
      setLoading(true)
      try {
        const endpoint = activeTab === "seasonal" 
          ? "/api/users/me/achievements/seasonal"
          : `/api/users/me/achievements?view=${activeTab}&limit=50`
        
        const res = await fetch(endpoint)
        if (res.ok) {
          const data = await res.json()
          setAchievements(data.achievements || [])
          if (data.stats) {
            setStats(data.stats)
          }
        }
      } catch (error) {
        console.error("Failed to fetch achievements:", error)
      } finally {
        setLoading(false)
      }
    }

    if (isOwnProfile) {
      fetchAchievements()
    }
  }, [activeTab, isOwnProfile])

  const sortedAchievements = [...achievements].sort((a, b) => {
    if (a.isUnlocked !== b.isUnlocked) {
      return a.isUnlocked ? 1 : -1
    }
    if (!a.isUnlocked && !b.isUnlocked) {
      return b.progressPercent - a.progressPercent
    }
    const rarityOrder: Record<string, number> = { legendary: 5, epic: 4, rare: 3, uncommon: 2, common: 1 }
    return (rarityOrder[b.rarity.toLowerCase()] || 1) - (rarityOrder[a.rarity.toLowerCase()] || 1)
  })

  const inProgressAchievements = sortedAchievements.filter(
    a => !a.isUnlocked && a.progressPercent > 0 && a.progressPercent < 100
  )

  const unlockedAchievements = sortedAchievements.filter(a => a.isUnlocked)

  if (!isOwnProfile) {
    return (
      <div className={cn("space-y-6", className)}>
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Trophy className="size-5 text-zinc-400" />
            Achievements
          </h2>
          {stats && (
            <span className="text-sm text-zinc-500">
              {stats.unlockedCount} unlocked
            </span>
          )}
        </div>
        <AchievementCardGrid
          achievements={unlockedAchievements}
          size="md"
          columns={4}
          emptyMessage="No achievements unlocked yet"
        />
      </div>
    )
  }

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Trophy className="size-5 text-zinc-400" />
          Achievements
        </h2>
        {stats && (
          <div className="flex items-center gap-4 text-sm">
            <span className="text-zinc-500">
              <span className="font-bold text-foreground">{stats.unlockedCount}</span> / {stats.totalVisible} unlocked
            </span>
          </div>
        )}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-2 -mb-2 scrollbar-none">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap",
              activeTab === tab.id
                ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-6 animate-spin text-zinc-400" />
        </div>
      ) : (
        <>
          {activeTab === "all" && (
            <div className="space-y-8">
              {inProgressAchievements.length > 0 && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
                    Next Up
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {inProgressAchievements.slice(0, 3).map((progress) => (
                      <CompactProgressCard key={progress.achievementId} progress={progress} />
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-zinc-500 uppercase tracking-wider">
                  All Achievements
                </h3>
                <AchievementCardGrid
                  achievements={sortedAchievements}
                  size="md"
                  columns={4}
                  emptyMessage="No achievements available"
                />
              </div>
            </div>
          )}

          {activeTab === "in_progress" && (
            <div className="space-y-4">
              {inProgressAchievements.length > 0 ? (
                <div className="space-y-3">
                  {inProgressAchievements.map((progress) => (
                    <AchievementProgressBar
                      key={progress.achievementId}
                      progress={progress}
                      size="md"
                      showDescription={true}
                      showXp={true}
                    />
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <TrendingUp className="size-8 mx-auto text-zinc-300 dark:text-zinc-700 mb-3" />
                  <p className="text-zinc-500 text-sm font-medium">No achievements in progress</p>
                  <p className="text-zinc-400 text-xs mt-1">Start reading to unlock achievements!</p>
                </div>
              )}
            </div>
          )}

          {activeTab === "unlocked" && (
            <AchievementCardGrid
              achievements={unlockedAchievements}
              size="md"
              columns={4}
              emptyMessage="No achievements unlocked yet. Keep reading!"
            />
          )}

          {activeTab === "seasonal" && (
              <SeasonalAchievementsSection />
            )}
        </>
      )}
    </div>
  )
}

interface AchievementsSectionExternalProps {
  achievements: AchievementProgress[]
  className?: string
}

export function AchievementsSectionExternal({
  achievements,
  className,
}: AchievementsSectionExternalProps) {
  const unlockedAchievements = achievements.filter(a => a.isUnlocked)

  return (
    <div className={cn("space-y-6", className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <Trophy className="size-5 text-zinc-400" />
          Achievements
        </h2>
        <span className="text-sm text-zinc-500">
          {unlockedAchievements.length} unlocked
        </span>
      </div>
      <AchievementCardGrid
        achievements={unlockedAchievements}
        size="md"
        columns={4}
        emptyMessage="No achievements unlocked yet"
      />
    </div>
  )
}
