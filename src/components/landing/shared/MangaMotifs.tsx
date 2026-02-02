'use client'

import { memo } from 'react'

export const SpeedLines = memo(function SpeedLines({ 
  direction = 'horizontal', 
  intensity = 'medium',
  className = '' 
}: { 
  direction?: 'horizontal' | 'vertical' | 'radial' | 'left' | 'right'
  intensity?: 'light' | 'medium' | 'heavy'
  className?: string 
}) {
  const opacityMap = { light: 0.03, medium: 0.06, heavy: 0.1 }
  const opacity = opacityMap[intensity]
  
  if (direction === 'radial') {
    return (
      <div 
        className={`absolute inset-0 pointer-events-none ${className}`}
        style={{
          background: `repeating-conic-gradient(
            from 0deg,
            transparent 0deg,
            rgba(255, 255, 255, ${opacity}) 0.5deg,
            transparent 1deg
          )`,
        }}
      />
    )
  }
  
  const angle = direction === 'horizontal' || direction === 'left' || direction === 'right' ? '90deg' : '0deg'
  
  return (
    <div 
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        background: `repeating-linear-gradient(
          ${angle},
          transparent,
          transparent 3px,
          rgba(255, 255, 255, ${opacity}) 3px,
          rgba(255, 255, 255, ${opacity}) 4px
        )`,
      }}
    />
  )
})

export const HalftoneOverlay = memo(function HalftoneOverlay({ 
  color = 'purple',
  size = 'medium',
  className = '' 
}: { 
  color?: 'purple' | 'pink' | 'cyan' | 'white'
  size?: 'small' | 'medium' | 'large'
  className?: string 
}) {
  const colorMap = {
    purple: 'rgba(192, 132, 252, 0.15)',
    pink: 'rgba(244, 114, 182, 0.15)',
    cyan: 'rgba(34, 211, 238, 0.15)',
    white: 'rgba(255, 255, 255, 0.08)',
  }
  const sizeMap = { small: 4, medium: 8, large: 16 }
  
  return (
    <div 
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        backgroundImage: `radial-gradient(circle, ${colorMap[color]} 1px, transparent 1px)`,
        backgroundSize: `${sizeMap[size]}px ${sizeMap[size]}px`,
      }}
    />
  )
})

export const ScreenTone = memo(function ScreenTone({ 
  pattern = 'dots',
  opacity = 0.05,
  className = '' 
}: { 
  pattern?: 'dots' | 'lines' | 'crosshatch'
  opacity?: number
  className?: string 
}) {
  const patterns = {
    dots: `radial-gradient(circle, currentColor 1px, transparent 1px)`,
    lines: `repeating-linear-gradient(45deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)`,
    crosshatch: `
      repeating-linear-gradient(45deg, transparent, transparent 2px, currentColor 2px, currentColor 3px),
      repeating-linear-gradient(-45deg, transparent, transparent 2px, currentColor 2px, currentColor 3px)
    `,
  }
  
  return (
    <div 
      className={`absolute inset-0 pointer-events-none ${className}`}
      style={{
        backgroundImage: patterns[pattern],
        backgroundSize: pattern === 'dots' ? '8px 8px' : '12px 12px',
        opacity,
      }}
    />
  )
})

export const MangaPanel = memo(function MangaPanel({ 
  children,
  variant = 'default',
  glow = false,
  className = '',
  style = {}
}: { 
  children: React.ReactNode
  variant?: 'default' | 'thin' | 'glow' | 'action' | 'dramatic'
  glow?: boolean
  className?: string
  style?: React.CSSProperties
}) {
  const baseClasses = 'relative overflow-hidden bg-[#12101c]/90 backdrop-blur-sm rounded-xl'
  
  const variantStyles = {
    default: 'border-2 border-white/10',
    thin: 'border border-white/10',
    glow: 'border-2 border-purple-400/50 shadow-[0_0_20px_rgba(192,132,252,0.3)]',
    action: 'border-2 border-white/20 shadow-[2px_2px_0_0_rgba(0,0,0,0.5)]',
    dramatic: 'border-2 border-white/20 shadow-[4px_4px_0_0_rgba(0,0,0,0.5)]',
  }
  
  const glowClass = glow ? 'shadow-[0_0_30px_rgba(192,132,252,0.2)]' : ''
  
  return (
    <div className={`${baseClasses} ${variantStyles[variant]} ${glowClass} ${className}`} style={style}>
      {children}
    </div>
  )
})

export const SpeechBubble = memo(function SpeechBubble({ 
  children,
  direction = 'down',
  className = '' 
}: { 
  children: React.ReactNode
  direction?: 'up' | 'down' | 'left' | 'right'
  className?: string 
}) {
  return (
    <div className={`relative bg-white text-zinc-900 px-3 py-2 rounded-xl text-xs font-bold shadow-lg ${className}`}>
      {children}
      <div 
        className={`absolute w-0 h-0 ${
          direction === 'down' ? 'bottom-0 left-1/2 -translate-x-1/2 translate-y-full border-l-[8px] border-r-[8px] border-t-[8px] border-l-transparent border-r-transparent border-t-white' :
          direction === 'up' ? 'top-0 left-1/2 -translate-x-1/2 -translate-y-full border-l-[8px] border-r-[8px] border-b-[8px] border-l-transparent border-r-transparent border-b-white' :
          direction === 'left' ? 'left-0 top-1/2 -translate-y-1/2 -translate-x-full border-t-[8px] border-b-[8px] border-r-[8px] border-t-transparent border-b-transparent border-r-white' :
          'right-0 top-1/2 -translate-y-1/2 translate-x-full border-t-[8px] border-b-[8px] border-l-[8px] border-t-transparent border-b-transparent border-l-white'
        }`}
      />
    </div>
  )
})

export const ImpactText = memo(function ImpactText({ 
  children,
  size = 'large',
  color = 'gradient',
  className = '' 
}: { 
  children: React.ReactNode
  size?: 'medium' | 'large' | 'xl'
  color?: 'white' | 'purple' | 'gradient' | 'gold'
  className?: string 
}) {
  const sizeClasses = {
    medium: 'text-3xl md:text-4xl',
    large: 'text-4xl md:text-6xl',
    xl: 'text-5xl md:text-7xl lg:text-8xl',
  }
  
  const colorClasses = {
    white: 'text-white',
    purple: 'text-purple-400',
    gradient: 'text-gradient-manga',
    gold: 'text-gradient-gold',
  }
  
  return (
    <span 
      className={`font-display font-black tracking-tight ${sizeClasses[size]} ${colorClasses[color]} ${className}`}
      style={{
        textShadow: color === 'gradient' || color === 'gold' 
          ? 'none' 
          : '0 0 40px rgba(192, 132, 252, 0.5), 2px 2px 0 rgba(0, 0, 0, 0.3)',
      }}
    >
      {children}
    </span>
  )
})

export const FloatingParticles = memo(function FloatingParticles({ 
  count = 20,
  color = 'mixed',
  className = '' 
}: { 
  count?: number
  color?: 'purple' | 'pink' | 'cyan' | 'mixed'
  className?: string 
}) {
  const particles = Array.from({ length: count }, (_, i) => {
    const colors = {
      purple: 'bg-purple-400',
      pink: 'bg-pink-400',
      cyan: 'bg-cyan-400',
      mixed: ['bg-purple-400', 'bg-pink-400', 'bg-cyan-400'][i % 3],
    }
    
    return {
      id: i,
      color: typeof colors[color] === 'string' ? colors[color] : colors[color],
      left: `${Math.random() * 100}%`,
      top: `${Math.random() * 100}%`,
      size: Math.random() * 4 + 2,
      delay: Math.random() * 5,
      duration: 3 + Math.random() * 4,
    }
  })
  
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`}>
      {particles.map((p) => (
        <div
          key={p.id}
          className={`absolute rounded-full ${p.color} opacity-40`}
          style={{
            left: p.left,
            top: p.top,
            width: p.size,
            height: p.size,
            animation: `float ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }}
        />
      ))}
    </div>
  )
})

export const GlowOrb = memo(function GlowOrb({ 
  x,
  y,
  size = 300,
  color = 'purple',
  blur = 100,
  opacity = 0.3,
  className = '' 
}: { 
  x?: string | number
  y?: string | number
  size?: number | 'sm' | 'md' | 'lg' | 'xl'
  color?: 'purple' | 'pink' | 'cyan' | 'gold' | 'amber'
  blur?: number
  opacity?: number
  className?: string 
}) {
  const colorMap = {
    purple: '#c084fc',
    pink: '#f472b6',
    cyan: '#22d3ee',
    gold: '#fbbf24',
    amber: '#f59e0b',
  }
  
  const sizeMap = {
    sm: 150,
    md: 250,
    lg: 400,
    xl: 600,
  }
  
  const actualSize = typeof size === 'number' ? size : sizeMap[size]
  
  const positionStyles: React.CSSProperties = x !== undefined && y !== undefined ? {
    left: x,
    top: y,
    transform: 'translate(-50%, -50%)',
  } : {}
  
  return (
    <div 
      className={`absolute rounded-full pointer-events-none ${className}`}
      style={{
        ...positionStyles,
        width: actualSize,
        height: actualSize,
        background: `radial-gradient(circle, ${colorMap[color]} 0%, transparent 70%)`,
        filter: `blur(${blur}px)`,
        opacity,
      }}
    />
  )
})

export const AnimatedBorder = memo(function AnimatedBorder({ 
  children,
  className = '' 
}: { 
  children: React.ReactNode
  className?: string 
}) {
  return (
    <div className={`relative p-[2px] rounded-xl overflow-hidden ${className}`}>
      <div 
        className="absolute inset-0 rounded-xl"
        style={{
          background: 'linear-gradient(90deg, #c084fc, #f472b6, #22d3ee, #c084fc)',
          backgroundSize: '300% 100%',
          animation: 'shimmer 3s linear infinite',
        }}
      />
      <div className="relative bg-card rounded-xl">
        {children}
      </div>
    </div>
  )
})

export const MangaCover = memo(function MangaCover({ 
  title,
  coverUrl,
  index = 0,
  size = 'medium',
  className = '' 
}: { 
  title: string
  coverUrl: string
  index?: number
  size?: 'small' | 'medium' | 'large'
  className?: string 
}) {
  const sizeClasses = {
    small: 'w-16 h-24',
    medium: 'w-24 h-36',
    large: 'w-32 h-48',
  }
  
  return (
    <div 
      className={`relative ${sizeClasses[size]} rounded-lg overflow-hidden manga-card group ${className}`}
      style={{ animationDelay: `${index * 0.1}s` }}
    >
      <img 
        src={coverUrl} 
        alt={title}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
        loading="lazy"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity">
        <div className="absolute bottom-2 left-2 right-2">
          <p className="text-xs font-medium text-white truncate">{title}</p>
        </div>
      </div>
    </div>
  )
})
