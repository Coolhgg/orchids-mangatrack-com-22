"use client"

import { useEffect, useRef, useCallback } from "react"
import { useRouter, usePathname } from "next/navigation"
import { createClient } from "@/lib/supabase/client"

const SESSION_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour in milliseconds

interface AuthSessionProviderProps {
  children: React.ReactNode
}

export function AuthSessionProvider({ children }: AuthSessionProviderProps) {
  const router = useRouter()
  const pathname = usePathname()
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const lastActivityRef = useRef<number>(Date.now())
  
  const publicPaths = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/onboarding"]
  const isPublicPath = publicPaths.some(path => pathname === path || pathname.startsWith("/auth"))

  const handleLogout = useCallback(async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push("/login?message=" + encodeURIComponent("Session expired. Please log in again."))
  }, [router])

  const resetTimer = useCallback(() => {
    lastActivityRef.current = Date.now()
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    
    if (!isPublicPath) {
      timeoutRef.current = setTimeout(() => {
        handleLogout()
      }, SESSION_TIMEOUT_MS)
    }
  }, [isPublicPath, handleLogout])

  useEffect(() => {
    if (isPublicPath) {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      return
    }

    const events = ["mousedown", "keydown", "scroll", "touchstart", "mousemove"]
    
    const handleActivity = () => {
      const now = Date.now()
      if (now - lastActivityRef.current > 5000) {
        resetTimer()
      }
    }

    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true })
    })

    resetTimer()

    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity)
      })
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [isPublicPath, resetTimer])

  useEffect(() => {
    const supabase = createClient()
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        if (!isPublicPath) {
          resetTimer()
        }
      }
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [isPublicPath, resetTimer])

  return <>{children}</>
}
