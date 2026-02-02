"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle, RefreshCw, Home } from "lucide-react"
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

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      console.error("Dashboard error:", error)
    }
    
    // Auto-refresh for chunk load errors
    if (isChunkLoadError(error)) {
      handleChunkLoadError();
    }
  }, [error])

  // Show refresh UI for chunk errors
  if (isChunkLoadError(error)) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
        <div className="size-20 rounded-full bg-blue-50 dark:bg-blue-950/30 flex items-center justify-center mb-6">
          <RefreshCw className="size-10 text-blue-500 animate-spin" />
        </div>
        
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
          Updating...
        </h2>
        <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8">
          A new version is available. Refreshing to load the latest version.
        </p>
        
        <Button
          onClick={handleChunkLoadError}
          className="rounded-full px-6 bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900"
        >
          <RefreshCw className="size-4 mr-2" />
          Refresh Now
        </Button>
      </div>
    );
  }

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="size-20 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center mb-6">
        <AlertTriangle className="size-10 text-red-500" />
      </div>
      
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
        Something went wrong
      </h2>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8">
        We encountered an unexpected error. This has been logged and we&apos;ll look into it.
      </p>
      
      <div className="flex items-center gap-4">
        <Button
          onClick={reset}
          className="rounded-full px-6 bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900"
        >
          <RefreshCw className="size-4 mr-2" />
          Try again
        </Button>
        <Link href="/library">
          <Button variant="outline" className="rounded-full px-6 border-zinc-200 dark:border-zinc-800">
            <Home className="size-4 mr-2" />
            Go to Library
          </Button>
        </Link>
      </div>
      
      {error.digest && (
        <p className="mt-8 text-xs text-zinc-400 font-mono">
          Error ID: {error.digest}
        </p>
      )}
    </div>
  )
}
