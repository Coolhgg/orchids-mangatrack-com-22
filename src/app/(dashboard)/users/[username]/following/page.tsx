"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Users, Loader2, AlertCircle } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"

interface User {
  id: string
  username: string
  avatar_url: string | null
  bio: string | null
  level: number
  isFollowing?: boolean
}

interface PaginationInfo {
  page: number
  limit: number
  total: number
  totalPages: number
}

function UserCardSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-900">
      <Skeleton className="size-14 rounded-2xl shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-9 w-24 rounded-full" />
    </div>
  )
}

export default function FollowingPage({ params }: { params: Promise<{ username: string }> }) {
  const [username, setUsername] = useState<string | null>(null)
  const [following, setFollowing] = useState<User[]>([])
  const [pagination, setPagination] = useState<PaginationInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set())
  const [pendingFollows, setPendingFollows] = useState<Set<string>>(new Set())
  const router = useRouter()

  useEffect(() => {
    params.then((p) => setUsername(p.username))
  }, [params])

  const fetchFollowing = useCallback(async (page = 1, append = false) => {
    if (!username) return

    if (page === 1) {
      setLoading(true)
      setError(null)
    } else {
      setLoadingMore(true)
    }

    try {
      const res = await fetch(`/api/users/${username}/following?page=${page}&limit=20`)
      
      if (res.ok) {
        const data = await res.json()
        const users = data.items || data.users || []
        
        if (append) {
          setFollowing((prev) => [...prev, ...users])
        } else {
          setFollowing(users)
        }
        
        setPagination(data.pagination || {
          page,
          limit: 20,
          total: users.length,
          totalPages: 1,
        })
        
        // Update following status (these are people the user follows, so they're all "following")
        const newFollowing = new Set(followingIds)
        users.forEach((u: User) => {
          newFollowing.add(u.id)
        })
        setFollowingIds(newFollowing)
      } else if (res.status === 404) {
        router.push("/404")
      } else if (res.status === 403) {
        setError("This user's following list is private")
      } else {
        setError("Failed to load following")
      }
    } catch (err) {
      console.error("Failed to fetch following:", err)
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [username, router])

  useEffect(() => {
    if (username) {
      fetchFollowing(1)
    }
  }, [username, fetchFollowing])

  const handleFollow = useCallback(async (userId: string, isCurrentlyFollowing: boolean) => {
    if (pendingFollows.has(userId)) return

    const targetUser = following.find(u => u.id === userId)
    if (!targetUser) return

    // Optimistic update
    setPendingFollows(prev => new Set(prev).add(userId))
    setFollowingIds(prev => {
      const next = new Set(prev)
      if (isCurrentlyFollowing) {
        next.delete(userId)
      } else {
        next.add(userId)
      }
      return next
    })

    try {
      const res = await fetch(`/api/users/${targetUser.username}/follow`, {
        method: isCurrentlyFollowing ? "DELETE" : "POST",
      })

      if (!res.ok) {
        // Rollback
        setFollowingIds(prev => {
          const next = new Set(prev)
          if (isCurrentlyFollowing) {
            next.add(userId)
          } else {
            next.delete(userId)
          }
          return next
        })
        toast.error("Failed to update follow status")
      } else {
        toast.success(isCurrentlyFollowing ? "Unfollowed" : "Following")
      }
    } catch (err) {
      // Rollback
      setFollowingIds(prev => {
        const next = new Set(prev)
        if (isCurrentlyFollowing) {
          next.add(userId)
        } else {
          next.delete(userId)
        }
        return next
      })
      toast.error("Failed to update follow status")
    } finally {
      setPendingFollows(prev => {
        const next = new Set(prev)
        next.delete(userId)
        return next
      })
    }
  }, [following, pendingFollows])

  const loadMore = useCallback(() => {
    if (pagination && pagination.page < pagination.totalPages && !loadingMore) {
      fetchFollowing(pagination.page + 1, true)
    }
  }, [pagination, loadingMore, fetchFollowing])

  const hasMore = useMemo(() => {
    return pagination ? pagination.page < pagination.totalPages : false
  }, [pagination])

  if (error) {
    return (
      <div className="p-6 space-y-8 max-w-3xl mx-auto pb-24">
        <div className="flex items-center gap-4">
          <Link href={`/users/${username}`}>
            <Button variant="ghost" size="icon" className="rounded-full">
              <ArrowLeft className="size-5" />
            </Button>
          </Link>
          <h1 className="text-2xl font-bold">Following</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
            <AlertCircle className="size-10 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">{error}</h3>
            <Button onClick={() => fetchFollowing(1)} variant="outline" className="rounded-full">
              Try again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-8 max-w-3xl mx-auto pb-24">
      <div className="flex items-center gap-4">
        <Link href={`/users/${username}`}>
          <Button variant="ghost" size="icon" className="rounded-full">
            <ArrowLeft className="size-5" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Following</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            People @{username} follows
            {pagination && <span className="ml-1">({pagination.total})</span>}
          </p>
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <UserCardSkeleton key={i} />
          ))}
        </div>
      ) : following.length > 0 ? (
        <div className="space-y-4">
          {following.map((user) => {
            const isFollowing = followingIds.has(user.id)
            const isPending = pendingFollows.has(user.id)
            return (
              <div
                key={user.id}
                className="flex items-center gap-4 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-900 bg-white dark:bg-zinc-950 hover:border-zinc-200 dark:hover:border-zinc-800 transition-colors"
              >
                <Link href={`/users/${user.username}`} className="shrink-0">
                  <div className="size-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden">
                    {user.avatar_url ? (
                      <img src={user.avatar_url} alt={user.username} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-2xl font-black text-zinc-300 uppercase">{user.username[0]}</span>
                    )}
                  </div>
                </Link>
                <div className="flex-1 min-w-0">
                  <Link href={`/users/${user.username}`} className="block">
                    <h3 className="font-bold text-zinc-900 dark:text-zinc-50 truncate">{user.username}</h3>
                  </Link>
                  <p className="text-sm text-zinc-500 truncate">
                    {user.bio || `Level ${user.level || 1} Reader`}
                  </p>
                </div>
                <Button
                  onClick={() => handleFollow(user.id, isFollowing)}
                  disabled={isPending}
                  variant={isFollowing ? "outline" : "default"}
                  size="sm"
                  className={`rounded-full px-6 font-semibold shrink-0 ${
                    isFollowing
                      ? "border-zinc-200 dark:border-zinc-800"
                      : "bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900"
                  }`}
                >
                  {isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : isFollowing ? (
                    "Following"
                  ) : (
                    "Follow"
                  )}
                </Button>
              </div>
            )
          })}

          {hasMore && (
            <div className="flex justify-center pt-4">
              <Button
                onClick={loadMore}
                disabled={loadingMore}
                variant="outline"
                className="rounded-full px-8"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" />
                    Loading...
                  </>
                ) : (
                  "Load more"
                )}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <Users className="size-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">Not following anyone</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              When @{username} follows people, they&apos;ll appear here.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
