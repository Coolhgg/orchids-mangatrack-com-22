import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/middleware'
import { REQUEST_ID_HEADER } from '@/lib/request-id'

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing Supabase environment variables in middleware. ' +
    'Please ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.'
  )
}

const MAX_REQUEST_BODY_SIZE = 1024 * 1024;

// P0-3 FIX: Use LRU-style map with bounded size to prevent memory leaks
class BoundedRateLimitStore {
  private store = new Map<string, { count: number; resetTime: number }>();
  private readonly maxEntries: number;
  private lastCleanup = Date.now();
  private readonly cleanupInterval = 60000; // 1 minute

  constructor(maxEntries: number = 10000) {
    this.maxEntries = maxEntries;
  }

  private cleanup() {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) return;
    
    this.lastCleanup = now;
    
    // Remove expired entries
    for (const [key, value] of this.store) {
      if (now > value.resetTime) {
        this.store.delete(key);
      }
    }
    
    // If still over limit, remove oldest entries (LRU eviction)
    if (this.store.size > this.maxEntries) {
      const entries = Array.from(this.store.entries());
      // Sort by resetTime (oldest first)
      entries.sort((a, b) => a[1].resetTime - b[1].resetTime);
      const toDelete = entries.slice(0, entries.length - this.maxEntries);
      for (const [key] of toDelete) {
        this.store.delete(key);
      }
    }
  }

  get(key: string) {
    return this.store.get(key);
  }

  set(key: string, value: { count: number; resetTime: number }) {
    // Proactive cleanup before adding
    if (this.store.size >= this.maxEntries) {
      this.cleanup();
    }
    
    // If still at capacity after cleanup, evict oldest entry
    if (this.store.size >= this.maxEntries) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [k, v] of this.store) {
        if (v.resetTime < oldestTime) {
          oldestTime = v.resetTime;
          oldestKey = k;
        }
      }
      if (oldestKey) {
        this.store.delete(oldestKey);
      }
    }
    
    this.store.set(key, value);
  }

  triggerCleanup() {
    this.cleanup();
  }
}

const rateLimitStore = new BoundedRateLimitStore(10000);

/**
 * Atomic rate limit check using compare-and-swap pattern.
 * Prevents race conditions where concurrent requests could both pass
 * before the count is properly incremented.
 */
function checkRateLimit(key: string, limit: number, windowMs: number) {
  rateLimitStore.triggerCleanup();
  
  const now = Date.now();
  const existing = rateLimitStore.get(key);

  // If no record or expired, atomically create new record with count=1
  if (!existing || now > existing.resetTime) {
    const newRecord = { count: 1, resetTime: now + windowMs };
    rateLimitStore.set(key, newRecord);
    return { allowed: true, remaining: limit - 1, reset: newRecord.resetTime, limit };
  }

  // Atomically increment: create new object with incremented count
  // This ensures we don't have a race between read and write
  const newCount = existing.count + 1;
  const updatedRecord = { count: newCount, resetTime: existing.resetTime };
  rateLimitStore.set(key, updatedRecord);
  
  return {
    allowed: newCount <= limit,
    remaining: Math.max(0, limit - newCount),
    reset: existing.resetTime,
    limit
  };
}

function generateRequestId(): string {
  return (Math.random().toString(36).substring(2, 10) + Date.now().toString(36)).toUpperCase();
}

function setSecurityHeaders(response: NextResponse, requestId: string) {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('X-Permitted-Cross-Domain-Policies', 'none')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()'
  )
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.supabase.co; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.supabase.co https://*.unsplash.com https://*.mangadex.org https://*.mangapark.net https://*.mangasee123.com https://*.manga4life.com https://uploads.mangadex.org; font-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.mangadex.org https://*.orchids.cloud https://orchids.cloud https://*.vercel.app; worker-src 'self' blob:; frame-src 'none'; frame-ancestors 'none'; upgrade-insecure-requests;"
  )

  if (process.env.NODE_ENV === 'production') {
    response.headers.set(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    )
  }
}

function setCorsHeaders(response: NextResponse, request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    process.env.NEXT_PUBLIC_SITE_URL,
    'https://orchids.cloud',
    'https://*.orchids.cloud',
  ].filter(Boolean);
  
  // Allow same-origin requests or requests from allowed origins
  if (origin) {
    const isAllowed = allowedOrigins.some(allowed => {
      if (allowed?.includes('*')) {
        const pattern = new RegExp('^' + allowed.replace(/\*/g, '.*') + '$');
        return pattern.test(origin);
      }
      return allowed === origin;
    });
    
    if (isAllowed) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Credentials', 'true');
    }
  }
  
  response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, X-Request-ID');
  response.headers.set('Access-Control-Max-Age', '86400');
}

export async function middleware(request: NextRequest) {
  const requestId = request.headers.get(REQUEST_ID_HEADER) || generateRequestId();
  const pathname = request.nextUrl.pathname;

  // Handle CORS preflight requests for API routes
  if (pathname.startsWith('/api') && request.method === 'OPTIONS') {
    const preflightResponse = new NextResponse(null, { status: 204 });
    setCorsHeaders(preflightResponse, request);
    setSecurityHeaders(preflightResponse, requestId);
    return preflightResponse;
  }

  // P0-2 FIX: Get user from updateSession to avoid double auth call
  const { response, user } = await updateSession(request)
  
  // If updateSession returned an early response (redirect or 401), add security headers and return it
  if (response.status !== 200 || response.headers.get('location')) {
    setSecurityHeaders(response, requestId);
    return response;
  }

  if (pathname.startsWith('/api')) {
    // Apply CORS headers to all API responses
    setCorsHeaders(response, request);
    
    const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
    if (contentLength > MAX_REQUEST_BODY_SIZE) {
      const errorResponse = new NextResponse(
        JSON.stringify({
          error: 'Request body too large',
          code: 'PAYLOAD_TOO_LARGE',
          maxSize: MAX_REQUEST_BODY_SIZE,
          requestId
        }),
        {
          status: 413,
          headers: {
            'Content-Type': 'application/json',
            [REQUEST_ID_HEADER]: requestId
          }
        }
      );
      return errorResponse;
    }

    const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(',')[0] || "127.0.0.1";
    
    // P0-2 FIX: Use user from updateSession instead of making another auth call
    let tier = 'public';
    let limit = 30;
    const windowMs = 60000;

    if (pathname.startsWith('/api/auth')) {
      tier = 'auth';
      limit = 10;
    } else if (user) {
      tier = 'authenticated';
      limit = 120;
    }

    const rl = checkRateLimit(`${tier}:${ip}`, limit, windowMs);

    response.headers.set('X-RateLimit-Limit', rl.limit.toString());
    response.headers.set('X-RateLimit-Remaining', rl.remaining.toString());
    response.headers.set('X-RateLimit-Reset', rl.reset.toString());

    if (!rl.allowed) {
      const retryAfter = Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000));
      return new NextResponse(
        JSON.stringify({ 
          error: 'Too many requests. Please wait a moment.',
          code: 'RATE_LIMITED',
          retryAfter,
          requestId
        }),
        { 
          status: 429, 
          headers: { 
            'Content-Type': 'application/json',
            'X-RateLimit-Limit': rl.limit.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': rl.reset.toString(),
            'Retry-After': retryAfter.toString(),
            [REQUEST_ID_HEADER]: requestId
          } 
        }
      );
    }
  }

  setSecurityHeaders(response, requestId);
  return response
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * Feel free to modify this pattern to include more paths.
     */
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
