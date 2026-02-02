export default function SceneSkeleton() {
  return (
    <section className="scrolly-scene scene-bg flex flex-col items-center justify-center">
      <div className="absolute inset-0 overflow-hidden">
        <div className="scene-glow absolute top-1/3 left-1/2 -translate-x-1/2 w-[400px] h-[300px] bg-neon-violet/5 rounded-full blur-[100px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-6 px-4">
        <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-neon-violet/20 to-neon-cyan/20 animate-pulse" />
        <div className="space-y-3 flex flex-col items-center">
          <div className="w-48 h-5 rounded-full bg-white/10 animate-pulse" />
          <div className="w-32 h-4 rounded-full bg-white/5 animate-pulse" />
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2">
        <div className="w-12 h-0.5 bg-gradient-to-r from-transparent to-white/10" />
        <div className="w-20 h-3 rounded-full bg-white/5 animate-pulse" />
        <div className="w-12 h-0.5 bg-gradient-to-l from-transparent to-white/10" />
      </div>
    </section>
  )
}
