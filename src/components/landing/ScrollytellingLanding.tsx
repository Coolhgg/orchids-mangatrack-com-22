'use client'

import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import Scene0Hero from './scenes/Scene0Hero'
import Scene1Chaos from './scenes/Scene1Chaos'
import Scene2Library from './scenes/Scene2Library'
import Scene3Updates from './scenes/Scene3Updates'
import Scene4Discover from './scenes/Scene4Discover'
import Scene5CTA from './scenes/Scene5CTA'
import { GlowOrb } from './shared/MangaMotifs'

const SCENE_LABELS = ['Start', 'Problem', 'Library', 'Updates', 'Discover', 'Join'] as const

export default function ScrollytellingLanding() {
  const [currentScene, setCurrentScene] = useState(0)
  const [sceneProgresses, setSceneProgresses] = useState([0, 0, 0, 0, 0, 0])
  const [isVisible, setIsVisible] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const sceneRefs = useRef<(HTMLDivElement | null)[]>([])

  const setSceneRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    sceneRefs.current[index] = el
  }, [])

  useEffect(() => {
    setIsVisible(true)
    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReducedMotion(motionQuery.matches)
    
    const handleMotionChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches)
    }
    motionQuery.addEventListener('change', handleMotionChange)

    const handleScroll = () => {
      const newProgresses = sceneRefs.current.map((ref) => {
        if (!ref) return 0
        const rect = ref.getBoundingClientRect()
        const sceneHeight = ref.offsetHeight
        const viewportHeight = window.innerHeight
        const scrolledIntoView = viewportHeight - rect.top
        const totalScrollDistance = sceneHeight + viewportHeight
        return Math.min(Math.max(scrolledIntoView / totalScrollDistance, 0), 1)
      })

      setSceneProgresses(newProgresses)

      let maxVisibility = 0
      let mostVisibleScene = 0

      sceneRefs.current.forEach((ref, index) => {
        if (!ref) return
        const rect = ref.getBoundingClientRect()
        const viewportCenter = window.innerHeight / 2
        const sceneCenter = rect.top + rect.height / 2
        const distance = Math.abs(sceneCenter - viewportCenter)
        const visibility = 1 - Math.min(distance / window.innerHeight, 1)

        if (visibility > maxVisibility) {
          maxVisibility = visibility
          mostVisibleScene = index
        }
      })

      setCurrentScene(mostVisibleScene)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()

    return () => {
      window.removeEventListener('scroll', handleScroll)
      motionQuery.removeEventListener('change', handleMotionChange)
    }
  }, [])

  const navigateToScene = useCallback((sceneIndex: number) => {
    const ref = sceneRefs.current[sceneIndex]
    if (ref) {
      window.scrollTo({
        top: ref.offsetTop,
        behavior: prefersReducedMotion ? 'auto' : 'smooth',
      })
    }
  }, [prefersReducedMotion])

  const totalProgress = useMemo(() => 
    sceneProgresses.reduce((sum, p) => sum + p, 0) / 6
  , [sceneProgresses])

  return (
    <div
      ref={containerRef}
      className={`relative bg-[#0c0a14] transition-opacity duration-700 ${isVisible ? 'opacity-100' : 'opacity-0'}`}
    >
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        <GlowOrb color="purple" size="xl" className="top-[20%] left-[10%] opacity-30" />
        <GlowOrb color="pink" size="lg" className="top-[60%] right-[5%] opacity-20" />
        <GlowOrb color="amber" size="md" className="bottom-[20%] left-[30%] opacity-15" />
      </div>

      <div className="fixed top-0 left-0 right-0 h-1 bg-white/5 z-50">
        <div
          className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-amber-500 transition-[width] duration-100"
          style={{ width: `${totalProgress * 100}%` }}
        />
        <div 
          className="absolute top-0 h-full w-20 bg-gradient-to-r from-white/50 to-transparent animate-pulse"
          style={{ left: `${Math.max(0, totalProgress * 100 - 5)}%` }}
        />
      </div>

      <nav 
        className="fixed right-4 md:right-8 top-1/2 -translate-y-1/2 z-50 hidden md:flex flex-col gap-4"
        aria-label="Scene navigation"
      >
        {SCENE_LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => navigateToScene(i)}
            className="group relative flex items-center justify-end"
            aria-label={`Go to ${label}`}
          >
            <span
              className={`mr-4 text-xs font-bold tracking-wider uppercase whitespace-nowrap transition-all duration-300 ${
                currentScene === i
                  ? 'text-white opacity-100 translate-x-0'
                  : 'text-white/40 opacity-0 translate-x-2 group-hover:opacity-100 group-hover:translate-x-0'
              }`}
            >
              {label}
            </span>
            <span
              className={`relative w-3 h-3 rounded-full transition-all duration-300 ${
                currentScene === i
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 scale-125 shadow-[0_0_12px_rgba(168,85,247,0.6)]'
                  : 'bg-white/20 group-hover:bg-white/40 group-hover:scale-110'
              }`}
            >
              {currentScene === i && (
                <span className="absolute inset-0 rounded-full bg-white/30 animate-ping" />
              )}
            </span>
          </button>
        ))}
      </nav>

      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 md:hidden">
        <div className="flex items-center gap-3 px-4 py-3 rounded-full bg-black/80 backdrop-blur-lg border border-white/10 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
          {SCENE_LABELS.map((label, i) => (
            <button
              key={label}
              onClick={() => navigateToScene(i)}
              className={`relative w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                currentScene === i 
                  ? 'bg-gradient-to-r from-purple-500 to-pink-500 w-6 shadow-[0_0_8px_rgba(168,85,247,0.6)]' 
                  : 'bg-white/30 hover:bg-white/50'
              }`}
              aria-label={`Go to ${label}`}
            />
          ))}
        </div>
      </div>

      <button
        onClick={() => navigateToScene(5)}
        className="fixed bottom-6 right-6 z-50 hidden md:flex items-center gap-2 px-5 py-2.5 text-xs font-bold uppercase tracking-wider text-white/70 hover:text-white bg-white/5 hover:bg-white/10 border border-white/10 hover:border-purple-500/50 rounded-full transition-all duration-300 hover:shadow-[0_0_20px_rgba(168,85,247,0.3)]"
        aria-label="Skip to signup"
      >
        <span>Skip to signup</span>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
        </svg>
      </button>

      <main className="relative z-10">
        <div ref={setSceneRef(0)}>
          <Scene0Hero progress={sceneProgresses[0]} reducedMotion={prefersReducedMotion} />
        </div>
        <div ref={setSceneRef(1)}>
          <Scene1Chaos progress={sceneProgresses[1]} reducedMotion={prefersReducedMotion} />
        </div>
        <div ref={setSceneRef(2)}>
          <Scene2Library progress={sceneProgresses[2]} reducedMotion={prefersReducedMotion} />
        </div>
        <div ref={setSceneRef(3)}>
          <Scene3Updates progress={sceneProgresses[3]} reducedMotion={prefersReducedMotion} />
        </div>
        <div ref={setSceneRef(4)}>
          <Scene4Discover progress={sceneProgresses[4]} reducedMotion={prefersReducedMotion} />
        </div>
        <div ref={setSceneRef(5)}>
          <Scene5CTA progress={sceneProgresses[5]} reducedMotion={prefersReducedMotion} />
        </div>
      </main>

      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }
        @media (prefers-reduced-motion: reduce) {
          html {
            scroll-behavior: auto;
          }
        }
        body {
          overflow-x: hidden;
          font-family: var(--font-body);
        }
        ::-webkit-scrollbar {
          width: 8px;
        }
        ::-webkit-scrollbar-track {
          background: #0c0a14;
        }
        ::-webkit-scrollbar-thumb {
          background: linear-gradient(180deg, #a855f7, #ec4899);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(180deg, #c084fc, #f472b6);
        }
        ::selection {
          background: rgba(168, 85, 247, 0.4);
          color: white;
        }
      `}</style>
    </div>
  )
}
