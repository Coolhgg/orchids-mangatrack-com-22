'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, comparePasswords } from '@/lib/auth-utils'

// P0-4 FIX: CSRF Protection helper for server actions
async function validateCsrfOrigin(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    return; // Skip CSRF check in development
  }
  
  const headersList = await headers()
  const origin = headersList.get('origin')
  const host = headersList.get('host')
  
  if (origin && host) {
    try {
      const originHost = new URL(origin).host
      if (originHost !== host) {
        throw new Error('Invalid request origin - CSRF protection triggered')
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes('CSRF')) {
        throw e
      }
      // URL parsing failed - invalid origin
      throw new Error('Invalid request origin format')
    }
  }
}

// P1-7 FIX: Improved redirect error detection
function isRedirectError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  
  const error = err as { digest?: string; message?: string; name?: string }
  
  // Check all known patterns for Next.js redirect
  return (
    error.digest?.includes('NEXT_REDIRECT') ||
    error.message === 'NEXT_REDIRECT' ||
    error.name === 'RedirectError' ||
    (typeof error.digest === 'string' && error.digest.startsWith('NEXT_REDIRECT'))
  )
}

export async function login(formData: FormData) {
  // P0-4: Validate CSRF
  await validateCsrfOrigin()
  
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    redirect('/login?error=' + encodeURIComponent('Email and password are required'))
  }

  let success = false
  let errorMessage = ''
  const targetUrl = '/library'

  try {
    // Guard against Prisma client not being initialized
    if (!prisma?.user) {
      console.error('[Auth] Prisma client not initialized')
      errorMessage = 'Service temporarily unavailable. Please try again.'
      redirect('/login?error=' + encodeURIComponent(errorMessage))
    }
    
    const user = await prisma.user.findUnique({
      where: { email }
    })

    const supabase = await createClient()

    if (!user) {
      const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password })
      
      if (signInError) {
        errorMessage = signInError.message === 'Invalid login credentials' 
          ? 'Invalid email or password' 
          : signInError.message
      } else if (signInData.user) {
        const password_hash = await hashPassword(password)
        await prisma.user.upsert({
          where: { id: signInData.user.id },
          update: { email },
          create: {
            id: signInData.user.id,
            email,
            username: signInData.user.user_metadata?.username || email.split('@')[0],
            password_hash,
            xp: 0,
            level: 1,
            subscription_tier: 'free',
          }
        })
        success = true
      }
    } else {
      const isPasswordValid = await comparePasswords(password, user.password_hash)
      
      if (!isPasswordValid) {
        const { data: signInData, error: fallbackError } = await supabase.auth.signInWithPassword({ email, password })
        if (!fallbackError && signInData.user) {
          const password_hash = await hashPassword(password)
          await prisma.user.update({
            where: { id: user.id },
            data: { password_hash }
          })
          success = true
        } else {
          errorMessage = 'Invalid email or password'
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password })

      if (error) {
            errorMessage = error.message
            if (error.message.includes('Email not confirmed') || error.code === 'email_not_confirmed') {
              errorMessage = 'Please check your inbox and confirm your email before signing in. Check spam folder if you cannot find it.'
            } else if (error.message.includes('Invalid login credentials')) {
              errorMessage = 'Invalid email or password'
            }
          } else {
            success = true
          }
      }
    }
  } catch (err: unknown) {
    // P1-7 FIX: Improved redirect error detection
    if (isRedirectError(err)) {
      throw err
    }
    console.error('[Auth] Login error:', err)
    errorMessage = 'An unexpected server error occurred. Please try again later.'
  }

  if (success) {
    revalidatePath('/', 'layout')
    redirect(targetUrl)
  } else {
    redirect('/login?error=' + encodeURIComponent(errorMessage || 'Login failed'))
  }
}

export async function signup(formData: FormData) {
  // P0-4: Validate CSRF
  await validateCsrfOrigin()
  
  const email = formData.get('email') as string
  const password = formData.get('password') as string
  const username = formData.get('username') as string

  if (!email || !password || !username) {
    redirect('/register?error=' + encodeURIComponent('All fields are required'))
  }

  let success = false
  let errorMessage = ''
  let needsConfirmation = false

  try {
    // Guard against Prisma client not being initialized
    if (!prisma?.user) {
      console.error('[Auth] Prisma client not initialized')
      errorMessage = 'Service temporarily unavailable. Please try again.'
      redirect('/register?error=' + encodeURIComponent(errorMessage))
    }
    
    const existingUser = await prisma.user.findFirst({
      where: {
        OR: [
          { email },
          { username }
        ]
      }
    })

    if (existingUser) {
      errorMessage = 'User already exists with this email or username'
    } else {
      const supabase = await createClient()
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { username }
        }
      })

      if (authError) {
        errorMessage = authError.message
      } else if (!authData.user) {
        errorMessage = 'Failed to create account'
      } else {
        const isConfirmed = !!authData.user.email_confirmed_at
        const password_hash = await hashPassword(password)
        
        await prisma.user.upsert({
          where: { id: authData.user.id },
          update: {
            email,
            username,
            password_hash
          },
          create: {
            id: authData.user.id,
            email,
            username,
            password_hash,
            xp: 0,
            level: 1,
            streak_days: 0,
            subscription_tier: 'free',
            notification_settings: { email: true, push: false },
            privacy_settings: { library_public: true, activity_public: true },
          }
        })
        
        if (isConfirmed) {
          success = true
        } else {
          needsConfirmation = true
        }
      }
    }
  } catch (err: unknown) {
    // P1-7 FIX: Improved redirect error detection
    if (isRedirectError(err)) {
      throw err
    }
    console.error('[Auth] Signup error:', err)
    errorMessage = 'An unexpected error occurred during registration.'
  }

  if (success) {
    revalidatePath('/', 'layout')
    redirect('/library')
  } else if (needsConfirmation) {
    redirect('/login?message=' + encodeURIComponent('Please check your email to confirm your account before logging in.'))
  } else {
    redirect('/register?error=' + encodeURIComponent(errorMessage || 'Registration failed'))
  }
}

export async function logout() {
  try {
    const supabase = await createClient()
    await supabase.auth.signOut()
  } catch (err: unknown) {
    // P1-7 FIX: Improved redirect error detection
    if (isRedirectError(err)) {
      throw err
    }
    console.error('[Auth] Logout error:', err)
  } finally {
    revalidatePath('/', 'layout')
    redirect('/')
  }
}
