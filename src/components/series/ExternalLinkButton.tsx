"use client"

interface ExternalLinkButtonProps {
  url: string
  children: React.ReactNode
  className?: string
}

export function ExternalLinkButton({ url, children, className }: ExternalLinkButtonProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault()
    window.parent.postMessage({ 
      type: "OPEN_EXTERNAL_URL", 
      data: { url } 
    }, "*")
  }

  return (
    <button onClick={handleClick} className={className}>
      {children}
    </button>
  )
}
