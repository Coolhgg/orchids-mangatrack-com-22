'use client'

import { memo, useEffect, useState, useMemo } from 'react'
import { Sparkles, Users, Heart, TrendingUp, Star, ThumbsUp } from 'lucide-react'
import { MangaPanel, ScreenTone, FloatingParticles, SpeechBubble, GlowOrb } from '../shared/MangaMotifs'

interface Scene4DiscoverProps {
  progress: number
  reducedMotion: boolean
}

const MANGA_COVERS = [
  { title: 'Frieren', match: 98, genre: 'Fantasy', url: 'https://uploads.mangadex.org/covers/b0b721ff-c388-4486-aa0f-c2b0bb321512/c4b0a255-4865-4a03-8a76-5a3edc2f9098.jpg', readers: '12.4k' },
  { title: 'Dandadan', match: 95, genre: 'Action', url: 'https://uploads.mangadex.org/covers/5765c761-d855-4c6f-811e-ccc7a3e3e5d5/13f63b64-f63e-42c9-9956-0a4dea7f4bb7.jpg', readers: '8.2k' },
  { title: 'Kaiju No. 8', match: 92, genre: 'Sci-Fi', url: 'https://uploads.mangadex.org/covers/44e1a8db-69ba-4ec6-8174-b7b8dedfb5e9/c92d07a5-52c5-49e4-8e6c-32bf3bb5e7e7.jpg', readers: '15.1k' },
  { title: 'Oshi no Ko', match: 89, genre: 'Drama', url: 'https://uploads.mangadex.org/covers/18f952c7-6cc5-46a1-80e7-c81b56a4e5bc/a2c17b21-a2d9-4dd3-9b96-11b6c72d6b76.jpg', readers: '18.7k' },
  { title: 'Mashle', match: 87, genre: 'Comedy', url: 'https://uploads.mangadex.org/covers/79f81f2a-86e2-4b96-8b5a-46bb4a8d7d2e/f29d15d7-6ccc-4c44-a8c3-6c0a7d8c5b9b.jpg', readers: '6.9k' },
]

const friendActivities = [
  { name: 'Alex', avatar: 'A', action: 'started reading', manga: 'Frieren', color: 'from-purple-500 to-pink-500' },
  { name: 'Sam', avatar: 'S', action: 'caught up with', manga: 'One Piece', color: 'from-cyan-500 to-blue-500' },
  { name: 'Jordan', avatar: 'J', action: 'recommends', manga: 'Dandadan', color: 'from-amber-500 to-orange-500' },
]

const Scene4Discover = memo(function Scene4Discover({ progress, reducedMotion }: Scene4DiscoverProps) {
  const [mounted, setMounted] = useState(false)
  const [activeCard, setActiveCard] = useState(0)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setMounted(true)
    if (reducedMotion) return
    const interval = setInterval(() => setTick(t => t + 1), 60)
    return () => clearInterval(interval)
  }, [reducedMotion])

  const visibleProgress = Math.min(Math.max((progress - 0.15) * 2, 0), 1)
  const headerProgress = Math.min(visibleProgress * 2.5, 1)
  const cardsProgress = Math.min(Math.max((visibleProgress - 0.1) * 2, 0), 1)
  const socialProgress = Math.min(Math.max((visibleProgress - 0.4) * 2.5, 0), 1)

  useEffect(() => {
    if (cardsProgress > 0.5 && cardsProgress < 0.9) {
      const newActive = Math.floor((cardsProgress - 0.5) * 10) % MANGA_COVERS.length
      setActiveCard(newActive)
    }
  }, [cardsProgress])

  const cardPositions = useMemo(() => {
    return MANGA_COVERS.map((_, i) => {
      const offset = i - activeCard
      const absOffset = Math.abs(offset)
      return {
        x: offset * 90,
        y: absOffset * 20,
        scale: 1 - absOffset * 0.12,
        rotation: offset * 6,
        zIndex: 10 - absOffset,
        opacity: 1 - absOffset * 0.3,
      }
    })
  }, [activeCard])

  return (
    <section className="relative min-h-[130vh] w-full overflow-hidden bg-[#0c0a14]">
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(236,72,153,0.08)_0%,transparent_60%)]"
        style={{ opacity: visibleProgress }}
      />
      
      <GlowOrb x="25%" y="35%" size={450} color="pink" blur={150} opacity={0.25} />
      <GlowOrb x="75%" y="65%" size={400} color="purple" blur={120} opacity={0.2} />
      <ScreenTone pattern="dots" opacity={0.03} className="text-pink-500" />

      {mounted && !reducedMotion && (
        <FloatingParticles count={20} color="mixed" className="opacity-40" />
      )}

      <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-4">
        <div
          className="text-center mb-6 z-30"
          style={{
            opacity: headerProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - headerProgress) * 30}px)`,
          }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-4 rounded-full bg-gradient-to-r from-pink-500/20 to-purple-500/20 border border-pink-500/30">
            <Sparkles className="w-4 h-4 text-pink-400" />
            <span className="text-xs font-bold text-pink-300">AI-Powered Recommendations</span>
          </div>
          <h2 
            className="text-2xl md:text-4xl lg:text-5xl font-black text-white mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Find your next{' '}
            <span className="bg-gradient-to-r from-pink-400 via-purple-400 to-violet-400 bg-clip-text text-transparent">
              obsession.
            </span>
          </h2>
          <p className="text-base md:text-lg text-zinc-400 max-w-lg mx-auto">
            Personalized picks based on your reading history
          </p>
        </div>

        <div className="relative w-full max-w-2xl h-[320px] flex items-center justify-center mb-6">
          <div
            className="absolute left-4 md:left-0 z-40"
            style={{
              opacity: socialProgress,
              transform: reducedMotion ? 'none' : `translateX(${(1 - socialProgress) * -30}px)`,
            }}
          >
            <div className="relative w-20 h-24 md:w-24 md:h-28 rounded-full overflow-hidden border-4 border-pink-500/50 shadow-[0_0_30px_rgba(236,72,153,0.4)] flex items-center justify-center bg-gradient-to-br from-pink-900/50 to-purple-900/50">
              <div className="text-4xl md:text-5xl">🤩</div>
            </div>
            <div className="absolute -bottom-2 -right-2">
              <SpeechBubble direction="left" className="text-[10px] py-1 px-2">
                <span>Try this!</span>
              </SpeechBubble>
            </div>
          </div>

          <div className="relative w-full h-full flex items-center justify-center">
            {mounted && cardPositions.map((pos, i) => {
              const rec = MANGA_COVERS[i]
              const cardDelay = i * 0.05
              const cardOpacity = Math.min(Math.max((cardsProgress - cardDelay) * 2, 0), 1) * pos.opacity
              const isActive = i === activeCard
              const floatY = reducedMotion ? 0 : Math.sin(tick * 0.03 + i) * 6

              return (
                <div
                  key={rec.title}
                  className="absolute transition-all duration-500 ease-out"
                  style={{
                    transform: `translateX(${pos.x}px) translateY(${pos.y + floatY}px) rotate(${pos.rotation}deg) scale(${pos.scale})`,
                    zIndex: pos.zIndex,
                    opacity: cardOpacity,
                  }}
                >
                  <MangaPanel 
                    variant={isActive ? 'dramatic' : 'default'} 
                    glow={isActive}
                    className={`w-40 md:w-48 transition-all duration-300 ${isActive ? 'ring-2 ring-purple-500' : ''}`}
                  >
                    <div className="h-44 md:h-52 relative overflow-hidden">
                      <img 
                        src={rec.url} 
                        alt={rec.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                      <div className="absolute top-2 right-2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-sm">
                        <span className="text-xs font-bold text-white">{rec.match}%</span>
                      </div>
                      <div className="absolute bottom-2 left-2 right-2">
                        <p className="text-sm font-black text-white truncate">{rec.title}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] text-white/70">{rec.genre}</span>
                          <span className="flex items-center gap-0.5 text-[10px] text-white/70">
                            <Users className="w-2.5 h-2.5" /> {rec.readers}
                          </span>
                        </div>
                      </div>
                    </div>
                    {isActive && (
                      <div className="p-3 flex gap-2">
                        <button className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 text-white text-xs font-bold shadow-lg">
                          <Heart className="w-3.5 h-3.5" /> Add to Library
                        </button>
                        <button className="p-2 rounded-lg bg-white/10 text-white hover:bg-white/20 transition-colors">
                          <ThumbsUp className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </MangaPanel>
                </div>
              )
            })}
          </div>
        </div>

        <div
          className="w-full max-w-md z-30"
          style={{
            opacity: socialProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - socialProgress) * 20}px)`,
          }}
        >
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-purple-400" />
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Friends Activity</span>
          </div>
          <div className="flex flex-col gap-2">
            {friendActivities.map((activity, i) => {
              const activityDelay = i * 0.1
              const activityProgress = Math.min(Math.max((socialProgress - activityDelay) * 2, 0), 1)

              return (
                <div
                  key={activity.name}
                  className="flex items-center gap-3 p-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-purple-500/30 transition-all"
                  style={{
                    opacity: activityProgress,
                    transform: reducedMotion ? 'none' : `translateX(${(1 - activityProgress) * 20}px)`,
                  }}
                >
                  <div className={`w-9 h-9 rounded-full bg-gradient-to-br ${activity.color} flex items-center justify-center text-white text-sm font-bold shadow-lg`}>
                    {activity.avatar}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm text-zinc-300">
                      <span className="font-bold text-white">{activity.name}</span> {activity.action}{' '}
                      <span className="font-bold text-purple-400">{activity.manga}</span>
                    </p>
                  </div>
                  <Star className="w-4 h-4 text-amber-400" />
                </div>
              )
            })}
          </div>
        </div>

        <div
          className="mt-8 flex flex-wrap justify-center gap-4 z-20"
          style={{
            opacity: socialProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - socialProgress) * 15}px)`,
          }}
        >
          {[
            { icon: Sparkles, text: 'Personalized picks', color: 'text-pink-400', bg: 'bg-pink-500/10' },
            { icon: Users, text: 'See what friends read', color: 'text-purple-400', bg: 'bg-purple-500/10' },
            { icon: TrendingUp, text: 'Trending now', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
          ].map((item) => (
            <div
              key={item.text}
              className={`flex items-center gap-2 px-5 py-3 rounded-xl ${item.bg} border border-white/10 backdrop-blur-sm`}
            >
              <item.icon className={`w-5 h-5 ${item.color}`} />
              <span className="text-sm font-semibold text-zinc-200">{item.text}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
})

export default Scene4Discover
