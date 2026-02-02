"use client"

import { useState, useEffect, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react"
import { login as loginAction } from "@/app/auth/auth-actions"
import { createClient } from "@/lib/supabase/client"

function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [lastSubmitTime, setLastSubmitTime] = useState(0)
  const [resendLoading, setResendLoading] = useState(false)
  const [showResendButton, setShowResendButton] = useState(false)

  const searchParams = useSearchParams()

  // Check for URL query params (error or message from redirects)
  useEffect(() => {
    const urlError = searchParams.get('error')
    const urlMessage = searchParams.get('message')
    
    if (urlError) {
      const decodedError = decodeURIComponent(urlError)
      setError(decodedError)
      if (decodedError.toLowerCase().includes('confirm') || decodedError.toLowerCase().includes('email')) {
        setShowResendButton(true)
      }
    }
    if (urlMessage) {
      setMessage(decodeURIComponent(urlMessage))
    }
  }, [searchParams])

  const handleResendConfirmation = async () => {
    if (!email.trim()) {
      setError("Please enter your email address to resend confirmation")
      return
    }
    
    setResendLoading(true)
    setError(null)
    
    try {
      const supabase = createClient()
      const { error: resendError } = await supabase.auth.resend({
        type: 'signup',
        email: email.trim(),
      })
      
      if (resendError) {
        setError(resendError.message)
      } else {
        setMessage("Confirmation email sent! Please check your inbox and spam folder.")
        setShowResendButton(false)
      }
    } catch {
      setError("Failed to resend confirmation email. Please try again.")
    } finally {
      setResendLoading(false)
    }
  }

  // BUG FIX: Clear error when user starts typing
  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value)
    if (error) setError(null)
  }

  const handlePasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPassword(e.target.value)
    if (error) setError(null)
  }

  const handleLogin = (e: React.FormEvent) => {
    // SECURITY: Client-side throttle to prevent rapid submission
    const now = Date.now()
    if (now - lastSubmitTime < 2000) {
      e.preventDefault()
      setError("Please wait a moment before trying again.")
      return
    }
    setLastSubmitTime(now)

    // Clear previous messages
    setError(null)
    setMessage(null)
    
    // Basic validation
    if (!email.trim()) {
      e.preventDefault()
      setError("Please enter your email address")
      return
    }
    if (!password) {
      e.preventDefault()
      setError("Please enter your password")
      return
    }
    
    setLoading(true)
    setError(null)
    setMessage(null)
  }

  const handleOAuth = async (provider: "google" | "discord") => {
    setOauthLoading(provider)
    setError(null)
    setMessage(null)

    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=/library`,
        },
      })

      if (error) {
        setError(error.message)
        setOauthLoading(null)
      }
      } catch (_err) {
      setError("Failed to connect to provider. Please try again.")
      setOauthLoading(null)
    }
  }

  return (
    <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <Link href="/" className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center hover:opacity-90 transition-opacity">
          <span className="text-xl font-black text-zinc-50 dark:text-zinc-900">K</span>
        </Link>
        <CardTitle className="text-2xl font-bold tracking-tight">Welcome back</CardTitle>
        <CardDescription className="text-zinc-500">
          Sign in to continue to your library
        </CardDescription>
      </CardHeader>

      <form action={loginAction} onSubmit={handleLogin}>
        <CardContent className="space-y-4">
          {/* Success message from URL params */}
          {message && (
            <div className="rounded-xl bg-green-50 dark:bg-green-950/50 p-3 text-sm text-green-600 dark:text-green-400 border border-green-100 dark:border-green-900 flex items-start gap-2">
              <CheckCircle2 className="size-4 mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          )}
          
          {/* Error message */}
          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900">
              <div className="flex items-start gap-2">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
              {showResendButton && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full text-red-600 dark:text-red-400 border-red-200 dark:border-red-800 hover:bg-red-100 dark:hover:bg-red-900/50"
                  onClick={handleResendConfirmation}
                  disabled={resendLoading}
                >
                  {resendLoading ? (
                    <Loader2 className="size-4 animate-spin mr-2" />
                  ) : null}
                  Resend confirmation email
                </Button>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-zinc-200 dark:border-zinc-800"
              onClick={() => handleOAuth("google")}
              disabled={!!oauthLoading || loading}
            >
              {oauthLoading === "google" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <svg className="size-4 mr-2" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Google
                </>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11 rounded-xl border-zinc-200 dark:border-zinc-800"
              onClick={() => handleOAuth("discord")}
              disabled={!!oauthLoading || loading}
            >
              {oauthLoading === "discord" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <svg className="size-4 mr-2" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
                  </svg>
                  Discord
                </>
              )}
            </Button>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-zinc-200 dark:border-zinc-800" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-zinc-950 px-2 text-zinc-500">or continue with email</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={handleEmailChange}
              required
              disabled={loading}
              autoComplete="email"
              className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <Link href="/forgot-password" className="text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-50">
                Forgot password?
              </Link>
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={handlePasswordChange}
              required
              disabled={loading}
              autoComplete="current-password"
              className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button 
            type="submit" 
            className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold"
            disabled={loading || !!oauthLoading}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Sign in"}
          </Button>
          <p className="text-center text-sm text-zinc-500">
            Don&apos;t have an account?{" "}
            <Link href="/register" className="font-semibold text-zinc-900 dark:text-zinc-50 hover:underline">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}

function LoginFormSkeleton() {
  return (
    <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mx-auto w-40" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mx-auto w-56 mt-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        </div>
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-16" />
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-20" />
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        </div>
      </CardContent>
      <CardFooter className="flex flex-col space-y-4">
        <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse w-full" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-48 mx-auto" />
      </CardFooter>
    </Card>
  )
}

export default function LoginPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4">
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginForm />
      </Suspense>
    </div>
  )
}
