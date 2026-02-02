"use client"

interface SourceCardProps {
  sourceUrl: string
  children: React.ReactNode
  className?: string
}

export function SourceCard({ sourceUrl, children, className }: SourceCardProps) {
  const handleClick = () => {
    window.parent.postMessage({ 
      type: "OPEN_EXTERNAL_URL", 
      data: { url: sourceUrl } 
    }, "*")
  }

  return (
    <div onClick={handleClick} className={className}>
      {children}
    </div>
  )
}
