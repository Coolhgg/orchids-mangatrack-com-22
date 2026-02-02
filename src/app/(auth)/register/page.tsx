"use client"

import { useState, Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Loader2, Check, X, AlertCircle, AlertTriangle } from "lucide-react"
import { createClient } from "@/lib/supabase/client"

function RegisterForm() {
  const searchParams = useSearchParams()
  const urlError = searchParams.get("error")
  
  const [username, setUsername] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [oauthLoading, setOauthLoading] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(urlError)
  const [warning, setWarning] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const passwordRequirements = [
    { met: password.length >= 8, text: "At least 8 characters" },
    { met: /[A-Z]/.test(password), text: "One uppercase letter" },
    { met: /[0-9]/.test(password), text: "One number" },
  ]

  const isPasswordValid = passwordRequirements.every((r) => r.met)
  const isUsernameValid = username.length >= 3 && username.length <= 20 && /^[a-zA-Z0-9_-]+$/.test(username)

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isPasswordValid) {
      setError("Please meet all password requirements")
      return
    }
    if (!isUsernameValid) {
      setError("Username must be 3-20 characters (letters, numbers, underscores only)")
      return
    }

    setLoading(true)
    setError(null)
    setWarning(null)

    try {
      const supabase = createClient()
      
      // Check if username is available via API
      try {
        const checkRes = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`)
        const checkData = await checkRes.json()
        
        if (!checkRes.ok) {
          if (checkRes.status === 409) {
            setError(checkData.error || "Username is already taken")
            setLoading(false)
            return
          } else if (checkRes.status === 429) {
            setError("Too many requests. Please wait a moment and try again.")
            setLoading(false)
            return
          }
          // For other errors, show warning but allow signup to proceed
          setWarning(checkData.error || "Could not verify username")
        } else if (checkData.warning) {
          // API returned success but with a warning
          setWarning(checkData.warning)
        } else if (checkData.available === false) {
          setError(checkData.error || "Username is already taken")
          setLoading(false)
          return
        }
      } catch (fetchError) {
        // Network error - show warning but allow signup to proceed
        console.error("Username check fetch error:", fetchError)
        setWarning("Could not verify username availability. Proceeding with registration...")
      }
      
      // Sign up with Supabase Auth
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username },
        },
      })

      if (signUpError) {
        // Handle specific Supabase errors
        if (signUpError.message.includes("already registered")) {
          setError("This email is already registered. Please sign in instead.")
        } else if (signUpError.message.includes("valid email")) {
          setError("Please enter a valid email address.")
        } else if (signUpError.message.includes("password")) {
          setError("Password does not meet requirements. Please use a stronger password.")
        } else {
          setError(signUpError.message)
        }
        setLoading(false)
        return
      }

      if (!data.user) {
        setError("Failed to create account. Please try again.")
        setLoading(false)
        return
      }

      // Check if email confirmation is required
      if (!data.user.email_confirmed_at && !data.session) {
        // Email confirmation required
        setSuccess(true)
      } else {
        // No email confirmation required or already confirmed
          // Force a hard navigation to ensure cookies are properly set
          window.location.href = "/library"
      }
      } catch (_err) {
      console.error("Registration error:", _err)
      setError("An unexpected error occurred. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleOAuth = async (provider: "google" | "discord") => {
    setOauthLoading(provider)
    setError(null)
    setWarning(null)

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

  if (success) {
    return (
      <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
        <CardHeader className="space-y-1 text-center">
          <div className="mx-auto mb-4 size-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Check className="size-8 text-green-600 dark:text-green-400" />
          </div>
          <CardTitle className="text-2xl font-bold tracking-tight">Check your email</CardTitle>
          <CardDescription className="text-zinc-500">
            We sent a confirmation link to <strong className="text-zinc-900 dark:text-zinc-50">{email}</strong>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="text-center text-sm text-zinc-500">
            <p>Click the link in your email to activate your account and start tracking your manga.</p>
            <p className="mt-2 text-amber-600 dark:text-amber-400 font-medium">
              Can&apos;t find it? Check your spam or junk folder.
            </p>
          </div>
          <div className="rounded-lg bg-zinc-100 dark:bg-zinc-800/50 p-3 text-xs text-zinc-500">
            <strong>Note:</strong> You must confirm your email before you can sign in.
          </div>
        </CardContent>
        <CardFooter>
          <Link href="/login" className="w-full">
            <Button variant="outline" className="w-full h-11 rounded-xl">
              Go to login
            </Button>
          </Link>
        </CardFooter>
      </Card>
    )
  }

  return (
    <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <Link href="/" className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-900 dark:bg-zinc-50 flex items-center justify-center hover:opacity-90 transition-opacity">
          <span className="text-xl font-black text-zinc-50 dark:text-zinc-900">K</span>
        </Link>
        <CardTitle className="text-2xl font-bold tracking-tight">Create an account</CardTitle>
        <CardDescription className="text-zinc-500">
          Start tracking your manga collection today
        </CardDescription>
      </CardHeader>

      <form onSubmit={handleRegister}>
        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-xl bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900 flex items-start gap-2">
              <AlertCircle className="size-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          
          {warning && !error && (
            <div className="rounded-xl bg-yellow-50 dark:bg-yellow-950/50 p-3 text-sm text-yellow-600 dark:text-yellow-400 border border-yellow-100 dark:border-yellow-900 flex items-start gap-2">
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>{warning}</span>
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
            <Label htmlFor="username">Username</Label>
            <Input
              id="username"
              name="username"
              type="text"
              placeholder="manga_reader"
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              required
              minLength={3}
              maxLength={20}
              disabled={loading}
              autoComplete="username"
              className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
            <p className="text-xs text-zinc-500">Lowercase letters, numbers, and underscores only (3-20 chars)</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              disabled={loading}
              autoComplete="email"
              className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={loading}
              autoComplete="new-password"
              className="h-11 rounded-xl bg-zinc-50 dark:bg-zinc-900 border-zinc-200 dark:border-zinc-800"
            />
            <div className="space-y-1 pt-1">
              {passwordRequirements.map((req, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  {req.met ? (
                    <Check className="size-3 text-green-500" />
                  ) : (
                    <X className="size-3 text-zinc-300" />
                  )}
                  <span className={req.met ? "text-green-600 dark:text-green-400" : "text-zinc-400"}>
                    {req.text}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex flex-col space-y-4">
          <Button
            type="submit"
            className="w-full h-11 rounded-xl bg-zinc-900 dark:bg-zinc-50 text-zinc-50 dark:text-zinc-900 font-semibold"
            disabled={loading || !!oauthLoading || !isPasswordValid || !isUsernameValid}
          >
            {loading ? <Loader2 className="size-4 animate-spin" /> : "Create account"}
          </Button>
          <p className="text-center text-sm text-zinc-500">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-zinc-900 dark:text-zinc-50 hover:underline">
              Sign in
            </Link>
          </p>
          <p className="text-center text-xs text-zinc-400">
            By creating an account, you agree to our Terms of Service and Privacy Policy.
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}

function RegisterFormSkeleton() {
  return (
    <Card className="w-full max-w-md border-zinc-200 dark:border-zinc-800 shadow-xl">
      <CardHeader className="space-y-1 text-center">
        <div className="mx-auto mb-4 size-12 rounded-2xl bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
        <div className="h-8 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mx-auto w-48" />
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse mx-auto w-64 mt-2" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        </div>
        <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse" />
        <div className="space-y-2">
          <div className="h-4 bg-zinc-200 dark:bg-zinc-800 rounded animate-pulse w-20" />
          <div className="h-11 bg-zinc-200 dark:bg-zinc-800 rounded-xl animate-pulse" />
        </div>
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

export default function RegisterPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-zinc-50 to-zinc-100 dark:from-zinc-950 dark:to-zinc-900 px-4 py-8">
      <Suspense fallback={<RegisterFormSkeleton />}>
        <RegisterForm />
      </Suspense>
    </div>
  )
}
