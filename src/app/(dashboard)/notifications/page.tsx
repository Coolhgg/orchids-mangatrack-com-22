"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Bell, Check, Inbox, Loader2, BookOpen, Users, Trophy } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { useRealtimeNotifications } from "@/hooks/use-realtime-notifications"
import { createClient } from "@/lib/supabase/client"

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  read_at: string | null
  created_at: string
  series?: {
    id: string
    title: string
    cover_url: string | null
  } | null
  actor?: {
    id: string
    username: string
    avatar_url: string | null
  } | null
}

function NotificationSkeleton() {
  return (
    <div className="space-y-4">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-start gap-4 p-4 rounded-2xl border border-zinc-100 dark:border-zinc-900">
          <Skeleton className="size-12 rounded-xl shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-64" />
          </div>
          <Skeleton className="size-2 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [markingId, setMarkingId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"all" | "chapters" | "social">("all")
  const [unreadCount, setUnreadCount] = useState(0)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null)
    })
  }, [])

  const handleNewNotification = useCallback((notification: Notification) => {
    setNotifications((prev) => [notification, ...prev])
    setUnreadCount((prev) => prev + 1)
    toast.info(notification.title, {
      description: notification.message ?? undefined,
    })
  }, [])

  const handleNotificationRead = useCallback((notificationId: string) => {
    setNotifications((prev) =>
      prev.map((n) =>
        n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
      )
    )
  }, [])

  useRealtimeNotifications({
    userId,
    onNewNotification: handleNewNotification,
    onNotificationRead: handleNotificationRead,
  })

  const fetchNotifications = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (activeTab !== "all") {
        params.set("type", activeTab === "chapters" ? "new_chapter" : "follow,achievement")
      }
      
      const res = await fetch(`/api/notifications?${params.toString()}`)
        if (res.ok) {
          const data = await res.json()
          setNotifications(data.items || data.notifications || [])
          setUnreadCount(data.unreadCount ?? data.unread_count ?? 0)
        }
    } catch (error) {
      console.error("Failed to fetch notifications:", error)
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    fetchNotifications()
  }, [fetchNotifications])

  const handleMarkAllRead = async () => {
    setMarkingAll(true)
    try {
      const res = await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markAll: true }),
      })

      if (res.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read_at: new Date().toISOString() })))
        setUnreadCount(0)
        toast.success("All notifications marked as read")
      }
    } catch (error) {
      toast.error("Failed to mark notifications as read")
    } finally {
      setMarkingAll(false)
    }
  }

  const handleMarkOneRead = async (id: string) => {
    setMarkingId(id)
    try {
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: "PATCH",
      })

      if (res.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n))
        )
        setUnreadCount((prev) => Math.max(0, prev - 1))
      }
    } catch (error) {
      toast.error("Failed to mark notification as read")
    } finally {
      setMarkingId(null)
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "new_chapter":
        return <BookOpen className="size-5 text-blue-500" />
      case "follow":
        return <Users className="size-5 text-green-500" />
      case "achievement":
        return <Trophy className="size-5 text-yellow-500" />
      default:
        return <Bell className="size-5 text-zinc-400" />
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

  const filteredNotifications = notifications

  return (
    <div className="p-6 space-y-8 max-w-4xl mx-auto pb-24">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Notifications</h1>
          <p className="text-zinc-500 dark:text-zinc-400">
            Stay updated with your followed manga
            {unreadCount > 0 && (
              <span className="ml-2 text-sm font-medium text-blue-500">
                ({unreadCount} unread)
              </span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-zinc-200 dark:border-zinc-800"
          onClick={handleMarkAllRead}
          disabled={markingAll || unreadCount === 0}
        >
          {markingAll ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Check className="size-4 mr-2" />
          )}
          Mark all as read
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="w-full">
        <TabsList className="bg-transparent border-b border-zinc-100 dark:border-zinc-900 w-full justify-start rounded-none h-auto p-0 gap-8">
          <TabsTrigger
            value="all"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold"
          >
            All
          </TabsTrigger>
          <TabsTrigger
            value="chapters"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold"
          >
            Chapters
          </TabsTrigger>
          <TabsTrigger
            value="social"
            className="rounded-none border-b-2 border-transparent data-[state=active]:border-zinc-900 dark:data-[state=active]:border-zinc-50 px-0 pb-4 font-bold"
          >
            Social
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {loading ? (
        <NotificationSkeleton />
      ) : filteredNotifications.length > 0 ? (
        <div className="space-y-4">
          {filteredNotifications.map((notification) => (
            <div
              key={notification.id}
              className={`group flex items-start gap-4 p-4 rounded-2xl border transition-all cursor-pointer ${
                notification.read_at
                  ? "bg-white dark:bg-zinc-950 border-zinc-100 dark:border-zinc-900 opacity-60"
                  : "bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800 ring-1 ring-zinc-900/5 shadow-sm"
              }`}
              onClick={() => !notification.read_at && handleMarkOneRead(notification.id)}
            >
              <div className="size-12 rounded-xl overflow-hidden shrink-0 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center bg-zinc-100 dark:bg-zinc-800">
                {notification.series?.cover_url ? (
                  <img
                    src={notification.series.cover_url}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : notification.actor?.avatar_url ? (
                  <img
                    src={notification.actor.avatar_url}
                    className="h-full w-full object-cover"
                    alt=""
                  />
                ) : (
                  getNotificationIcon(notification.type)
                )}
              </div>
              <div className="flex-1 space-y-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className={`font-bold text-sm truncate ${
                      notification.read_at ? "" : "text-zinc-900 dark:text-zinc-50"
                    }`}
                  >
                    {notification.title}
                  </h3>
                  <span className="text-[10px] text-zinc-500 font-medium whitespace-nowrap">
                    {formatDate(notification.created_at)}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 line-clamp-2">
                  {notification.message}
                </p>
              </div>
              {!notification.read_at && (
                <div className="flex items-center gap-2 shrink-0">
                  {markingId === notification.id ? (
                    <Loader2 className="size-4 animate-spin text-zinc-400" />
                  ) : (
                    <div className="size-2 rounded-full bg-blue-500 animate-pulse" />
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-24 text-center space-y-4">
          <div className="size-20 rounded-full bg-zinc-50 dark:bg-zinc-900 flex items-center justify-center text-zinc-300">
            <Inbox className="size-10" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold">No notifications yet</h3>
            <p className="text-zinc-500 dark:text-zinc-400 max-w-xs mx-auto">
              {activeTab === "chapters"
                ? "Follow some manga to get notified when new chapters are released."
                : activeTab === "social"
                  ? "Connect with other readers to see social notifications."
                  : "Follow some manga to get notified when new chapters are released."}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
