"use client"

import { createContext, useContext, useState, useEffect, useCallback, ReactNode, useRef } from "react"
import { AgeVerificationModal } from "@/components/ui/age-verification-modal"
import {
  SafeBrowsingMode,
  SafeBrowsingIndicator,
  SAFE_BROWSING_STORAGE_KEY,
  SAFE_BROWSING_INDICATOR_STORAGE_KEY,
} from "@/lib/constants/safe-browsing"

interface SafeBrowsingContextValue {
  mode: SafeBrowsingMode
  indicator: SafeBrowsingIndicator
  isLoading: boolean
  isAuthenticated: boolean
  setMode: (mode: SafeBrowsingMode) => Promise<void>
  setIndicator: (indicator: SafeBrowsingIndicator) => Promise<void>
  cycleMode: () => void
}

const SafeBrowsingContext = createContext<SafeBrowsingContextValue | null>(null)

export function SafeBrowsingProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<SafeBrowsingMode>("sfw")
  const [indicator, setIndicatorState] = useState<SafeBrowsingIndicator>("toggle")
  const [isLoading, setIsLoading] = useState(true)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAgeModalOpen, setIsAgeModalOpen] = useState(false)
  
  // FIX: Use a ref to avoid stale closure issues with the modal callback
  // When setState batches updates, the callback passed to the modal might have
  // the old pendingMode value. Using a ref ensures we always read the latest value.
  const pendingModeRef = useRef<SafeBrowsingMode | null>(null)

  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/users/me")
        if (res.ok) {
          const user = await res.json()
          setModeState(user.safe_browsing_mode || "sfw")
          setIndicatorState(user.safe_browsing_indicator || "toggle")
          setIsAuthenticated(true)
        } else {
          // STRICT ENFORCEMENT: Clear local storage and force SFW for guests
          localStorage.removeItem(SAFE_BROWSING_STORAGE_KEY)
          localStorage.removeItem(SAFE_BROWSING_INDICATOR_STORAGE_KEY)
          setModeState("sfw")
          setIndicatorState("toggle")
          setIsAuthenticated(false)
        }
      } catch {
        setModeState("sfw")
        setIndicatorState("toggle")
        setIsAuthenticated(false)
      } finally {
        setIsLoading(false)
      }
    }
    loadSettings()
  }, [])

  const executeSetMode = useCallback(async (newMode: SafeBrowsingMode) => {
    if (!isAuthenticated) {
      return
    }
    setModeState(newMode)
    localStorage.setItem(SAFE_BROWSING_STORAGE_KEY, newMode)

    try {
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ safe_browsing_mode: newMode }),
      })
    } catch {
      console.error("Failed to save safe browsing mode to server")
    }
  }, [isAuthenticated])

  const setMode = useCallback(async (newMode: SafeBrowsingMode) => {
    if (newMode === "nsfw" && mode !== "nsfw") {
      // FIX: Store in ref so the modal callback always reads the latest value
      pendingModeRef.current = newMode
      setIsAgeModalOpen(true)
      return
    }
    await executeSetMode(newMode)
  }, [mode, executeSetMode])

  // FIX: Read from ref instead of state to avoid stale closure
  const handleAgeConfirm = useCallback(async () => {
    const pendingMode = pendingModeRef.current
    if (pendingMode) {
      await executeSetMode(pendingMode)
    }
    setIsAgeModalOpen(false)
    pendingModeRef.current = null
  }, [executeSetMode])

  const handleAgeCancel = useCallback(() => {
    setIsAgeModalOpen(false)
    pendingModeRef.current = null
  }, [])

  const setIndicator = useCallback(async (newIndicator: SafeBrowsingIndicator) => {
    if (!isAuthenticated) {
      return
    }
    setIndicatorState(newIndicator)
    localStorage.setItem(SAFE_BROWSING_INDICATOR_STORAGE_KEY, newIndicator)

    try {
      await fetch("/api/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ safe_browsing_indicator: newIndicator }),
      })
    } catch {
      console.error("Failed to save safe browsing indicator to server")
    }
  }, [isAuthenticated])

  const cycleMode = useCallback(() => {
    const modes: SafeBrowsingMode[] = ["sfw", "sfw_plus", "nsfw"]
    const currentIndex = modes.indexOf(mode)
    const nextIndex = (currentIndex + 1) % modes.length
    setMode(modes[nextIndex])
  }, [mode, setMode])

  return (
    <SafeBrowsingContext.Provider
      value={{
        mode,
        indicator,
        isLoading,
        isAuthenticated,
        setMode,
        setIndicator,
        cycleMode,
      }}
    >
      {children}
      <AgeVerificationModal
        isOpen={isAgeModalOpen}
        onConfirm={handleAgeConfirm}
        onCancel={handleAgeCancel}
      />
    </SafeBrowsingContext.Provider>
  )
}

export function useSafeBrowsing(): SafeBrowsingContextValue {
  const context = useContext(SafeBrowsingContext)
  
  if (!context) {
    return {
      mode: "sfw",
      indicator: "toggle",
      isLoading: true,
      isAuthenticated: false,
      setMode: async () => {},
      setIndicator: async () => {},
      cycleMode: () => {},
    }
  }
  
  return context
}
