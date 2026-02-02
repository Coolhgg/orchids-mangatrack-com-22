'use client'

import { memo, useEffect, useState } from 'react'
import { Bell, ExternalLink, Plus, CheckCircle, Zap, Link as LinkIcon } from 'lucide-react'
import { MangaPanel, ScreenTone, SpeechBubble, GlowOrb } from '../shared/MangaMotifs'

interface Scene3UpdatesProps {
  progress: number
  reducedMotion: boolean
}

const MANGA_COVER = 'https://uploads.mangadex.org/covers/32d76d19-8a05-4db0-9fc2-e0b0648fe9d0/e90bdc47-c8b9-4df7-b2c0-17dbf8cf4c2b.jpg'

const sourceOptions = [
  { name: 'MangaPlus', type: 'Official', color: 'from-red-500 to-pink-500', verified: true },
  { name: 'VIZ Media', type: 'Official', color: 'from-orange-500 to-amber-500', verified: true },
  { name: 'Your Link', type: 'Custom', color: 'from-purple-500 to-violet-500', verified: false },
]

const Scene3Updates = memo(function Scene3Updates({ progress, reducedMotion }: Scene3UpdatesProps) {
  const [mounted, setMounted] = useState(false)
  const [typedChars, setTypedChars] = useState(0)
  const [showSuccess, setShowSuccess] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleProgress = Math.min(Math.max((progress - 0.15) * 2, 0), 1)
  const notifProgress = Math.min(visibleProgress * 2.5, 1)
  const cardProgress = Math.min(Math.max((visibleProgress - 0.15) * 2.5, 0), 1)
  const customProgress = Math.min(Math.max((visibleProgress - 0.4) * 2.5, 0), 1)

  const customUrl = 'manga-site.com/solo-leveling/180'
  
  useEffect(() => {
    if (customProgress > 0.1 && customProgress < 0.8) {
      setTypedChars(Math.floor(customProgress * customUrl.length * 1.5))
    } else if (customProgress >= 0.8) {
      setTypedChars(customUrl.length)
    }
    if (customProgress > 0.9 && !showSuccess) {
      setShowSuccess(true)
    }
  }, [customProgress, showSuccess])

  return (
    <section className="relative min-h-[120vh] w-full overflow-hidden bg-[#0c0a14]">
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(6,182,212,0.08)_0%,transparent_60%)]"
        style={{ opacity: visibleProgress }}
      />
      
      <GlowOrb x="20%" y="20%" size={400} color="cyan" blur={150} opacity={0.25} />
      <GlowOrb x="80%" y="80%" size={350} color="purple" blur={120} opacity={0.2} />
      <ScreenTone pattern="lines" opacity={0.03} className="text-cyan-500" />

      <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-4">
        <div
          className="text-center mb-6 z-30"
          style={{
            opacity: notifProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - notifProgress) * 30}px)`,
          }}
        >
          <h2 
            className="text-2xl md:text-4xl lg:text-5xl font-black text-white mb-3"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            We find updates.{' '}
            <span className="bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
              You choose the source.
            </span>
          </h2>
          <p className="text-base md:text-lg text-zinc-400 max-w-lg mx-auto">
            Official APIs <span className="text-cyan-400 font-semibold">+</span> your custom links
          </p>
        </div>

        <div
          className="absolute top-[8%] right-[5%] md:right-[12%] z-40"
          style={{
            opacity: notifProgress,
            transform: reducedMotion 
              ? 'none' 
              : `translateY(${(1 - notifProgress) * -40}px) scale(${0.9 + notifProgress * 0.1})`,
          }}
        >
          <div className="relative">
            <div className="absolute -inset-3 bg-cyan-500/30 rounded-2xl blur-xl animate-pulse" />
            <MangaPanel variant="action" glow className="p-4">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="p-2.5 rounded-xl bg-gradient-to-br from-cyan-500 to-blue-500 shadow-lg">
                    <Bell className="w-5 h-5 text-white" />
                  </div>
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center text-[10px] font-bold text-white animate-bounce shadow-lg">
                    1
                  </span>
                </div>
                <div>
                  <p className="text-sm font-bold text-white">New Chapter Available!</p>
                  <p className="text-xs text-zinc-400">Solo Leveling • Ch. 180</p>
                </div>
              </div>
            </MangaPanel>
          </div>
        </div>

        <div
          className="relative w-full max-w-lg mx-auto z-20"
          style={{
            opacity: cardProgress,
            transform: reducedMotion ? 'none' : `scale(${0.95 + cardProgress * 0.05})`,
          }}
        >
          <MangaPanel variant="dramatic" glow className="overflow-hidden">
            <div className="p-4 border-b border-white/10 bg-gradient-to-r from-white/5 to-transparent">
              <div className="flex items-center gap-3">
                <div className="w-12 h-16 rounded-lg overflow-hidden border border-white/20 shadow-lg">
                  <img src={MANGA_COVER} alt="Solo Leveling" className="w-full h-full object-cover" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500">
                      <Zap className="w-3.5 h-3.5 text-white" />
                    </div>
                    <p className="text-sm font-bold text-white">Solo Leveling: Chapter 180</p>
                  </div>
                  <p className="text-xs text-zinc-500 mt-1">3 sources available</p>
                </div>
              </div>
            </div>

            <div className="p-4 space-y-2">
              {sourceOptions.map((source, i) => {
                const sourceDelay = i * 0.1
                const sourceProgress = Math.min(Math.max((cardProgress - sourceDelay) * 3, 0), 1)

                return (
                  <div
                    key={source.name}
                    className="group flex items-center justify-between p-3 rounded-xl bg-white/[0.03] border border-white/10 hover:border-purple-500/50 transition-all hover:bg-white/[0.05]"
                    style={{
                      opacity: mounted ? sourceProgress : 0,
                      transform: reducedMotion ? 'none' : `translateX(${(1 - sourceProgress) * 20}px)`,
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-2 h-10 rounded-full bg-gradient-to-b ${source.color}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-white">{source.name}</p>
                          {source.verified && (
                            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" />
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-500 font-medium">{source.type}</p>
                      </div>
                    </div>
                    <button className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-white bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg hover:shadow-lg hover:shadow-purple-500/25 transition-all group-hover:scale-105">
                      Read <ExternalLink className="w-3 h-3" />
                    </button>
                  </div>
                )
              })}
            </div>

            <div
              className="p-4 border-t border-white/10 bg-gradient-to-r from-purple-500/10 to-transparent"
              style={{
                opacity: customProgress,
                transform: reducedMotion ? 'none' : `translateY(${(1 - customProgress) * 15}px)`,
              }}
            >
              <div className="flex items-center gap-2 mb-3">
                <Plus className="w-4 h-4 text-purple-400" />
                <span className="text-xs text-zinc-400 font-bold uppercase tracking-wider">Add Custom Source</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 relative">
                  <LinkIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <div className="w-full bg-white/[0.05] rounded-lg pl-10 pr-4 py-3 border border-white/10 focus-within:border-purple-500/50 transition-colors">
                    <span className="text-sm font-mono text-purple-400">
                      {customUrl.slice(0, Math.min(typedChars, customUrl.length))}
                      {customProgress > 0.1 && customProgress < 0.8 && (
                        <span className="animate-pulse text-white">|</span>
                      )}
                    </span>
                  </div>
                </div>
                <button 
                  className={`px-5 py-3 text-sm font-bold rounded-lg transition-all ${
                    showSuccess 
                      ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25' 
                      : 'bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:shadow-lg hover:shadow-purple-500/25'
                  }`}
                >
                  {showSuccess ? <CheckCircle className="w-5 h-5" /> : 'Add'}
                </button>
              </div>
              {showSuccess && (
                <div className="flex items-center gap-2 mt-3 text-sm text-emerald-400 font-bold">
                  <CheckCircle className="w-4 h-4" />
                  Source added successfully!
                </div>
              )}
            </div>
          </MangaPanel>
        </div>

        <div
          className="absolute bottom-[15%] left-[5%] md:left-[10%] z-30"
          style={{
            opacity: Math.min(customProgress * 2, 1),
            transform: reducedMotion ? 'none' : `translateX(${(1 - customProgress) * -30}px)`,
          }}
        >
          <SpeechBubble direction="right">
            <span className="text-zinc-800">Your source, your rules! 💪</span>
          </SpeechBubble>
        </div>
      </div>
    </section>
  )
})

export default Scene3Updates
