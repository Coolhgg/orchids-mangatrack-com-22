'use client'

import { memo } from 'react'
import Image from 'next/image'

// Yuki character image URLs from Supabase storage
export const YUKI_IMAGES = {
  characterSheet: 'https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/8235759d-8441-4507-8816-a6e7cf69f6b8/Master_Character_Sheet-resized-1769282469969.webp',
  propSheet: 'https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/8235759d-8441-4507-8816-a6e7cf69f6b8/prop_sheet-resized-1769282476326.webp',
  emotionSheet: 'https://slelguoygbfzlpylpxfs.supabase.co/storage/v1/render/image/public/project-uploads/8235759d-8441-4507-8816-a6e7cf69f6b8/emotions_sheet-resized-1769282478456.webp',
}

// Color palette from character sheet
export const YUKI_COLORS = {
  hairDark: '#021450',
  hairPurple: '#023635',
  eyes: '#E78087',
  cardigan: '#EBB9AA',
  shirt: '#FFF0FC',
  skirt: '#02466F',
  skin: '#FFF0FC',
}

// Animation classes
export const getAnimationClass = (animate?: 'float' | 'bounce' | 'shake' | 'breathe' | 'wave' | 'none') => {
  switch (animate) {
    case 'float':
      return 'animate-[float_4s_ease-in-out_infinite]'
    case 'bounce':
      return 'animate-[bounce_0.6s_ease-in-out_infinite]'
    case 'shake':
      return 'animate-[shake_0.3s_ease-in-out_infinite]'
    case 'breathe':
      return 'animate-[breathe_2s_ease-in-out_infinite]'
    case 'wave':
      return 'animate-[float_3s_ease-in-out_infinite]'
    default:
      return ''
  }
}

// Simple image component for Yuki sheets
interface YukiSheetImageProps {
  sheet: 'character' | 'props' | 'emotions'
  className?: string
  style?: React.CSSProperties
  animate?: 'float' | 'bounce' | 'shake' | 'breathe' | 'wave' | 'none'
  priority?: boolean
  objectPosition?: string
  scale?: number
}

export const YukiSheetImage = memo(function YukiSheetImage({
  sheet,
  className = '',
  style,
  animate = 'none',
  priority = false,
  objectPosition = 'center',
  scale = 1,
}: YukiSheetImageProps) {
  const animationClass = getAnimationClass(animate)

  const imageUrl = {
    character: YUKI_IMAGES.characterSheet,
    props: YUKI_IMAGES.propSheet,
    emotions: YUKI_IMAGES.emotionSheet,
  }[sheet]

  return (
    <div
      className={`relative overflow-hidden ${animationClass} ${className}`}
      style={{
        ...style,
        filter: 'drop-shadow(0 10px 30px rgba(2, 20, 80, 0.3))',
      }}
    >
      <Image
        src={imageUrl}
        alt="Yuki character"
        fill
        className="object-cover"
        style={{
          objectPosition,
          transform: `scale(${scale})`,
        }}
        priority={priority}
        unoptimized
      />
    </div>
  )
})

// Export the constants and utility for use in scenes
export default YukiSheetImage
