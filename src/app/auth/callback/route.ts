import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit, getClientIp, getSafeRedirect } from "@/lib/api-utils"
import { prisma } from "@/lib/prisma"
import { logger } from "@/lib/logger"

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error')
  const errorDescription = searchParams.get('error_description')
  const next = getSafeRedirect(searchParams.get('next'), '/library')

  const ip = getClientIp(request)
  if (!await checkRateLimit(`oauth:${ip}`, 10, 60000)) {
    logger.warn('Auth: OAuth callback rate limited', { ip })
    return NextResponse.redirect(`${origin}/auth/auth-code-error?error=rate_limited`)
  }

  if (errorParam) {
    logger.warn('Auth: OAuth provider returned error', { error: errorParam, description: errorDescription })
    return NextResponse.redirect(`${origin}/auth/auth-code-error?error=${encodeURIComponent(errorParam)}`)
  }

  if (!code) {
    logger.warn('Auth: OAuth callback missing code parameter')
    return NextResponse.redirect(`${origin}/auth/auth-code-error?error=missing_code`)
  }

  try {
    const supabase = await createClient()
    
    // Exchange code for session first, then handle any existing session cleanup
    // This avoids race conditions where signOut() could invalidate a concurrent valid session
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    
    if (error) {
      logger.error('Auth: Failed to exchange code for session', { error: error.message })
      return NextResponse.redirect(`${origin}/auth/auth-code-error?error=exchange_failed`)
    }
    
    if (!data.user) {
      logger.error('Auth: No user returned after code exchange')
      return NextResponse.redirect(`${origin}/auth/auth-code-error?error=no_user`)
    }

    try {
      const dbUser = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM "users" WHERE id = ${data.user.id}::uuid LIMIT 1
      `
      
      if (dbUser.length > 0 && dbUser[0].deleted_at !== null) {
        await supabase.auth.signOut()
        logger.info('Auth: Blocked login for soft-deleted user', { userId: data.user.id })
        return NextResponse.redirect(`${origin}/auth/auth-code-error?error=account_deleted`)
      }
    } catch (dbError) {
      logger.warn('Auth: Could not verify soft-delete status', { 
        userId: data.user.id,
        error: dbError instanceof Error ? dbError.message : String(dbError) 
      })
    }
    
    logger.info('Auth: OAuth login successful', { userId: data.user.id })
    return NextResponse.redirect(`${origin}${next}`)
  } catch (err) {
    logger.error('Auth: Unexpected error in OAuth callback', { 
      error: err instanceof Error ? err.message : String(err) 
    })
    return NextResponse.redirect(`${origin}/auth/auth-code-error?error=unexpected`)
  }
}
