"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Flame, Trophy, BookOpen, Clock, TrendingUp, Heart } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { AchievementsSection } from "@/components/ui/achievements-section"
import type { AchievementProgress } from "@/lib/gamification/achievement-progress"

interface Activity {
  id: string
  type: string
  created_at: string
  series?: { id: string; title: string; cover_url: string | null } | null
  chapter?: { chapter_number: number } | null
  metadata?: any
}

interface UserProfile {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  xp: number
  level: number
  streak_days: number
  created_at: string
  privacy_settings: { library_public?: boolean; activity_public?: boolean }
}

interface ProfileStats {
  libraryCount: number
  followersCount: number
  followingCount: number
}

function ActivitySkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-start gap-3">
          <Skeleton className="size-8 rounded-full shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
      ))}
    </div>
  )
}

function ProfileSkeleton() {
  return (
    <div className="p-6 md:p-12 space-y-12 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row gap-12 items-start">
        <div className="space-y-6 shrink-0 flex flex-col items-center md:items-start">
          <Skeleton className="size-40 rounded-[2.5rem]" />
          <div className="space-y-2 text-center md:text-left">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
          <Skeleton className="h-10 w-32 rounded-2xl" />
        </div>
        <div className="flex-1 space-y-12 w-full">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-3xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function UserProfilePage({ params }: { params: Promise<{ username: string }> }) {
  const [username, setUsername] = useState<string | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [libraryEntries, setLibraryEntries] = useState<any[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [isFollowing, setIsFollowing] = useState(false)
  const [isOwnProfile, setIsOwnProfile] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activitiesLoading, setActivitiesLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    params.then((p) => setUsername(p.username))
  }, [params])

  useEffect(() => {
    if (!username) return

    async function fetchProfile() {
      setLoading(true)
      try {
        const res = await fetch(`/api/users/${username}`)
        if (res.ok) {
          const data = await res.json()
          setProfile(data.user)
          setStats(data.stats)
          setLibraryEntries(data.library || [])
          setIsFollowing(data.isFollowing || false)
          setIsOwnProfile(data.isOwnProfile || false)
        } else if (res.status === 404) {
          router.push("/404")
        }
      } catch (error) {
        console.error("Failed to fetch profile:", error)
      } finally {
        setLoading(false)
      }
    }

    fetchProfile()
  }, [username, router])

  useEffect(() => {
    if (!username || !profile) return

    async function fetchActivities() {
      setActivitiesLoading(true)
      try {
        const res = await fetch(`/api/users/${username}/activity?limit=10`)
        if (res.ok) {
          const data = await res.json()
          setActivities(data.activities || [])
        }
      } catch (error) {
        console.error("Failed to fetch activities:", error)
      } finally {
        setActivitiesLoading(false)
      }
    }

    if (profile.privacy_settings?.activity_public !== false || isOwnProfile) {
      fetchActivities()
    } else {
      setActivitiesLoading(false)
    }
  }, [username, profile, isOwnProfile])

  const handleFollow = async () => {
    if (!profile) return
    
    const wasFollowing = isFollowing
    const prevStats = stats

    setIsFollowing(!wasFollowing)
    if (stats) {
      setStats({
        ...stats,
        followersCount: wasFollowing ? stats.followersCount - 1 : stats.followersCount + 1,
      })
    }

    try {
      const method = wasFollowing ? "DELETE" : "POST"
      const res = await fetch(`/api/users/${username}/follow`, { method })

      if (!res.ok) {
        setIsFollowing(wasFollowing)
        setStats(prevStats)
        toast.error("Failed to update follow status")
      } else {
        toast.success(wasFollowing ? "Unfollowed" : "Following")
      }
    } catch (error) {
      setIsFollowing(wasFollowing)
      setStats(prevStats)
      toast.error("Failed to update follow status")
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return "Just now"
    if (diffMins < 60) return `${diffMins}m ago`
    if (diffHours < 24) return `${diffHours}h ago`
    if (diffDays < 7) return `${diffDays}d ago`
    return date.toLocaleDateString()
  }

  const getActivityIcon = (type: string) => {
    switch (type) {
      case "chapter_read":
        return <BookOpen className="size-4 text-blue-500" />
      case "series_added":
        return <Heart className="size-4 text-pink-500" />
      case "level_up":
        return <TrendingUp className="size-4 text-green-500" />
      case "achievement_unlocked":
        return <Trophy className="size-4 text-yellow-500" />
      default:
        return <Clock className="size-4 text-zinc-400" />
    }
  }

  const getActivityText = (activity: Activity) => {
    switch (activity.type) {
      case "chapter_read":
        return (
          <>
            Read chapter {activity.chapter?.chapter_number} of{" "}
            <span className="font-semibold">{activity.series?.title}</span>
          </>
        )
      case "series_added":
        return (
          <>
            Added <span className="font-semibold">{activity.series?.title}</span> to library
          </>
        )
      case "level_up":
        return <>Reached level {activity.metadata?.level}</>
      case "achievement_unlocked":
        return <>Unlocked achievement: {activity.metadata?.achievement_name}</>
      default:
        return "Activity"
    }
  }

  if (loading) {
    return <ProfileSkeleton />
  }

  if (!profile) {
    return null
  }

  const isLibraryPublic = profile.privacy_settings?.library_public !== false
  const isActivityPublic = profile.privacy_settings?.activity_public !== false

  return (
    <div className="p-6 md:p-12 space-y-12 max-w-7xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row gap-12 items-start">
        <div className="space-y-6 shrink-0 flex flex-col items-center md:items-start text-center md:text-left">
          <div className="size-40 rounded-[2.5rem] bg-zinc-100 dark:bg-zinc-900 border-4 border-white dark:border-zinc-950 shadow-2xl flex items-center justify-center overflow-hidden">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt={profile.username} className="h-full w-full object-cover" />
            ) : (
              <span className="text-6xl font-black text-zinc-300 uppercase">{profile.username[0]}</span>
            )}
          </div>

          <div className="space-y-2">
            <h1 className="text-3xl font-black tracking-tight">{profile.username}</h1>
            <p className="text-zinc-500 font-medium">Level {profile.level} Reader</p>
            {profile.bio && <p className="text-sm text-zinc-600 dark:text-zinc-400 max-w-xs">{profile.bio}</p>}
          </div>

          <div className="flex items-center gap-2">
            {isOwnProfile ? (
              <Link href="/settings">
                <Button variant="outline" className="rounded-2xl px-8 font-bold">
                  Edit Profile
                </Button>
              </Link>
            ) : (
              <Button
                  onClick={handleFollow}
                  className={`rounded-2xl px-12 font-bold transition-all ${
                    isFollowing
                      ? "bg-zinc-100 text-zinc-900 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-50"
                      : "bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900"
                  }`}
                >
                  {isFollowing ? "Following" : "Follow"}
                </Button>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-12 w-full">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 text-center space-y-1 shadow-sm">
                <p className="text-2xl font-black">{profile.xp.toLocaleString()}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Total XP</p>
              </div>
              <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 text-center space-y-1 shadow-sm">
                <p className="text-2xl font-black flex items-center justify-center gap-2">
                  <Flame className="size-5 text-orange-500 fill-orange-500" />
                  {profile.streak_days}
                </p>
                <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Day Streak</p>
              </div>
              <Link href={`/users/${username}/followers`}>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 text-center space-y-1 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer">
                  <p className="text-2xl font-black">{stats?.followersCount || 0}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Followers</p>
                </div>
              </Link>
              <Link href={`/users/${username}/following`}>
                <div className="bg-zinc-50 dark:bg-zinc-900/50 p-6 rounded-3xl border border-zinc-100 dark:border-zinc-800 text-center space-y-1 shadow-sm hover:border-zinc-300 dark:hover:border-zinc-700 transition-colors cursor-pointer">
                  <p className="text-2xl font-black">{stats?.followingCount || 0}</p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Following</p>
                </div>
              </Link>
            </div>

          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <BookOpen className="size-5 text-zinc-400" />
              Reading Now
            </h2>
            {isLibraryPublic || isOwnProfile ? (
              libraryEntries.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
                  {libraryEntries.slice(0, 6).map((entry: any) => (
                    <Link key={entry.id} href={`/series/${entry.series_id}`} className="group space-y-2">
                      <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 transition-all group-hover:scale-[1.02]">
                        {entry.series?.cover_url && (
                          <img src={entry.series.cover_url} className="h-full w-full object-cover" alt="" />
                        )}
                      </div>
                      <h3 className="font-bold text-xs truncate px-1">{entry.series?.title}</h3>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <p className="text-zinc-500 text-sm font-medium">No series in library yet</p>
                </div>
              )
            ) : (
              <div className="p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                <p className="text-zinc-500 text-sm font-medium">This library is private</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <Clock className="size-5 text-zinc-400" />
              Recent Activity
            </h2>
            {isActivityPublic || isOwnProfile ? (
              activitiesLoading ? (
                <ActivitySkeleton />
              ) : activities.length > 0 ? (
                <div className="space-y-4">
                  {activities.map((activity) => (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900/50 transition-colors"
                    >
                      <div className="size-8 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center shrink-0">
                        {getActivityIcon(activity.type)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-zinc-700 dark:text-zinc-300">{getActivityText(activity)}</p>
                        <p className="text-xs text-zinc-500">{formatDate(activity.created_at)}</p>
                      </div>
                      {activity.series?.cover_url && (
                        <div className="size-10 rounded-lg overflow-hidden shrink-0">
                          <img src={activity.series.cover_url} className="h-full w-full object-cover" alt="" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                  <p className="text-zinc-500 text-sm font-medium">No recent activity</p>
                </div>
              )
            ) : (
              <div className="p-12 text-center bg-zinc-50 dark:bg-zinc-900/50 rounded-3xl border border-dashed border-zinc-200 dark:border-zinc-800">
                <p className="text-zinc-500 text-sm font-medium">Activity is private</p>
              </div>
            )}
          </div>

          {/* Achievements section with tabs and progress bars */}
          <AchievementsSection
            userId={profile.id}
            isOwnProfile={isOwnProfile}
          />
        </div>
      </div>
    </div>
  )
}
