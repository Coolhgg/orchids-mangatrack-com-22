'use client'

import Link from 'next/link'
import { ReactNode } from 'react'

interface NeonButtonProps {
  href: string
  children: ReactNode
  variant?: 'cyan' | 'pink' | 'violet'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export default function NeonButton({ 
  href, 
  children, 
  variant = 'cyan',
  size = 'md',
  className = ''
}: NeonButtonProps) {
  const variants = {
    cyan: 'bg-gradient-to-r from-neon-cyan to-neon-violet text-black font-bold hover:shadow-[0_0_24px_rgba(0,232,255,0.4)]',
    pink: 'bg-gradient-to-r from-neon-pink to-neon-purple text-white hover:shadow-[0_0_24px_rgba(255,31,138,0.4)]',
    violet: 'bg-gradient-to-r from-neon-violet to-primary text-white hover:shadow-[0_0_24px_rgba(167,139,250,0.4)]'
  }

  const sizes = {
    sm: 'px-3 py-1.5 text-xs md:px-4 md:py-2 md:text-sm',
    md: 'px-4 py-2.5 text-sm md:px-6 md:py-3 md:text-base',
    lg: 'px-5 py-3 text-sm md:px-8 md:py-4 md:text-lg'
  }

  return (
    <Link
      href={href}
      className={`
        inline-flex items-center justify-center gap-1.5 md:gap-2
        rounded-lg md:rounded-xl font-semibold md:font-bold
        transition-all duration-200 ease-out
        active:scale-95 hover:scale-[1.02]
        ${variants[variant]}
        ${sizes[size]}
        ${className}
      `}
    >
      {children}
    </Link>
  )
}
