'use client'

import { memo, useEffect, useState } from 'react'
import Link from 'next/link'
import { SpeedLines, HalftoneOverlay, GlowOrb, FloatingParticles, ImpactText } from '../shared/MangaMotifs'

const MANGA_COVERS = [
  { title: 'One Piece', url: 'https://uploads.mangadex.org/covers/a1c7c817-4e59-43b7-9365-09675a149a6f/2529d680-bd24-4f6c-a606-5c513699a466.jpg' },
  { title: 'Jujutsu Kaisen', url: 'https://uploads.mangadex.org/covers/c52b2ce3-7f95-469c-96b0-479524fb7a1a/3da71fba-c686-40eb-8e8e-a62b665e2f4e.jpg' },
  { title: 'Chainsaw Man', url: 'https://uploads.mangadex.org/covers/a77742b1-befd-49a4-bff5-1ad4e6b0ef7b/af4bbd2e-e249-4938-9eb5-81aa032677fb.jpg' },
  { title: 'Spy x Family', url: 'https://uploads.mangadex.org/covers/4f3bcae4-2d96-4c9d-932c-90181d9c873e/7ab00fb6-79ad-4776-8a49-76e4c3690a04.jpg' },
  { title: 'Frieren', url: 'https://uploads.mangadex.org/covers/b0b721ff-c388-4486-aa0f-c2b0bb321512/c4b0a255-4865-4a03-8a76-5a3edc2f9098.jpg' },
  { title: 'Dandadan', url: 'https://uploads.mangadex.org/covers/5765c761-d855-4c6f-811e-ccc7a3e3e5d5/13f63b64-f63e-42c9-9956-0a4dea7f4bb7.jpg' },
]

interface Scene0HeroProps {
  progress: number
  reducedMotion: boolean
}

const Scene0Hero = memo(function Scene0Hero({ progress, reducedMotion }: Scene0HeroProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleProgress = Math.min(Math.max(progress * 2, 0), 1)

  return (
    <section className="scrolly-scene flex items-center justify-center manga-gradient-intense">
      <GlowOrb x="20%" y="30%" size={600} color="purple" blur={150} opacity={0.4} />
      <GlowOrb x="80%" y="70%" size={500} color="pink" blur={120} opacity={0.3} />
      <GlowOrb x="50%" y="90%" size={400} color="cyan" blur={100} opacity={0.2} />
      
      <HalftoneOverlay color="purple" size="small" className="opacity-50" />
      <SpeedLines direction="radial" intensity="light" />
      {mounted && !reducedMotion && <FloatingParticles count={30} color="mixed" />}

      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -left-10 top-1/4 flex flex-col gap-3 opacity-30">
          {MANGA_COVERS.slice(0, 3).map((cover, i) => (
            <div 
              key={i}
              className="w-20 h-28 rounded-lg overflow-hidden transform rotate-[-15deg] animate-float shadow-xl"
              style={{ animationDelay: `${i * 0.5}s` }}
            >
              <img src={cover.url} alt={cover.title} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
        <div className="absolute -right-10 top-1/3 flex flex-col gap-3 opacity-30">
          {MANGA_COVERS.slice(3, 6).map((cover, i) => (
            <div 
              key={i}
              className="w-20 h-28 rounded-lg overflow-hidden transform rotate-[15deg] animate-float shadow-xl"
              style={{ animationDelay: `${i * 0.7}s` }}
            >
              <img src={cover.url} alt={cover.title} className="w-full h-full object-cover" />
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10 container mx-auto px-6 flex flex-col lg:flex-row items-center gap-8 lg:gap-16">
        <div 
          className="flex-1 text-center lg:text-left"
          style={{
            opacity: mounted ? visibleProgress : 0,
            transform: reducedMotion ? 'none' : `translateY(${(1 - visibleProgress) * 30}px)`,
            transition: 'opacity 0.6s ease-out, transform 0.6s ease-out',
          }}
        >
          <div className="mb-6">
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-purple-500/20 border border-purple-500/30 text-purple-300 text-sm font-medium">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              Track 50,000+ manga series
            </span>
          </div>

          <h1 className="mb-6">
            <ImpactText size="xl" color="white" className="block mb-2">
              Every Series.
            </ImpactText>
            <ImpactText size="xl" color="gradient">
              One Tracker.
            </ImpactText>
          </h1>

          <p className="text-lg md:text-xl text-zinc-300 mb-8 max-w-xl mx-auto lg:mx-0 font-body leading-relaxed">
            Track manga across <span className="text-purple-400 font-semibold">official sources</span> and your own custom links. 
            Never lose your place again.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center lg:justify-start mb-10">
            <Link 
              href="/register"
              className="manga-button text-white inline-flex items-center justify-center gap-2 group"
            >
              <span>Start Reading Free</span>
              <svg className="w-5 h-5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </Link>
            <Link 
              href="/login"
              className="px-8 py-4 rounded-xl font-display font-bold text-lg border-2 border-white/20 text-white hover:bg-white/10 transition-all inline-flex items-center justify-center gap-2"
            >
              <span>Sign In</span>
            </Link>
          </div>

          <div className="flex items-center gap-6 md:gap-8 justify-center lg:justify-start flex-wrap">
            <div className="flex -space-x-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <div 
                  key={i} 
                  className="w-10 h-10 rounded-full border-2 border-background overflow-hidden"
                  style={{ 
                    background: `linear-gradient(135deg, hsl(${260 + i * 20}, 70%, 60%), hsl(${280 + i * 20}, 70%, 50%))` 
                  }}
                >
                  <div className="w-full h-full flex items-center justify-center text-white text-xs font-bold">
                    {String.fromCharCode(65 + i)}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-left">
              <div className="text-2xl font-display font-bold text-white">12,000+</div>
              <div className="text-sm text-zinc-400">Active readers</div>
            </div>
            <div className="h-10 w-px bg-white/10 hidden sm:block" />
            <div className="text-left">
              <div className="text-2xl font-display font-bold text-amber-400">4.9</div>
              <div className="text-sm text-zinc-400 flex items-center gap-1">
                <span className="text-amber-400">★★★★★</span>
              </div>
            </div>
          </div>
        </div>

        <div 
          className="flex-1 relative"
          style={{
            opacity: mounted ? visibleProgress : 0,
            transform: reducedMotion ? 'none' : `scale(${0.9 + visibleProgress * 0.1})`,
            transition: 'opacity 0.6s ease-out 0.2s, transform 0.6s ease-out 0.2s',
          }}
        >
          <div className="relative w-full max-w-lg mx-auto">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/30 via-pink-500/20 to-cyan-500/30 rounded-3xl blur-3xl animate-pulse-glow" />
            
            <div className="relative manga-card p-6 rounded-2xl border-2 border-purple-500/30">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                  </svg>
                </div>
                <div>
                  <div className="font-display font-bold text-white">Your Library</div>
                  <div className="text-xs text-zinc-400">3 series reading</div>
                </div>
                <div className="ml-auto px-3 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
                  2 new chapters
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-6">
                {MANGA_COVERS.slice(0, 3).map((cover, i) => (
                  <div key={i} className="relative group">
                    <div className="aspect-[2/3] rounded-lg overflow-hidden border-2 border-white/10 group-hover:border-purple-500/50 transition-all shadow-lg">
                      <img 
                        src={cover.url} 
                        alt={cover.title}
                        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
                      />
                    </div>
                    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-red-500 flex items-center justify-center text-xs font-bold text-white shadow-lg">
                      {i === 0 ? '3' : i === 1 ? '1' : '2'}
                    </div>
                    <p className="mt-2 text-xs text-zinc-300 truncate">{cover.title}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between p-3 rounded-lg bg-white/5 border border-white/10">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg overflow-hidden">
                    <img src={MANGA_COVERS[0].url} alt="" className="w-full h-full object-cover" />
                  </div>
                  <div>
                    <div className="text-sm font-medium text-white">Continue Reading</div>
                    <div className="text-xs text-zinc-400">Chapter 1089</div>
                  </div>
                </div>
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </div>
            </div>

            <div 
              className="absolute -bottom-4 -right-4 manga-card p-3 rounded-xl animate-float border border-green-500/30"
              style={{ animationDelay: '0.5s' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-medium text-white">Auto-synced</div>
                  <div className="text-[10px] text-zinc-400">All devices</div>
                </div>
              </div>
            </div>

            <div 
              className="absolute -top-4 -left-4 manga-card p-3 rounded-xl animate-float border border-purple-500/30"
              style={{ animationDelay: '1s' }}
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <svg className="w-4 h-4 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </div>
                <div>
                  <div className="text-xs font-medium text-white">New chapter!</div>
                  <div className="text-[10px] text-zinc-400">2 min ago</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-zinc-400">
        <span className="text-xs uppercase tracking-widest">Scroll to explore</span>
        <div className="w-6 h-10 rounded-full border-2 border-zinc-600 flex justify-center pt-2">
          <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-bounce" />
        </div>
      </div>
    </section>
  )
})

export default Scene0Hero
