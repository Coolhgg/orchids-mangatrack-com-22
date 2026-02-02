export default function Loading() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <svg width="64" height="64" viewBox="0 0 80 80" className="animate-pulse">
            <defs>
              <linearGradient id="loadingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="50%" stopColor="#00e8ff" />
                <stop offset="100%" stopColor="#ff1f8a" />
              </linearGradient>
            </defs>
            <rect x="10" y="10" width="60" height="60" rx="14" fill="url(#loadingGrad)" />
            <text x="40" y="52" textAnchor="middle" fill="white" fontWeight="900" fontSize="32" fontFamily="system-ui, sans-serif">
              M
            </text>
          </svg>
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-neon-cyan/20 via-neon-violet/20 to-neon-pink/20 blur-xl animate-pulse" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-bounce" style={{ animationDelay: '0ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-neon-violet animate-bounce" style={{ animationDelay: '150ms' }} />
          <div className="w-1.5 h-1.5 rounded-full bg-neon-pink animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
