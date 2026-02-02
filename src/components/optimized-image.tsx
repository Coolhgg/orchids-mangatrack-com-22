"use client"

import { useState, useEffect, useRef, memo, ImgHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

interface OptimizedImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt: string
  fallback?: string
  aspectRatio?: string
  priority?: boolean
  onLoadComplete?: () => void
}

/**
 * OptimizedImage - A performance-optimized image component with:
 * - Lazy loading by default
 * - Blur placeholder effect
 * - Error fallback
 * - Loading state
 */
export const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  fallback = '/placeholder-cover.jpg',
  aspectRatio = '3/4',
  priority = false,
  className,
  onLoadComplete,
  ...props
}: OptimizedImageProps) {
  const [isLoading, setIsLoading] = useState(true)
  const [hasError, setHasError] = useState(false)
  const [isInView, setIsInView] = useState(priority)
  const imgRef = useRef<HTMLImageElement>(null)

  // Use intersection observer for lazy loading
  useEffect(() => {
    if (priority || !imgRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true)
          observer.disconnect()
        }
      },
      {
        rootMargin: '50px',
        threshold: 0,
      }
    )

    observer.observe(imgRef.current)

    return () => observer.disconnect()
  }, [priority])

  const handleLoad = () => {
    setIsLoading(false)
    onLoadComplete?.()
  }

  const handleError = () => {
    setIsLoading(false)
    setHasError(true)
  }

  // Proxy external images through our API
  const imageSrc = hasError ? fallback : src
  const proxiedSrc = imageSrc && !imageSrc.startsWith('/') && !imageSrc.startsWith('data:')
    ? `/api/proxy/image?url=${encodeURIComponent(imageSrc)}`
    : imageSrc

  return (
    <div
      ref={imgRef}
      className={cn(
        'relative overflow-hidden bg-zinc-100 dark:bg-zinc-900',
        className
      )}
      style={{ aspectRatio }}
    >
      {/* Loading skeleton */}
      {isLoading && (
        <div className="absolute inset-0 animate-pulse bg-zinc-200 dark:bg-zinc-800" />
      )}
      
      {/* Image */}
      {isInView && (
        <img
          src={proxiedSrc}
          alt={alt}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-300',
            isLoading ? 'opacity-0' : 'opacity-100'
          )}
          {...props}
        />
      )}
    </div>
  )
})

interface LazyComponentProps {
  children: React.ReactNode
  fallback?: React.ReactNode
  rootMargin?: string
  threshold?: number
}

/**
 * LazyComponent - Renders children only when they enter the viewport
 */
export function LazyComponent({
  children,
  fallback = null,
  rootMargin = '100px',
  threshold = 0,
}: LazyComponentProps) {
  const [isVisible, setIsVisible] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin, threshold }
    )

    observer.observe(containerRef.current)

    return () => observer.disconnect()
  }, [rootMargin, threshold])

  return (
    <div ref={containerRef}>
      {isVisible ? children : fallback}
    </div>
  )
}

/**
 * VirtualList - A simple virtualized list for rendering large lists
 */
interface VirtualListProps<T> {
  items: T[]
  itemHeight: number
  renderItem: (item: T, index: number) => React.ReactNode
  containerHeight: number
  overscan?: number
  className?: string
}

export function VirtualList<T>({
  items,
  itemHeight,
  renderItem,
  containerHeight,
  overscan = 3,
  className,
}: VirtualListProps<T>) {
  const [scrollTop, setScrollTop] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const totalHeight = items.length * itemHeight
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const visibleCount = Math.ceil(containerHeight / itemHeight) + 2 * overscan
  const endIndex = Math.min(items.length, startIndex + visibleCount)

  const visibleItems = items.slice(startIndex, endIndex)
  const offsetY = startIndex * itemHeight

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  return (
    <div
      ref={containerRef}
      className={cn('overflow-auto', className)}
      style={{ height: containerHeight }}
      onScroll={handleScroll}
    >
      <div style={{ height: totalHeight, position: 'relative' }}>
        <div style={{ transform: `translateY(${offsetY}px)` }}>
          {visibleItems.map((item, i) => (
            <div key={startIndex + i} style={{ height: itemHeight }}>
              {renderItem(item, startIndex + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default OptimizedImage
