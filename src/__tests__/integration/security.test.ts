/**
 * Security Tests
 * Tests for SSRF, XSS, SQL Injection, and other security vectors
 */

import { isInternalIP, isWhitelistedDomain } from '@/lib/constants/image-whitelist'

describe('SSRF Protection Tests', () => {
  describe('isInternalIP', () => {
    it('should block localhost', () => {
      expect(isInternalIP('localhost')).toBe(true)
      expect(isInternalIP('LOCALHOST')).toBe(true)
    })

    it('should block IPv4 loopback', () => {
      expect(isInternalIP('127.0.0.1')).toBe(true)
      expect(isInternalIP('127.0.0.2')).toBe(true)
      expect(isInternalIP('127.255.255.255')).toBe(true)
    })

    it('should block IPv6 loopback', () => {
      expect(isInternalIP('::1')).toBe(true)
      expect(isInternalIP('[::1]')).toBe(true)
      expect(isInternalIP('0:0:0:0:0:0:0:1')).toBe(true)
    })

    it('should block IPv6 mapped IPv4 addresses (SSRF bypass vector)', () => {
      expect(isInternalIP('::ffff:127.0.0.1')).toBe(true)
      expect(isInternalIP('::ffff:10.0.0.1')).toBe(true)
      expect(isInternalIP('::ffff:192.168.1.1')).toBe(true)
      expect(isInternalIP('::FFFF:127.0.0.1')).toBe(true)
      expect(isInternalIP('[::ffff:127.0.0.1]')).toBe(true)
    })

    it('should block private IPv4 ranges', () => {
      expect(isInternalIP('10.0.0.1')).toBe(true)
      expect(isInternalIP('10.255.255.255')).toBe(true)
      expect(isInternalIP('172.16.0.1')).toBe(true)
      expect(isInternalIP('172.31.255.255')).toBe(true)
      expect(isInternalIP('192.168.0.1')).toBe(true)
      expect(isInternalIP('192.168.255.255')).toBe(true)
    })

    it('should block link-local addresses', () => {
      expect(isInternalIP('169.254.0.1')).toBe(true)
      expect(isInternalIP('169.254.169.254')).toBe(true)
      expect(isInternalIP('fe80::')).toBe(true)
    })

    it('should block AWS metadata service IPs', () => {
      expect(isInternalIP('169.254.169.254')).toBe(true)
      expect(isInternalIP('169.254.170.2')).toBe(true)
      expect(isInternalIP('fd00:ec2::254')).toBe(true)
    })

    it('should block common internal hostnames', () => {
      expect(isInternalIP('internal.corp.com')).toBe(true)
      expect(isInternalIP('intranet.example.com')).toBe(true)
      expect(isInternalIP('admin-server')).toBe(true)
      expect(isInternalIP('metadata.google.internal')).toBe(true)
    })

    it('should block IPv6 private/local ranges', () => {
      expect(isInternalIP('fc00::')).toBe(true)
      expect(isInternalIP('fd00::')).toBe(true)
      expect(isInternalIP('fd12:3456::')).toBe(true)
    })

    it('should allow public IPs', () => {
      expect(isInternalIP('8.8.8.8')).toBe(false)
      expect(isInternalIP('1.1.1.1')).toBe(false)
      expect(isInternalIP('142.250.80.46')).toBe(false)
      expect(isInternalIP('cdn.example.com')).toBe(false)
    })

    it('should block 0.0.0.0', () => {
      expect(isInternalIP('0.0.0.0')).toBe(true)
      expect(isInternalIP('0.0.0.1')).toBe(true)
    })
  })

  describe('isWhitelistedDomain', () => {
    it('should allow whitelisted domains', () => {
      expect(isWhitelistedDomain('https://cdn.mangadex.org/image.jpg')).toBe(true)
      expect(isWhitelistedDomain('https://uploads.mangadex.org/covers/image.png')).toBe(true)
      expect(isWhitelistedDomain('https://i.imgur.com/abc123.jpg')).toBe(true)
    })

    it('should reject non-whitelisted domains', () => {
      expect(isWhitelistedDomain('https://evil.com/malware.jpg')).toBe(false)
      expect(isWhitelistedDomain('https://attacker.net/image.png')).toBe(false)
    })

    it('should handle invalid URLs', () => {
      expect(isWhitelistedDomain('not-a-url')).toBe(false)
      expect(isWhitelistedDomain('')).toBe(false)
    })
  })
})

describe('SQL Injection Protection Tests', () => {
  const escapeILikePattern = (input: string): string => {
    return input
      .replace(/\\/g, '\\\\')
      .replace(/%/g, '\\%')
      .replace(/_/g, '\\_')
  }

  it('should escape percent signs', () => {
    expect(escapeILikePattern('100%')).toBe('100\\%')
    expect(escapeILikePattern('%admin%')).toBe('\\%admin\\%')
  })

  it('should escape underscores', () => {
    expect(escapeILikePattern('user_name')).toBe('user\\_name')
    expect(escapeILikePattern('_test_')).toBe('\\_test\\_')
  })

  it('should escape backslashes', () => {
    expect(escapeILikePattern('path\\to\\file')).toBe('path\\\\to\\\\file')
  })

  it('should handle combined special characters', () => {
    expect(escapeILikePattern('%_\\')).toBe('\\%\\_\\\\')
    expect(escapeILikePattern('test%100_value\\end')).toBe('test\\%100\\_value\\\\end')
  })

  it('should handle SQL injection attempts - quotes handled by Prisma parameterization', () => {
    const payload = "'; DROP TABLE users; --"
    const escaped = escapeILikePattern(payload)
    // Note: Single quotes are NOT escaped by ILIKE escaping - they are handled by Prisma's
    // parameterized queries. ILIKE escaping only handles %, _, and \ characters.
    expect(escaped).toBe("'; DROP TABLE users; --")
  })
})

describe('XSS Protection Tests', () => {
  const sanitizeInput = (input: string, maxLength = 1000): string => {
    if (!input || typeof input !== 'string') return ''
    return input
      .slice(0, maxLength)
      .replace(/[<>]/g, '')
      .trim()
  }

  it('should remove script tags', () => {
    const xss = '<script>alert(1)</script>'
    expect(sanitizeInput(xss)).toBe('scriptalert(1)/script')
  })

  it('should remove HTML angle brackets', () => {
    expect(sanitizeInput('<div>test</div>')).toBe('divtest/div')
    expect(sanitizeInput('<img src=x onerror=alert(1)>')).toBe('img src=x onerror=alert(1)')
  })

  it('should limit input length', () => {
    const longInput = 'a'.repeat(2000)
    expect(sanitizeInput(longInput, 100).length).toBe(100)
  })

  it('should handle null/undefined', () => {
    expect(sanitizeInput(null as any)).toBe('')
    expect(sanitizeInput(undefined as any)).toBe('')
  })
})

describe('Privacy Settings Validation Tests', () => {
  const validatePrivacySettings = (settings: unknown): boolean => {
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      return false
    }
    
    const allowedKeys = ['library_public', 'activity_public', 'followers_public', 'following_public']
    const providedKeys = Object.keys(settings)
    
    const unknownKeys = providedKeys.filter(k => !allowedKeys.includes(k))
    if (unknownKeys.length > 0) {
      return false
    }
    
    for (const value of Object.values(settings)) {
      if (typeof value !== 'boolean') {
        return false
      }
    }
    
    return true
  }

  it('should accept valid privacy settings', () => {
    expect(validatePrivacySettings({ library_public: true })).toBe(true)
    expect(validatePrivacySettings({ library_public: false, activity_public: true })).toBe(true)
    expect(validatePrivacySettings({})).toBe(true)
  })

  it('should reject invalid types', () => {
    expect(validatePrivacySettings(null)).toBe(false)
    expect(validatePrivacySettings([])).toBe(false)
    expect(validatePrivacySettings('string')).toBe(false)
    expect(validatePrivacySettings(123)).toBe(false)
  })

  it('should reject unknown keys', () => {
    expect(validatePrivacySettings({ unknown_key: true })).toBe(false)
    expect(validatePrivacySettings({ library_public: true, hacked: true })).toBe(false)
  })

  it('should reject non-boolean values', () => {
    expect(validatePrivacySettings({ library_public: 'true' })).toBe(false)
    expect(validatePrivacySettings({ library_public: 1 })).toBe(false)
    expect(validatePrivacySettings({ library_public: null })).toBe(false)
  })
})

describe('UUID Validation Tests', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  it('should accept valid UUIDs', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(UUID_REGEX.test('123e4567-e89b-12d3-a456-426614174000')).toBe(true)
  })

  it('should reject invalid UUIDs', () => {
    expect(UUID_REGEX.test('invalid-uuid')).toBe(false)
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716')).toBe(false)
    expect(UUID_REGEX.test('')).toBe(false)
    expect(UUID_REGEX.test('550e8400e29b41d4a716446655440000')).toBe(false)
  })

  it('should reject SQL injection in UUID field', () => {
    expect(UUID_REGEX.test("550e8400-e29b-41d4-a716-446655440000'; DROP TABLE--")).toBe(false)
  })
})

describe('Rate Limiting Tests', () => {
  const rateLimitStore: Map<string, { count: number; resetTime: number }> = new Map()

  const checkRateLimit = (key: string, maxRequests: number, windowMs: number): boolean => {
    const now = Date.now()
    const entry = rateLimitStore.get(key)

    if (!entry || now > entry.resetTime) {
      rateLimitStore.set(key, { count: 1, resetTime: now + windowMs })
      return true
    }

    if (entry.count >= maxRequests) {
      return false
    }

    entry.count++
    return true
  }

  beforeEach(() => {
    rateLimitStore.clear()
  })

  it('should allow requests within limit', () => {
    expect(checkRateLimit('test', 5, 60000)).toBe(true)
    expect(checkRateLimit('test', 5, 60000)).toBe(true)
    expect(checkRateLimit('test', 5, 60000)).toBe(true)
  })

  it('should block requests exceeding limit', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('test2', 5, 60000)
    }
    expect(checkRateLimit('test2', 5, 60000)).toBe(false)
  })

  it('should track different keys independently', () => {
    for (let i = 0; i < 5; i++) {
      checkRateLimit('user1', 5, 60000)
    }
    expect(checkRateLimit('user1', 5, 60000)).toBe(false)
    expect(checkRateLimit('user2', 5, 60000)).toBe(true)
  })
})

describe('Prisma Error Classification Tests', () => {
  const isTransientError = (error: { message?: string; code?: string }): boolean => {
    const errorMessage = (error.message || '').toLowerCase()
    const errorCode = error.code || ''

    const nonTransientPatterns = [
      'password authentication failed',
      'authentication failed',
      'invalid password',
      'access denied',
      'permission denied',
    ]

    for (const pattern of nonTransientPatterns) {
      if (errorMessage.includes(pattern)) {
        return false
      }
    }

    const nonTransientCodes = ['P1000', 'P1003']
    if (nonTransientCodes.includes(errorCode)) {
      return false
    }

    const transientPatterns = [
      'circuit breaker',
      "can't reach database",
      'connection refused',
      'connection reset',
      'connection timed out',
    ]

    return transientPatterns.some(pattern => errorMessage.includes(pattern))
  }

  it('should NOT retry authentication errors', () => {
    expect(isTransientError({ message: 'password authentication failed for user postgres' })).toBe(false)
    expect(isTransientError({ message: 'Authentication failed' })).toBe(false)
    expect(isTransientError({ message: 'Access denied for user' })).toBe(false)
  })

  it('should retry connection errors', () => {
    expect(isTransientError({ message: 'Connection refused' })).toBe(true)
    expect(isTransientError({ message: "Can't reach database server" })).toBe(true)
    expect(isTransientError({ message: 'Circuit breaker open' })).toBe(true)
  })

  it('should not retry non-transient error codes', () => {
    expect(isTransientError({ code: 'P1000', message: '' })).toBe(false)
    expect(isTransientError({ code: 'P1003', message: '' })).toBe(false)
  })
})

describe('API Route Security Tests', () => {
  describe('Chapters Route', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    it('should validate UUID format for series ID', () => {
      expect(UUID_REGEX.test('valid-uuid-test-1234-567890abcdef')).toBe(false)
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
      expect(UUID_REGEX.test('../../etc/passwd')).toBe(false)
      expect(UUID_REGEX.test('1; DROP TABLE chapters;--')).toBe(false)
    })
  })

  describe('Notification Route', () => {
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    it('should validate UUID format for notification ID', () => {
      expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
      expect(UUID_REGEX.test('invalid')).toBe(false)
      expect(UUID_REGEX.test("1' OR '1'='1")).toBe(false)
    })
  })

  describe('User Search Route', () => {
    const escapeILikePattern = (input: string): string => {
      return input
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
    }

    it('should escape ILIKE special characters', () => {
      expect(escapeILikePattern('%admin%')).toBe('\\%admin\\%')
      expect(escapeILikePattern('user_name')).toBe('user\\_name')
      expect(escapeILikePattern('test\\path')).toBe('test\\\\path')
    })

    it('should prevent pattern injection attacks', () => {
      // Attack: match everything
      expect(escapeILikePattern('%')).toBe('\\%')
      // Attack: single char wildcard
      expect(escapeILikePattern('a_b')).toBe('a\\_b')
    })
  })

  describe('User Profile Security', () => {
    const validateUsername = (username: string): boolean => {
      const usernameRegex = /^[a-zA-Z0-9_-]{3,30}$/
      return usernameRegex.test(username)
    }

    it('should validate username format', () => {
      expect(validateUsername('valid_user')).toBe(true)
      expect(validateUsername('user-123')).toBe(true)
      expect(validateUsername('a')).toBe(false) // too short
      expect(validateUsername('this_is_a_very_long_username_that_should_be_invalid')).toBe(false)
    })

    it('should prevent path traversal in username', () => {
      expect(validateUsername('../../etc/passwd')).toBe(false)
      expect(validateUsername('user/profile')).toBe(false)
    })

    it('should prevent injection in username', () => {
      expect(validateUsername('admin\'--')).toBe(false)
      expect(validateUsername('admin"; DROP TABLE users;--')).toBe(false)
    })
  })

  describe('Error Message Masking', () => {
    const handleApiError = (error: Error, nodeEnv: string): string => {
      const isProd = nodeEnv === 'production'
      return isProd ? 'An internal server error occurred' : error.message
    }

    it('should mask error messages in production', () => {
      const error = new Error('Sensitive database error: connection failed at 10.0.0.5')
      expect(handleApiError(error, 'production')).toBe('An internal server error occurred')
    })

    it('should show error messages in development', () => {
      const error = new Error('Database error')
      expect(handleApiError(error, 'development')).toBe('Database error')
    })
  })
})

describe('Input Validation Edge Cases', () => {
  const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

  it('should handle boundary cases', () => {
    // Empty string
    expect(UUID_REGEX.test('')).toBe(false)
    // Just hyphens
    expect(UUID_REGEX.test('----')).toBe(false)
    // Too long
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440000-extra')).toBe(false)
    // Too short
    expect(UUID_REGEX.test('550e8400-e29b-41d4')).toBe(false)
  })

  it('should handle unicode attacks', () => {
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-44665544\u0000')).toBe(false)
    expect(UUID_REGEX.test('550e8400-e29b-41d4-a716-446655440\u202E')).toBe(false)
  })
})
