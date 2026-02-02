import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle } from "lucide-react"

export default function AuthCodeErrorPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 size-16 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
            <AlertCircle className="size-8 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Authentication Error</CardTitle>
          <CardDescription className="text-zinc-500">
            We couldn&apos;t complete the sign-in process. This might happen if:
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ul className="text-sm text-zinc-600 dark:text-zinc-400 space-y-2 list-disc list-inside">
            <li>The authentication link has expired</li>
            <li>You&apos;ve already used this link</li>
            <li>There was a problem connecting to the provider</li>
            <li>The request was cancelled or interrupted</li>
          </ul>
        </CardContent>
        <CardFooter className="flex flex-col space-y-3">
          <Link href="/login" className="w-full">
            <Button className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold">
              Try again
            </Button>
          </Link>
          <Link href="/" className="w-full">
            <Button variant="outline" className="w-full h-11 rounded-xl">
              Back to home
            </Button>
          </Link>
        </CardFooter>
      </Card>
    </div>
  )
}
