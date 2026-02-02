'use client'

import { memo, useEffect, useState } from 'react'
import { Library, Check, Star, Clock, BookOpen } from 'lucide-react'
import { MangaPanel, ScreenTone, FloatingParticles, GlowOrb } from '../shared/MangaMotifs'

interface Scene2LibraryProps {
  progress: number
  reducedMotion: boolean
}

const MANGA_COVERS = [
  { id: 1, title: 'One Piece', ch: 1089, url: 'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2529d680-bd24-4f6c-a606-5c513699a466.jpg', progress: 92 },
  { id: 2, title: 'Jujutsu Kaisen', ch: 236, url: 'https://uploads.mangadex.org/covers/c52b2ce3-7f95-469c-96b0-479524fb7a1a/3da71fba-c686-40eb-8e8e-a62b665e2f4e.jpg', progress: 100 },
  { id: 3, title: 'Chainsaw Man', ch: 152, url: 'https://uploads.mangadex.org/covers/a77742b1-befd-49a4-bff5-1ad4e6b0ef7b/af4bbd2e-e249-4938-9eb5-81aa032677fb.jpg', progress: 78 },
  { id: 4, title: 'Spy x Family', ch: 84, url: 'https://uploads.mangadex.org/covers/4f3bcae4-2d96-4c9d-932c-90181d9c873e/7ab00fb6-79ad-4776-8a49-76e4c3690a04.jpg', progress: 67 },
  { id: 5, title: 'Frieren', ch: 120, url: 'https://uploads.mangadex.org/covers/b0b721ff-c388-4486-aa0f-c2b0bb321512/c4b0a255-4865-4a03-8a76-5a3edc2f9098.jpg', progress: 90 },
  { id: 6, title: 'Dandadan', ch: 98, url: 'https://uploads.mangadex.org/covers/5765c761-d855-4c6f-811e-ccc7a3e3e5d5/13f63b64-f63e-42c9-9956-0a4dea7f4bb7.jpg', progress: 45 },
  { id: 7, title: 'Blue Lock', ch: 245, url: 'https://uploads.mangadex.org/covers/5e82cd0d-4628-4e9e-866a-7c16ad4b2f21/8e0fc67d-f6b0-48b4-8eec-b8c23c1c8f6a.jpg', progress: 55 },
  { id: 8, title: 'Kaiju No. 8', ch: 98, url: 'https://uploads.mangadex.org/covers/44e1a8db-69ba-4ec6-8174-b7b8dedfb5e9/c92d07a5-52c5-49e4-8e6c-32bf3bb5e7e7.jpg', progress: 85 },
]

const Scene2Library = memo(function Scene2Library({ progress, reducedMotion }: Scene2LibraryProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleProgress = Math.min(Math.max((progress - 0.15) * 2, 0), 1)
  const headerProgress = Math.min(visibleProgress * 2.5, 1)
  const gridProgress = Math.min(Math.max((visibleProgress - 0.15) * 2, 0), 1)

  return (
    <section className="relative min-h-[130vh] w-full overflow-hidden bg-[#0c0a14]">
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(16,185,129,0.08)_0%,transparent_60%)]"
        style={{ opacity: visibleProgress }}
      />
      
      <GlowOrb x="30%" y="30%" size={500} color="purple" blur={150} opacity={0.25} />
      <GlowOrb x="70%" y="70%" size={400} color="cyan" blur={120} opacity={0.2} />
      <ScreenTone pattern="dots" opacity={0.03} className="text-emerald-500" />

      {mounted && !reducedMotion && (
        <FloatingParticles count={15} color="purple" className="opacity-50" />
      )}

      <div className="sticky top-0 h-screen flex flex-col items-center justify-center px-4 py-8">
        <div
          className="text-center mb-6 z-30"
          style={{
            opacity: headerProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - headerProgress) * 30}px)`,
          }}
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 mb-4 rounded-full bg-emerald-500/20 border border-emerald-500/30">
            <span className="text-2xl">😌</span>
            <span className="text-sm font-bold text-emerald-300">Finally organized!</span>
          </div>
          <h2 
            className="text-3xl md:text-5xl font-black text-white mb-2"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            One Library.{' '}
            <span className="bg-gradient-to-r from-emerald-400 to-cyan-400 bg-clip-text text-transparent">
              Every Source.
            </span>
          </h2>
          <p className="text-lg text-zinc-400 max-w-lg mx-auto">
            All your manga, perfectly organized in one place
          </p>
        </div>

        <div
          className="relative w-full max-w-4xl mx-auto z-20"
          style={{
            opacity: gridProgress,
            transform: reducedMotion ? 'none' : `scale(${0.95 + gridProgress * 0.05})`,
          }}
        >
          <MangaPanel variant="dramatic" glow className="p-4 md:p-6">
            <div className="flex items-center justify-between mb-4 pb-3 border-b border-white/10">
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-gradient-to-br from-purple-500 to-pink-500 shadow-lg">
                  <Library className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h3 className="text-white font-bold text-base">Your Library</h3>
                  <p className="text-zinc-500 text-xs">8 series • 3 sources synced</p>
                </div>
              </div>
              <div className="flex gap-2">
                {['Reading', 'Plan', 'Done'].map((tab, i) => (
                  <button
                    key={tab}
                    className={`px-4 py-2 text-xs font-bold rounded-lg transition-all ${
                      i === 0 
                        ? 'bg-gradient-to-r from-purple-500 to-pink-500 text-white shadow-lg shadow-purple-500/25' 
                        : 'text-zinc-500 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-4 md:grid-cols-8 gap-3 md:gap-4">
              {MANGA_COVERS.map((manga, i) => {
                const cardDelay = i * 0.05
                const cardProgress = Math.min(Math.max((gridProgress - cardDelay) * 2.5, 0), 1)

                return (
                  <div
                    key={manga.id}
                    className="group relative"
                    style={{
                      opacity: mounted ? cardProgress : 0,
                      transform: reducedMotion ? 'none' : `translateY(${(1 - cardProgress) * 20}px)`,
                      transition: 'transform 0.3s ease-out',
                    }}
                  >
                    <div className="relative aspect-[2/3] rounded-lg overflow-hidden border-2 border-white/10 group-hover:border-purple-500/50 transition-all shadow-lg group-hover:shadow-purple-500/20 group-hover:scale-105">
                      <img 
                        src={manga.url} 
                        alt={manga.title}
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
                      
                      <div className="absolute bottom-0 left-0 right-0 p-2">
                        <p className="text-[9px] md:text-[10px] font-bold text-white truncate">{manga.title}</p>
                        <p className="text-[8px] md:text-[9px] text-zinc-400">Ch. {manga.ch}</p>
                      </div>

                      <div className="absolute top-1.5 right-1.5">
                        {manga.progress === 100 ? (
                          <div className="p-1 rounded-full bg-emerald-500 shadow-lg">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </div>
                        ) : (
                          <div className="p-1 rounded-full bg-amber-500 shadow-lg">
                            <Clock className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>

                      <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/20">
                        <div 
                          className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                          style={{ width: `${manga.progress}%` }}
                        />
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-white/10 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-5">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-purple-400" />
                  <span className="text-sm text-zinc-400">6 reading</span>
                </div>
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm text-zinc-400">1 completed</span>
                </div>
                <div className="flex items-center gap-2">
                  <Star className="w-4 h-4 text-amber-400" />
                  <span className="text-sm text-zinc-400">1 favorite</span>
                </div>
              </div>
              <p className="text-xs text-zinc-600 bg-white/5 px-3 py-1.5 rounded-full">
                Auto-synced from MangaPlus, VIZ, WEBTOON
              </p>
            </div>
          </MangaPanel>
        </div>

        <div
          className="mt-8 flex flex-wrap justify-center gap-4 z-20"
          style={{
            opacity: gridProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - gridProgress) * 15}px)`,
          }}
        >
          {[
            { icon: Library, text: 'Track across sources', color: 'text-purple-400', bg: 'bg-purple-500/10' },
            { icon: Check, text: 'Auto-sync progress', color: 'text-emerald-400', bg: 'bg-emerald-500/10' },
            { icon: Star, text: 'Never lose your place', color: 'text-amber-400', bg: 'bg-amber-500/10' },
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

export default Scene2Library
