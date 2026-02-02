import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getClientIp, handleApiError, ApiError, ErrorCodes, getRateLimitInfo, sanitizeInput, validateOrigin } from '@/lib/api-utils'
import { logSecurityEvent } from '@/lib/audit-logger'

const MAX_ATTEMPTS = 5
const LOCKOUT_WINDOW_MINUTES = 15
const LOCKOUT_CHECK_RATE_LIMIT = 20 // Max lockout checks per minute per email
const LOCKOUT_CHECK_WINDOW_MS = 60000

export async function POST(request: NextRequest) {
  try {
    validateOrigin(request)
    validateContentType(request)
    const body = await request.json()
    const { email, action, success } = body
    const ip = getClientIp(request)

    if (!email || !action) {
      throw new ApiError('Email and action are required', 400, ErrorCodes.BAD_REQUEST)
    }

    // Sanitize email for use in rate limit key
    const sanitizedEmail = sanitizeInput(email, 255).toLowerCase()

    if (action === 'check') {
      // M1 FIX: Rate limit lockout checks per email to prevent enumeration attacks
      const rateLimitKey = `lockout-check:${sanitizedEmail}`
      const rateLimitInfo = await getRateLimitInfo(rateLimitKey, LOCKOUT_CHECK_RATE_LIMIT, LOCKOUT_CHECK_WINDOW_MS)
      
      if (!rateLimitInfo.allowed) {
        const retryAfter = Math.ceil((rateLimitInfo.reset - Date.now()) / 1000)
        return NextResponse.json(
          { error: 'Too many lockout check requests', code: ErrorCodes.RATE_LIMITED },
          { 
            status: 429,
            headers: { 'Retry-After': retryAfter.toString() }
          }
        )
      }
      // Check if locked out by email or IP
      const recentFailures = await prisma.$queryRaw`
        SELECT COUNT(*)::int as count 
        FROM login_attempts 
        WHERE (email = ${email} OR ip_address = ${ip})
        AND success = false
        AND attempted_at > now() - interval '15 minutes'
      ` as { count: number }[]

      const count = recentFailures[0]?.count || 0
      
      if (count >= MAX_ATTEMPTS) {
        await logSecurityEvent('LOGIN_LOCKOUT', {
          status: 'failure',
          metadata: { email, ip, count },
          request
        })
        
        return NextResponse.json({ 
          locked: true, 
          message: `Too many failed attempts. Please try again in ${LOCKOUT_WINDOW_MINUTES} minutes.` 
        })
      }

      return NextResponse.json({ locked: false })
    }

    if (action === 'record') {
      // Security: Cleanup old attempts (older than 24 hours) to prevent table bloat
      // This ensures the table size stays manageable
      await prisma.$executeRaw`
        DELETE FROM login_attempts 
        WHERE attempted_at < now() - interval '24 hours'
      `.catch(err => console.error('[Lockout] Cleanup failed:', err))

      await prisma.$executeRaw`
        INSERT INTO login_attempts (email, ip_address, success)
        VALUES (${email}, ${ip}, ${success === true})
      `

      if (success === false) {
        await logSecurityEvent('AUTH_LOGIN', {
          status: 'failure',
          metadata: { email, ip, reason: 'Invalid credentials' },
          request
        })
      }

      return NextResponse.json({ success: true })
    }

    throw new ApiError('Invalid action', 400, ErrorCodes.BAD_REQUEST)
  } catch (error) {
    return handleApiError(error)
  }
}
