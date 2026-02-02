"use client"

import { useEffect, useCallback, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import type { RealtimeChannel } from "@supabase/supabase-js"
import { FeedCache } from "@/lib/feed-cache"

interface Notification {
  id: string
  type: string
  title: string
  message: string | null
  read_at: string | null
  created_at: string
}

interface UseRealtimeNotificationsOptions {
  userId: string | null
  onNewNotification?: (notification: Notification) => void
  onNotificationRead?: (notificationId: string) => void
}

export function useRealtimeNotifications({
  userId,
  onNewNotification,
  onNotificationRead,
}: UseRealtimeNotificationsOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null)
  const supabaseRef = useRef(createClient())
  
  // Use refs to store callbacks to avoid stale closure issues
  const onNewNotificationRef = useRef(onNewNotification)
  const onNotificationReadRef = useRef(onNotificationRead)
  
  // Update refs when callbacks change
  useEffect(() => {
    onNewNotificationRef.current = onNewNotification
  }, [onNewNotification])
  
  useEffect(() => {
    onNotificationReadRef.current = onNotificationRead
  }, [onNotificationRead])

  const cleanup = useCallback(() => {
    if (channelRef.current) {
      supabaseRef.current.removeChannel(channelRef.current)
      channelRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!userId) return

    // Cleanup any existing channel before creating a new one
    cleanup()

    const supabase = supabaseRef.current

    channelRef.current = supabase
      .channel(`notifications:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notification = payload.new as Notification
          
          // Invalidate feed cache on new chapter notifications
          if (notification.type === 'new_chapter') {
            FeedCache.invalidate('releases')
          }
          
          onNewNotificationRef.current?.(notification)
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const notification = payload.new as Notification
          if (notification.read_at) {
            onNotificationReadRef.current?.(notification.id)
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log("Realtime notifications connected")
        }
        if (status === "CHANNEL_ERROR") {
          console.error("Realtime notifications error")
        }
      })

    return cleanup
  }, [userId, cleanup])

  return { cleanup }
}
