"use client"

import { useState, useEffect, useCallback, Suspense } from "react"
import { Button } from "@/components/ui/button"
import { Users, UserPlus, UserMinus, Search, Loader2, Sparkles, Trophy } from "lucide-react"
import Link from "next/link"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { useRouter, useSearchParams } from "next/navigation"

interface User {
  id: string
  username: string
  avatar_url: string | null
  xp: number
  level: number
}

interface FollowRelation {
  id: string
  user: User
}

function UserListSkeleton() {
  return (
    <div className="space-y-3">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-4 p-3 rounded-xl">
          <Skeleton className="size-10 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-8 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

function FriendsPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const query = searchParams.get("q") || ""
  
  const [following, setFollowing] = useState<FollowRelation[]>([])
  const [followers, setFollowers] = useState<FollowRelation[]>([])
  const [suggested, setSuggested] = useState<User[]>([])
  const [searchResults, setSearchResults] = useState<User[]>([])
  const [searchQuery, setSearchQuery] = useState(query)
  
  const [loading, setLoading] = useState(true)
  const [searching, setSearching] = useState(false)
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set())
  const [loadingFollow, setLoadingFollow] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/users/me/social")
      if (res.ok) {
        const data = await res.json()
        setFollowing(data.following || [])
        setFollowers(data.followers || [])
        setSuggested(data.suggested || [])
        setFollowingIds(new Set((data.following || []).map((f: FollowRelation) => f.user.id)))
      }
    } catch (error) {
      console.error("Failed to fetch social data:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  useEffect(() => {
    if (!query) {
      setSearchResults([])
      return
    }
    
    const searchUsers = async () => {
      setSearching(true)
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(query)}`)
        if (res.ok) {
          const data = await res.json()
          setSearchResults(data.users || [])
        }
      } catch (error) {
        console.error("Search failed:", error)
      } finally {
        setSearching(false)
      }
    }
    
    searchUsers()
  }, [query])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    router.push(`/friends?q=${encodeURIComponent(searchQuery)}`)
  }

  const handleFollow = async (userId: string, username: string) => {
    setLoadingFollow(userId)
    const isFollowing = followingIds.has(userId)
    
    try {
      const res = await fetch(`/api/users/${username}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
      })
      
      if (res.ok) {
        if (isFollowing) {
          setFollowingIds((prev) => {
            const next = new Set(prev)
            next.delete(userId)
            return next
          })
          setFollowing((prev) => prev.filter((f) => f.user.id !== userId))
          toast.success(`Unfollowed @${username}`)
        } else {
          setFollowingIds((prev) => new Set(prev).add(userId))
          toast.success(`Now following @${username}`)
        }
      } else {
        toast.error("Failed to update follow status")
      }
    } catch (error) {
      toast.error("Something went wrong")
    } finally {
      setLoadingFollow(null)
    }
  }

  const renderUserCard = (user: User, showFollowButton = true) => {
    const isFollowing = followingIds.has(user.id)
    
    return (
      <div className="flex items-center justify-between p-4 rounded-2xl bg-white dark:bg-zinc-950 border border-zinc-100 dark:border-zinc-800 hover:shadow-md transition-all">
        <Link href={`/users/${user.username}`} className="flex items-center gap-4 flex-1 min-w-0">
          <div className="size-12 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center overflow-hidden shrink-0">
            {user.avatar_url ? (
              <img src={user.avatar_url} className="h-full w-full object-cover" alt="" />
            ) : (
              <span className="font-bold text-zinc-400">{user.username[0].toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm truncate">{user.username}</p>
            <p className="text-xs text-zinc-500">Level {user.level || 1} • {user.xp.toLocaleString()} XP</p>
          </div>
        </Link>
        {showFollowButton && (
          <Button 
            size="sm" 
            variant={isFollowing ? "outline" : "default"}
            className={`rounded-full px-4 shrink-0 ${
              isFollowing 
                ? "border-zinc-200 dark:border-zinc-800" 
                : "bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
            }`}
            onClick={(e) => {
              e.preventDefault()
              handleFollow(user.id, user.username)
            }}
            disabled={loadingFollow === user.id}
          >
            {loadingFollow === user.id ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isFollowing ? (
              <>
                <UserMinus className="size-4 mr-1" />
                Unfollow
              </>
            ) : (
              <>
                <UserPlus className="size-4 mr-1" />
                Follow
              </>
            )}
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="p-6 md:p-12 space-y-12 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">Social Network</h1>
          <p className="text-zinc-500">Connect with other readers and share progress</p>
        </div>
        <form onSubmit={handleSearch} className="relative w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <Input 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search users..." 
            className="pl-10 bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 rounded-xl"
          />
        </form>
      </div>

      {query && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Search className="size-5 text-zinc-400" />
            Search Results for "{query}"
          </h2>
          {searching ? (
            <UserListSkeleton />
          ) : searchResults.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {searchResults.map((user) => (
                <div key={user.id}>{renderUserCard(user)}</div>
              ))}
            </div>
          ) : (
            <p className="text-zinc-500 text-sm py-8 italic">No users found matching "{query}"</p>
          )}
        </div>
      )}

      {!query && suggested.length > 0 && (
        <div className="space-y-6">
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Sparkles className="size-5 text-yellow-500" />
            Suggested for You
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {suggested.map((user) => (
              <div key={user.id}>{renderUserCard(user)}</div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Following</h2>
            <UserListSkeleton />
          </div>
          <div className="space-y-6">
            <h2 className="text-xl font-bold">Followers</h2>
            <UserListSkeleton />
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-blue-500" />
              <h2 className="text-xl font-bold">Following ({following.length})</h2>
            </div>
            <div className="space-y-3">
              {following.length > 0 ? (
                following.map((f) => (
                  <Link 
                    key={f.id} 
                    href={`/users/${f.user.username}`} 
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 group"
                  >
                    <div className="size-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {f.user.avatar_url ? (
                        <img src={f.user.avatar_url} className="h-full w-full object-cover" alt="" />
                      ) : (
                        <span className="text-xs font-bold text-zinc-400">{f.user.username[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{f.user.username}</p>
                      <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Level {f.user.level || 1}</p>
                    </div>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      className="rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-xs"
                      onClick={(e) => {
                        e.preventDefault()
                        handleFollow(f.user.id, f.user.username)
                      }}
                      disabled={loadingFollow === f.user.id}
                    >
                      {loadingFollow === f.user.id ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <UserMinus className="size-3 mr-1" />
                      )}
                      Unfollow
                    </Button>
                  </Link>
                ))
              ) : (
                <div className="py-8 text-center">
                  <p className="text-zinc-500 text-sm italic mb-4">You aren't following anyone yet</p>
                  <Link href="/leaderboard">
                    <Button variant="outline" className="rounded-full">
                      <Trophy className="size-4 mr-2" />
                      Browse Leaderboard
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <Users className="size-5 text-purple-500" />
              <h2 className="text-xl font-bold">Followers ({followers.length})</h2>
            </div>
            <div className="space-y-3">
              {followers.length > 0 ? (
                followers.map((f) => (
                  <Link 
                    key={f.id} 
                    href={`/users/${f.user.username}`} 
                    className="flex items-center gap-4 p-3 rounded-xl hover:bg-zinc-50 dark:hover:bg-zinc-900 transition-colors border border-transparent hover:border-zinc-100 dark:hover:border-zinc-800 group"
                  >
                    <div className="size-10 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center overflow-hidden">
                      {f.user.avatar_url ? (
                        <img src={f.user.avatar_url} className="h-full w-full object-cover" alt="" />
                      ) : (
                        <span className="text-xs font-bold text-zinc-400">{f.user.username[0].toUpperCase()}</span>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold truncate">{f.user.username}</p>
                      <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-wider">Level {f.user.level || 1}</p>
                    </div>
                    {!followingIds.has(f.user.id) && (
                      <Button 
                        size="sm" 
                        className="rounded-full opacity-0 group-hover:opacity-100 transition-opacity text-xs bg-zinc-900 text-zinc-50 dark:bg-zinc-50 dark:text-zinc-900"
                        onClick={(e) => {
                          e.preventDefault()
                          handleFollow(f.user.id, f.user.username)
                        }}
                        disabled={loadingFollow === f.user.id}
                      >
                        {loadingFollow === f.user.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <UserPlus className="size-3 mr-1" />
                        )}
                        Follow Back
                      </Button>
                    )}
                    {followingIds.has(f.user.id) && (
                      <span className="text-[10px] font-bold text-green-500 uppercase tracking-wider">Following</span>
                    )}
                  </Link>
                ))
              ) : (
                <p className="text-zinc-500 text-sm py-8 italic text-center">No followers yet</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FriendsPageSkeleton() {
  return (
    <div className="p-6 md:p-12 space-y-12 max-w-5xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="space-y-1">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-64" />
        </div>
        <Skeleton className="h-10 w-full md:w-80 rounded-xl" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
        <div className="space-y-6">
          <Skeleton className="h-7 w-32" />
          <UserListSkeleton />
        </div>
        <div className="space-y-6">
          <Skeleton className="h-7 w-32" />
          <UserListSkeleton />
        </div>
      </div>
    </div>
  )
}

export default function FriendsPage() {
  return (
    <Suspense fallback={<FriendsPageSkeleton />}>
      <FriendsPageContent />
    </Suspense>
  )
}
