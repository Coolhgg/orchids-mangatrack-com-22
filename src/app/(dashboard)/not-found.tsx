"use client"

import { Button } from "@/components/ui/button"
import { FileQuestion, Home, Search } from "lucide-react"
import Link from "next/link"

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6 text-center">
      <div className="size-20 rounded-full bg-zinc-100 dark:bg-zinc-900 flex items-center justify-center mb-6">
        <FileQuestion className="size-10 text-zinc-400" />
      </div>
      
      <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50 mb-2">
        Page not found
      </h2>
      <p className="text-zinc-500 dark:text-zinc-400 max-w-md mb-8">
        The page you&apos;re looking for doesn&apos;t exist or has been moved.
      </p>
      
      <div className="flex items-center gap-4">
        <Link href="/library">
          <Button className="rounded-full px-6 bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900">
            <Home className="size-4 mr-2" />
            Go to Library
          </Button>
        </Link>
        <Link href="/discover">
          <Button variant="outline" className="rounded-full px-6 border-zinc-200 dark:border-zinc-800">
            <Search className="size-4 mr-2" />
            Discover
          </Button>
        </Link>
      </div>
    </div>
  )
}
