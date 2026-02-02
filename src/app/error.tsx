"use client"

import { useEffect } from "react"
import Link from "next/link"

function isChunkLoadError(error: Error): boolean {
  const message = error.message?.toLowerCase() || '';
  const name = error.name?.toLowerCase() || '';
  return (
    name.includes('chunkloaderror') ||
    message.includes('loading chunk') ||
    message.includes('failed to fetch dynamically imported module') ||
    message.includes('loading css chunk')
  );
}

function handleChunkLoadError(): void {
  if ('caches' in window) {
    caches.keys().then((names) => {
      names.forEach((name) => caches.delete(name));
    });
  }
  window.location.reload();
}

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error("Root error:", error)
    }
    
    if (isChunkLoadError(error)) {
      handleChunkLoadError();
    }
  }, [error])

  if (isChunkLoadError(error)) {
    return (
      <div className="min-h-screen bg-[#0c0a14] flex flex-col items-center justify-center p-6 text-center">
        <div className="w-20 h-20 rounded-full bg-purple-500/10 flex items-center justify-center mb-6 animate-pulse">
          <svg className="w-10 h-10 text-purple-500 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
        
        <h2 className="text-2xl font-bold text-white mb-2">
          Updating...
        </h2>
        <p className="text-white/60 max-w-md mb-8">
          A new version is available. Refreshing to load the latest version.
        </p>
        
        <button
          onClick={handleChunkLoadError}
          className="px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors"
        >
          Refresh Now
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0c0a14] flex flex-col items-center justify-center p-6 text-center">
      <div className="w-20 h-20 rounded-full bg-red-500/10 flex items-center justify-center mb-6">
        <svg className="w-10 h-10 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      
      <h2 className="text-2xl font-bold text-white mb-2">
        Something went wrong
      </h2>
      <p className="text-white/60 max-w-md mb-8">
        We encountered an unexpected error. Please try again or return home.
      </p>
      
      <div className="flex items-center gap-4">
        <button
          onClick={reset}
          className="px-6 py-3 rounded-full bg-purple-600 hover:bg-purple-700 text-white font-medium transition-colors"
        >
          Try again
        </button>
        <Link
          href="/"
          className="px-6 py-3 rounded-full border border-white/20 hover:border-white/40 text-white font-medium transition-colors"
        >
          Go Home
        </Link>
      </div>
      
      {error.digest && (
        <p className="mt-8 text-xs text-white/40 font-mono">
          Error ID: {error.digest}
        </p>
      )}
    </div>
  )
}
