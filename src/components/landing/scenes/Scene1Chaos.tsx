'use client'

import { memo, useEffect, useState, useMemo } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { MangaPanel, SpeedLines, ScreenTone, GlowOrb, SpeechBubble } from '../shared/MangaMotifs'

interface Scene1ChaosProps {
  progress: number
  reducedMotion: boolean
}

const MANGA_COVERS = [
  { title: 'One Piece', url: 'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2529d680-bd24-4f6c-a606-5c513699a466.jpg' },
  { title: 'Jujutsu Kaisen', url: 'https://uploads.mangadex.org/covers/c52b2ce3-7f95-469c-96b0-479524fb7a1a/3da71fba-c686-40eb-8e8e-a62b665e2f4e.jpg' },
  { title: 'Chainsaw Man', url: 'https://uploads.mangadex.org/covers/a77742b1-befd-49a4-bff5-1ad4e6b0ef7b/af4bbd2e-e249-4938-9eb5-81aa032677fb.jpg' },
  { title: 'Spy x Family', url: 'https://uploads.mangadex.org/covers/4f3bcae4-2d96-4c9d-932c-90181d9c873e/7ab00fb6-79ad-4776-8a49-76e4c3690a04.jpg' },
]

const scatteredApps = [
  { name: 'VIZ', color: 'from-orange-500 to-red-500', x: 12, y: 18 },
  { name: 'WEBTOON', color: 'from-green-500 to-emerald-500', x: 78, y: 12 },
  { name: 'MangaPlus', color: 'from-red-500 to-pink-500', x: 8, y: 58 },
  { name: 'Crunchyroll', color: 'from-orange-400 to-amber-500', x: 82, y: 65 },
  { name: 'Tapas', color: 'from-purple-500 to-violet-500', x: 22, y: 38 },
  { name: 'Tappytoon', color: 'from-pink-500 to-rose-500', x: 72, y: 35 },
  { name: 'Lezhin', color: 'from-red-600 to-rose-600', x: 48, y: 8 },
  { name: 'Toomics', color: 'from-blue-500 to-cyan-500', x: 42, y: 72 },
]

const chaosMessages = [
  { text: "Which chapter was I on...?", x: 18, y: 28 },
  { text: "Did I read this already?", x: 68, y: 22 },
  { text: "Where did I stop?!", x: 12, y: 68 },
  { text: "Too many apps!", x: 75, y: 55 },
]

const Scene1Chaos = memo(function Scene1Chaos({ progress, reducedMotion }: Scene1ChaosProps) {
  const [mounted, setMounted] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setMounted(true)
    if (reducedMotion) return
    const interval = setInterval(() => setTick(t => t + 1), 50)
    return () => clearInterval(interval)
  }, [reducedMotion])

  const visibleProgress = Math.min(Math.max((progress - 0.15) * 2.2, 0), 1)
  const chaosIntensity = Math.min(visibleProgress * 1.5, 1)

  const appPositions = useMemo(() => {
    return scatteredApps.map((app, i) => {
      const chaos = reducedMotion ? 0 : Math.sin(tick * 0.05 + i) * chaosIntensity * 20
      const chaosY = reducedMotion ? 0 : Math.cos(tick * 0.04 + i * 0.5) * chaosIntensity * 15
      return {
        ...app,
        offsetX: chaos,
        offsetY: chaosY,
        rotation: reducedMotion ? 0 : Math.sin(tick * 0.03 + i) * chaosIntensity * 20,
      }
    })
  }, [tick, chaosIntensity, reducedMotion])

  const mangaPanelPositions = useMemo(() => {
    return MANGA_COVERS.map((cover, i) => {
      const basePositions = [
        { x: 5, y: 15, rot: -12 },
        { x: 85, y: 20, rot: 15 },
        { x: 10, y: 75, rot: 8 },
        { x: 80, y: 78, rot: -10 },
      ]
      const pos = basePositions[i]
      const chaos = reducedMotion ? 0 : Math.sin(tick * 0.03 + i * 2) * chaosIntensity * 10
      const chaosY = reducedMotion ? 0 : Math.cos(tick * 0.04 + i * 1.5) * chaosIntensity * 8
      return {
        ...cover,
        x: pos.x,
        y: pos.y,
        rotation: pos.rot + (reducedMotion ? 0 : Math.sin(tick * 0.02 + i) * chaosIntensity * 5),
        offsetX: chaos,
        offsetY: chaosY,
      }
    })
  }, [tick, chaosIntensity, reducedMotion])

  return (
    <section className="relative min-h-[110vh] w-full overflow-hidden bg-[#0c0a14]">
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(239,68,68,0.12)_0%,transparent_60%)]"
        style={{ opacity: visibleProgress }}
      />
      
      <GlowOrb x="50%" y="50%" size={400} color="pink" blur={150} opacity={chaosIntensity * 0.3} />
      <ScreenTone pattern="crosshatch" opacity={0.04} className="text-red-500" />

      {mounted && !reducedMotion && visibleProgress > 0.3 && (
        <SpeedLines direction="left" intensity="medium" className="opacity-40" />
      )}

      <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-4">
        {mounted && mangaPanelPositions.map((panel, i) => {
          const delay = i * 0.08
          const itemProgress = Math.min(Math.max((visibleProgress - delay) * 2.5, 0), 1)

          return (
            <div
              key={panel.title}
              className="absolute z-5"
              style={{
                left: `${panel.x}%`,
                top: `${panel.y}%`,
                opacity: itemProgress * 0.6,
                transform: `translate(-50%, -50%) translate(${panel.offsetX}px, ${panel.offsetY}px) rotate(${panel.rotation}deg) scale(${0.7 + itemProgress * 0.3})`,
              }}
            >
              <div className="w-16 h-24 md:w-20 md:h-28 rounded-lg overflow-hidden border-2 border-white/20 shadow-xl">
                <img src={panel.url} alt={panel.title} className="w-full h-full object-cover" />
              </div>
            </div>
          )
        })}

        {mounted && appPositions.map((app, i) => {
          const delay = i * 0.05
          const itemProgress = Math.min(Math.max((visibleProgress - delay) * 2, 0), 1)

          return (
            <div
              key={app.name}
              className="absolute z-10"
              style={{
                left: `${app.x}%`,
                top: `${app.y}%`,
                opacity: itemProgress * 0.95,
                transform: `translate(-50%, -50%) translate(${app.offsetX}px, ${app.offsetY}px) rotate(${app.rotation}deg) scale(${0.8 + itemProgress * 0.2})`,
                transition: reducedMotion ? 'none' : 'opacity 0.3s',
              }}
            >
              <MangaPanel variant="action" className="px-4 py-3">
                <div className={`absolute inset-0 bg-gradient-to-br ${app.color} opacity-30 rounded-xl`} />
                <span className="relative text-sm font-bold text-white">{app.name}</span>
              </MangaPanel>
            </div>
          )
        })}

        {mounted && chaosMessages.map((msg, i) => {
          const msgProgress = Math.min(Math.max((visibleProgress - 0.3 - i * 0.1) * 2, 0), 1)
          const float = reducedMotion ? 0 : Math.sin(tick * 0.06 + i * 2) * 8

          return (
            <div
              key={i}
              className="absolute z-20 max-w-[200px]"
              style={{
                left: `${msg.x}%`,
                top: `${msg.y}%`,
                opacity: msgProgress * 0.9,
                transform: `translate(-50%, -50%) translateY(${float}px)`,
              }}
            >
              <SpeechBubble direction="down">
                {msg.text}
              </SpeechBubble>
            </div>
          )
        })}

        <div
          className="relative z-30"
          style={{
            opacity: visibleProgress,
            transform: reducedMotion 
              ? 'none' 
              : `translateX(${Math.sin(tick * 0.1) * chaosIntensity * 12}px)`,
          }}
        >
          <div className="relative">
            <div 
              className="absolute -inset-8 bg-red-500/30 rounded-full blur-3xl"
              style={{ 
                opacity: chaosIntensity * 0.7,
                animation: reducedMotion ? 'none' : 'pulse 1s ease-in-out infinite'
              }}
            />
            <div className="relative w-28 h-28 md:w-36 md:h-36 rounded-full overflow-hidden border-4 border-red-500/60 shadow-[0_0_40px_rgba(239,68,68,0.5)] flex items-center justify-center bg-gradient-to-br from-red-900/50 to-red-800/50">
              <div className="text-5xl md:text-6xl">😵</div>
            </div>
            <div className="absolute -top-3 -right-3 p-2.5 rounded-full bg-red-500 border-2 border-white shadow-lg animate-bounce">
              <AlertTriangle className="w-5 h-5 text-white" />
            </div>
          </div>
        </div>

        <div
          className="absolute bottom-[12%] left-0 right-0 text-center z-40 px-4"
          style={{
            opacity: visibleProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - visibleProgress) * 40}px)`,
          }}
        >
          <h2 
            className="text-3xl md:text-5xl lg:text-6xl font-black text-white mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            <span className="text-red-400">50 series.</span>{' '}
            <span className="text-orange-400">8 apps.</span>{' '}
            <span className="text-zinc-400">Zero sync.</span>
          </h2>
          <p className="text-lg md:text-xl text-zinc-400 font-medium max-w-lg mx-auto">
            Sound familiar? <span className="text-zinc-300 font-semibold">You&apos;re not alone.</span>
          </p>
        </div>

        {mounted && visibleProgress > 0.4 && (
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[...Array(12)].map((_, i) => (
              <div
                key={i}
                className="absolute"
                style={{
                  left: `${10 + Math.random() * 80}%`,
                  top: `${10 + Math.random() * 80}%`,
                  opacity: 0.15,
                  animation: reducedMotion ? 'none' : `chaos-float ${3 + Math.random() * 2}s ease-in-out infinite`,
                  animationDelay: `${Math.random() * 2}s`,
                }}
              >
                <X className="w-8 h-8 text-red-500" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
})

export default Scene1Chaos
