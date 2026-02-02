'use client'

import { memo, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, BookOpen, Users, Globe, Sparkles, Shield, Zap, Heart } from 'lucide-react'
import { MangaPanel, ScreenTone, FloatingParticles, GlowOrb } from '../shared/MangaMotifs'

interface Scene5CTAProps {
  progress: number
  reducedMotion: boolean
}

const stats = [
  { icon: BookOpen, value: '50,000+', label: 'Series Tracked', color: 'from-purple-500 to-pink-500' },
  { icon: Users, value: '12,000+', label: 'Active Readers', color: 'from-cyan-500 to-blue-500' },
  { icon: Globe, value: '20+', label: 'Manga Sources', color: 'from-amber-500 to-orange-500' },
]

const testimonials = [
  { name: 'MangaFan2024', text: "Finally stopped losing my place across apps! This is exactly what I needed.", avatar: 'M', color: 'from-purple-500 to-pink-500', rating: 5 },
  { name: 'WebtoonReader', text: 'The custom source feature is a game changer. Added all my niche manga sites.', avatar: 'W', color: 'from-cyan-500 to-blue-500', rating: 5 },
  { name: 'OtakuPrime', text: "Best manga tracker I've ever used. Clean, fast, and just works.", avatar: 'O', color: 'from-amber-500 to-orange-500', rating: 5 },
]

const features = [
  { icon: Zap, text: 'Instant sync' },
  { icon: Shield, text: 'Privacy first' },
  { icon: Heart, text: 'Free forever' },
]

const Scene5CTA = memo(function Scene5CTA({ progress, reducedMotion }: Scene5CTAProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const visibleProgress = Math.min(Math.max((progress - 0.15) * 2, 0), 1)
  const heroProgress = Math.min(visibleProgress * 2, 1)
  const ctaProgress = Math.min(Math.max((visibleProgress - 0.1) * 2.5, 0), 1)
  const statsProgress = Math.min(Math.max((visibleProgress - 0.25) * 2.5, 0), 1)
  const testimonialProgress = Math.min(Math.max((visibleProgress - 0.4) * 2.5, 0), 1)

  return (
    <section className="relative min-h-screen w-full overflow-hidden bg-[#0c0a14]">
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_50%,rgba(168,85,247,0.15),transparent)]"
        style={{ opacity: visibleProgress }}
      />
      <div 
        className="absolute inset-0 bg-[radial-gradient(ellipse_60%_40%_at_80%_80%,rgba(236,72,153,0.1),transparent)]"
        style={{ opacity: visibleProgress }}
      />
      
      <GlowOrb x="50%" y="30%" size={600} color="purple" blur={150} opacity={0.3} />
      <GlowOrb x="30%" y="70%" size={400} color="pink" blur={120} opacity={0.2} />
      <GlowOrb x="70%" y="80%" size={350} color="cyan" blur={100} opacity={0.15} />
      <ScreenTone pattern="dots" opacity={0.03} className="text-purple-500" />

      {mounted && !reducedMotion && (
        <FloatingParticles count={25} color="mixed" className="opacity-50" />
      )}

      <div className="relative h-screen flex flex-col items-center justify-center px-4 py-12">
        <div
          className="relative z-30 mb-8"
          style={{
            opacity: heroProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - heroProgress) * 40}px) scale(${0.9 + heroProgress * 0.1})`,
          }}
        >
          <div className="relative">
            <div className="absolute -inset-10 bg-gradient-to-r from-purple-500/40 via-pink-500/40 to-amber-500/40 rounded-full blur-3xl animate-pulse" />
            <div className="relative w-32 h-32 md:w-40 md:h-40 rounded-full overflow-hidden border-4 border-white/30 shadow-[0_0_60px_rgba(168,85,247,0.5)] flex items-center justify-center bg-gradient-to-br from-purple-900/50 to-pink-900/50">
              <div className="text-6xl md:text-7xl">🎉</div>
            </div>
            <div className="absolute -top-2 -right-2 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-full text-xs font-black text-white shadow-lg animate-bounce">
              JOIN US!
            </div>
          </div>
        </div>

        <div
          className="text-center z-30 max-w-2xl mx-auto"
          style={{
            opacity: ctaProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - ctaProgress) * 30}px)`,
          }}
        >
          <h2 
            className="text-3xl md:text-5xl lg:text-6xl font-black text-white mb-4"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Your reading journey{' '}
            <span className="bg-gradient-to-r from-purple-400 via-pink-400 to-amber-400 bg-clip-text text-transparent">
              starts here.
            </span>
          </h2>
          <p className="text-base md:text-lg text-zinc-400 mb-8 max-w-lg mx-auto">
            Join thousands of manga readers who never lose their place again.
          </p>

          <Link
            href="/register"
            className="group relative inline-flex items-center gap-3 px-10 py-5 text-lg font-black text-white overflow-hidden rounded-2xl transition-all duration-300 hover:scale-105 hover:shadow-[0_0_50px_rgba(168,85,247,0.5)]"
          >
            <div className="absolute inset-0 bg-gradient-to-r from-purple-600 via-pink-600 to-purple-600 bg-[length:200%_100%] animate-shimmer" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/20 to-transparent" />
            <Sparkles className="relative z-10 w-5 h-5" />
            <span className="relative z-10">Start Reading Free</span>
            <ArrowRight className="relative z-10 w-5 h-5 group-hover:translate-x-1 transition-transform" />
          </Link>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-5">
            {features.map((feature) => (
              <div key={feature.text} className="flex items-center gap-2 text-zinc-400">
                <feature.icon className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium">{feature.text}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="mt-10 grid grid-cols-3 gap-4 md:gap-6 w-full max-w-2xl z-20"
          style={{
            opacity: statsProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - statsProgress) * 25}px)`,
          }}
        >
          {stats.map((stat, i) => {
            const statDelay = i * 0.1
            const statProgress = Math.min(Math.max((statsProgress - statDelay) * 2, 0), 1)

            return (
              <MangaPanel
                key={stat.label}
                variant="default"
                glow
                className="p-4 md:p-5 text-center"
                style={{
                  opacity: mounted ? statProgress : 0,
                  transform: reducedMotion ? 'none' : `translateY(${(1 - statProgress) * 20}px)`,
                }}
              >
                <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${stat.color} mb-3 shadow-lg`}>
                  <stat.icon className="w-5 h-5 text-white" />
                </div>
                <p className="text-2xl md:text-3xl font-black text-white">{stat.value}</p>
                <p className="text-xs md:text-sm text-zinc-500 font-medium mt-1">{stat.label}</p>
              </MangaPanel>
            )
          })}
        </div>

        <div
          className="mt-10 w-full max-w-3xl z-20"
          style={{
            opacity: testimonialProgress,
            transform: reducedMotion ? 'none' : `translateY(${(1 - testimonialProgress) * 20}px)`,
          }}
        >
          <p className="text-center text-xs text-zinc-600 font-bold uppercase tracking-wider mb-4">
            Loved by manga readers worldwide
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {testimonials.map((t, i) => {
              const tDelay = i * 0.1
              const tProgress = Math.min(Math.max((testimonialProgress - tDelay) * 2, 0), 1)

              return (
                <div
                  key={t.name}
                  className="p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-purple-500/30 transition-all"
                  style={{
                    opacity: mounted ? tProgress : 0,
                    transform: reducedMotion ? 'none' : `translateY(${(1 - tProgress) * 15}px)`,
                  }}
                >
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${t.color} flex items-center justify-center text-white text-xs font-bold shadow-lg`}>
                      {t.avatar}
                    </div>
                    <div className="flex-1">
                      <span className="text-xs font-bold text-zinc-300">@{t.name}</span>
                      <div className="flex text-amber-400 text-[10px]">
                        {'★'.repeat(t.rating)}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-zinc-400 leading-relaxed">&ldquo;{t.text}&rdquo;</p>
                </div>
              )
            })}
          </div>
        </div>

        <div
          className="mt-8 text-center z-20"
          style={{ opacity: testimonialProgress }}
        >
          <p className="text-sm text-zinc-600">
            Already have an account?{' '}
            <Link href="/login" className="text-purple-400 hover:text-purple-300 font-semibold transition-colors">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </section>
  )
})

export default Scene5CTA
