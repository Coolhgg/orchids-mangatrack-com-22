'use client'

import { useState, useEffect, useRef, ReactNode, useCallback } from 'react'

interface LandingWrapperProps {
  children: ReactNode
  totalScenes: number
}

const sceneLabels = ['Welcome', 'The Problem', 'Your Library', 'Updates', 'Discover', 'Join Us']

export default function LandingWrapper({ children, totalScenes }: LandingWrapperProps) {
  const [currentScene, setCurrentScene] = useState(0)
  const [isMobile, setIsMobile] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768)
    checkMobile()
    window.addEventListener('resize', checkMobile, { passive: true })
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollTop = container.scrollTop
          const sceneHeight = container.clientHeight
          const scene = Math.round(scrollTop / sceneHeight)
          setCurrentScene(Math.min(Math.max(0, scene), totalScenes - 1))
          ticking = false
        })
        ticking = true
      }
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [totalScenes])

  const scrollToScene = useCallback((index: number) => {
    const container = containerRef.current
    if (!container) return
    container.scrollTo({
      top: index * container.clientHeight,
      behavior: 'smooth'
    })
  }, [])

  return (
    <div
      className={`relative bg-[#0a0a0f] ${isMobile ? 'mobile-performance' : ''}`}
      data-device={isMobile ? 'mobile' : 'desktop'}
    >
      <div
        ref={containerRef}
        className="h-screen overflow-y-scroll snap-y snap-mandatory scroll-smooth gpu-accelerate"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none', WebkitOverflowScrolling: 'touch' }}
      >
        <style jsx>{`
          div::-webkit-scrollbar {
            display: none;
          }
        `}</style>
        {children}
      </div>

      <div className={`fixed right-3 md:right-6 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2 ${isMobile ? 'scale-90' : ''}`}>
        {Array.from({ length: totalScenes }).map((_, i) => (
          <button
            key={i}
            onClick={() => scrollToScene(i)}
            className="group relative flex items-center justify-end"
            aria-label={`Go to ${sceneLabels[i] || `scene ${i + 1}`}`}
          >
            <span 
              className={`absolute right-6 px-2 py-1 rounded text-xs font-medium whitespace-nowrap transition-all duration-200 ${
                currentScene === i 
                  ? 'opacity-100 translate-x-0 bg-white/10 text-white' 
                  : 'opacity-0 translate-x-2 pointer-events-none text-white/60'
              } ${isMobile ? 'hidden' : 'group-hover:opacity-100 group-hover:translate-x-0'}`}
            >
              {sceneLabels[i] || `Scene ${i + 1}`}
            </span>
            <div 
              className={`relative transition-all duration-300 ease-out ${
                currentScene === i
                  ? 'w-3 h-3 bg-neon-cyan neon-glow-cyan'
                  : 'w-2 h-2 bg-white/30 hover:bg-white/50'
              } rounded-full`}
            >
              {currentScene === i && (
                <span className="absolute inset-0 rounded-full bg-neon-cyan animate-ping opacity-30" />
              )}
            </div>
          </button>
        ))}
      </div>

      {currentScene < totalScenes - 1 && (
        <button
          onClick={() => scrollToScene(currentScene + 1)}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-1 text-white/40 hover:text-white/60 transition-colors"
          aria-label="Scroll to next scene"
        >
          <span className="text-[10px] uppercase tracking-widest font-medium">Scroll</span>
          <svg 
            width="20" 
            height="20" 
            viewBox="0 0 20 20" 
            fill="none" 
            className="text-neon-cyan animate-bounce"
          >
            <path 
              d="M10 4V16M10 16L5 11M10 16L15 11" 
              stroke="currentColor" 
              strokeWidth="2" 
              strokeLinecap="round" 
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
    </div>
  )
}
