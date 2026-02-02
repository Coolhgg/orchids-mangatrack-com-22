import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import type { User } from '@supabase/supabase-js'

// P0-2 FIX: Return user from updateSession to avoid double auth call
export interface UpdateSessionResult {
  response: NextResponse
  user: User | null
}

// Reduced timeout from 15s to 5s for faster failure and better UX
// 5s is sufficient for normal auth operations; longer delays indicate infrastructure issues
const AUTH_TIMEOUT_MS = 5000;

// Rate-limit timeout logging to avoid log spam (max 1 warning per 30s)
let lastTimeoutLogAt = 0;
const TIMEOUT_LOG_INTERVAL_MS = 30000;

export async function updateSession(request: NextRequest): Promise<UpdateSessionResult> {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll()
          },
          setAll(cookiesToSet) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
            supabaseResponse = NextResponse.next({
              request,
            })
            cookiesToSet.forEach(({ name, value, options }) =>
              supabaseResponse.cookies.set(name, value, options)
            )
          },
        },
      }
  )

  // Add timeout to prevent hanging if Supabase is slow/unavailable
  let user: User | null = null;
  let authTimedOut = false;
  try {
    const authPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => {
        authTimedOut = true;
        // Rate-limit timeout logging to reduce log noise
        const now = Date.now();
        if (now - lastTimeoutLogAt > TIMEOUT_LOG_INTERVAL_MS) {
          lastTimeoutLogAt = now;
          console.warn(`[Supabase] Auth call timed out after ${AUTH_TIMEOUT_MS}ms (logging throttled)`);
        }
        resolve(null);
      }, AUTH_TIMEOUT_MS);
    });
    
    const result = await Promise.race([authPromise, timeoutPromise]);
    if (result && 'data' in result) {
      user = result.data.user;
    }
  } catch (err) {
    console.error('[Supabase] Auth error:', err instanceof Error ? err.message : err);
  }

    const publicPaths = [
      '/login',
      '/register',
      '/forgot-password',
      '/reset-password',
      '/auth',
      '/onboarding',
      '/browse',
      '/series',
      '/dmca',
    ]

  const publicApiPaths = [
    '/api/health',
    '/api/auth/check-username',
    '/api/auth/lockout',
    '/api/proxy/image',
    '/api/proxy/check-url',
    '/api/series/', // Series info and chapters should be viewable without auth
    '/api/dmca',
  ]

  const isPublicPath = publicPaths.some(path => 
    request.nextUrl.pathname.startsWith(path)
  )

  const isPublicApiPath = publicApiPaths.some(path =>
    request.nextUrl.pathname.startsWith(path)
  )

  const isApiPath = request.nextUrl.pathname.startsWith('/api')

  if (!user) {
    // For protected API routes, return 401 JSON response
    // Include x-auth-degraded header if the reason was a timeout (not missing auth)
    if (isApiPath && !isPublicApiPath) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (authTimedOut) {
        headers['x-auth-degraded'] = 'timeout';
      }
      return {
        response: new NextResponse(
          JSON.stringify({ 
            error: 'unauthorized',
            ...(authTimedOut && { reason: 'auth_timeout', retry: true })
          }),
          { status: 401, headers }
        ),
        user: null
      }
    }

    // For protected pages, redirect to login
    // BUG FIX: Don't redirect public API paths - they should pass through
    // GRACEFUL DEGRADATION: If auth timed out on a public-ish path, allow through
    // This prevents login redirects when Supabase is slow but user may have a valid session
    if (!isPublicPath && !isPublicApiPath && request.nextUrl.pathname !== '/') {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      // Add query param to indicate this was due to auth timeout so login page can show appropriate message
      if (authTimedOut) {
        url.searchParams.set('reason', 'auth_timeout')
      }
      return {
        response: NextResponse.redirect(url),
        user: null
      }
    }
  }

  return {
    response: supabaseResponse,
    user
  }
}
