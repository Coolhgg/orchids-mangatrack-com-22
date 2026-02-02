"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, ArrowLeft, Mail, CheckCircle2 } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })

      if (resetError) {
        setError(resetError.message)
        return
      }

      setSuccess(true)
    } catch (_err) {
      setError("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
        <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 size-12 rounded-2xl bg-green-500 flex items-center justify-center">
              <CheckCircle2 className="size-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Check your email</CardTitle>
            <CardDescription className="text-zinc-500">
              We&apos;ve sent a password reset link to <span className="font-medium text-zinc-900 dark:text-zinc-50">{email}</span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900 p-4 text-sm text-zinc-600 dark:text-zinc-400 border border-zinc-100 dark:border-zinc-800">
              <p className="mb-2">Didn&apos;t receive an email?</p>
              <ul className="list-disc list-inside space-y-1 text-xs">
                <li>Check your spam folder</li>
                <li>Make sure you entered the correct email</li>
                <li>Wait a few minutes and try again</li>
              </ul>
            </div>
          </CardContent>
          <CardFooter className="flex flex-col space-y-4">
            <Button
              onClick={() => setSuccess(false)}
              variant="outline"
              className="w-full h-11 rounded-xl border-zinc-200 dark:border-zinc-800"
            >
              Try another email
            </Button>
            <Link href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
              <ArrowLeft className="inline size-4 mr-1" />
              Back to login
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center">
            <Mail className="size-5 text-zinc-50 dark:text-zinc-900" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Forgot password?</CardTitle>
          <CardDescription className="text-zinc-500">
            Enter your email and we&apos;ll send you a reset link
          </CardDescription>
        </CardHeader>

        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900">
                {error}
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email address</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading}
                className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
              />
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-4">
            <Button 
              type="submit" 
              className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold"
              disabled={loading}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Send reset link"}
            </Button>
            <Link href="/login" className="text-center text-sm text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
              <ArrowLeft className="inline size-4 mr-1" />
              Back to login
            </Link>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
