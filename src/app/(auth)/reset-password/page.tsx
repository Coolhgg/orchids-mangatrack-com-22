"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, KeyRound, CheckCircle2, AlertCircle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [validToken, setValidToken] = useState<boolean | null>(null)
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setValidToken(true)
      }
    })

    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setValidToken(true)
      } else {
        const hash = window.location.hash
        if (hash.includes("type=recovery")) {
          setValidToken(true)
        } else {
          setValidToken(false)
        }
      }
    }
    checkSession()
    
    return () => {
      subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    if (password !== confirmPassword) {
      setError("Passwords do not match")
      return
    }

    if (password.length < 8) {
      setError("Password must be at least 8 characters")
      return
    }

    setLoading(true)

    try {
      const supabase = createClient()
      const { error: updateError } = await supabase.auth.updateUser({
        password: password,
      })

      if (updateError) {
        setError(updateError.message)
        return
      }

      setSuccess(true)
      setTimeout(() => {
        router.push("/library")
      }, 2000)
    } catch (_err) {
      setError("An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  if (validToken === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900">
        <Loader2 className="size-8 animate-spin text-zinc-400" />
      </div>
    )
  }

  if (validToken === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
        <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 size-12 rounded-2xl bg-red-500 flex items-center justify-center">
              <AlertCircle className="size-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Invalid or expired link</CardTitle>
            <CardDescription className="text-zinc-500">
              This password reset link is invalid or has expired. Please request a new one.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Link href="/forgot-password" className="w-full">
              <Button className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold">
                Request new link
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    )
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
        <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
          <CardHeader className="space-y-1 text-center">
            <div className="mx-auto mb-4 size-12 rounded-2xl bg-green-500 flex items-center justify-center">
              <CheckCircle2 className="size-6 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold tracking-tight">Password updated!</CardTitle>
            <CardDescription className="text-zinc-500">
              Your password has been successfully reset. Redirecting you to your library...
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Loader2 className="size-6 animate-spin text-zinc-400" />
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center">
            <KeyRound className="size-5 text-zinc-50 dark:text-zinc-900" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Set new password</CardTitle>
          <CardDescription className="text-zinc-500">
            Enter your new password below
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
              <Label htmlFor="password">New password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                disabled={loading}
                minLength={8}
                className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm new password</Label>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                disabled={loading}
                minLength={8}
                className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
              />
            </div>

            <p className="text-xs text-zinc-500">Password must be at least 8 characters long</p>
          </CardContent>

          <CardFooter>
            <Button 
              type="submit" 
              className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold"
              disabled={loading}
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : "Update password"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
