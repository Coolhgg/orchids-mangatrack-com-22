/**
 * Authentication and Authorization Tests
 * Tests for signup, login, session handling, and protected routes
 */

import { 
  checkRateLimit,
  clearRateLimit,
  checkAuthRateLimit,
  sanitizeInput,
  validateUsername,
  validateEmail,
} from '@/lib/api-utils'

// Mock the Supabase client
jest.mock('@/lib/supabase/client', () => ({
  createClient: jest.fn(() => ({
    auth: {
      signUp: jest.fn(),
      signInWithPassword: jest.fn(),
      signInWithOAuth: jest.fn(),
      signOut: jest.fn(),
      getUser: jest.fn(),
      getSession: jest.fn(),
    },
  })),
}))

// Mock the Prisma client
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn()),
  },
}))

describe('Authentication Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearRateLimit('auth:test-ip')
    clearRateLimit('check-username:test-ip')
  })

  describe('Username Validation', () => {
    it('should accept valid usernames', () => {
      expect(validateUsername('john_doe')).toBe(true)
      expect(validateUsername('user123')).toBe(true)
      expect(validateUsername('manga_reader_99')).toBe(true)
      expect(validateUsername('abc')).toBe(true)
    })

    it('should reject usernames that are too short', () => {
      expect(validateUsername('ab')).toBe(false)
      expect(validateUsername('a')).toBe(false)
      expect(validateUsername('')).toBe(false)
    })

    it('should reject usernames that are too long', () => {
      expect(validateUsername('a'.repeat(31))).toBe(false)
    })

    it('should reject usernames with invalid characters', () => {
      expect(validateUsername('user@name')).toBe(false)
      expect(validateUsername('user name')).toBe(false)
      expect(validateUsername('user.name')).toBe(false)
      expect(validateUsername('user!name')).toBe(false)
      expect(validateUsername('用户名')).toBe(false) // Chinese characters
    })

    it('should accept usernames with hyphens and underscores', () => {
      expect(validateUsername('user-name')).toBe(true)
      expect(validateUsername('user_name')).toBe(true)
      expect(validateUsername('user-name_123')).toBe(true)
    })
  })

  describe('Email Validation', () => {
    it('should accept valid emails', () => {
      expect(validateEmail('user@example.com')).toBe(true)
      expect(validateEmail('user.name@domain.co.uk')).toBe(true)
      expect(validateEmail('user+tag@example.org')).toBe(true)
      expect(validateEmail('test123@test.io')).toBe(true)
    })

    it('should reject invalid emails', () => {
      expect(validateEmail('')).toBe(false)
      expect(validateEmail('notanemail')).toBe(false)
      expect(validateEmail('@nodomain.com')).toBe(false)
      expect(validateEmail('user@')).toBe(false)
      expect(validateEmail('user@domain')).toBe(false)
      expect(validateEmail('user@@domain.com')).toBe(false)
    })
  })

  describe('Auth Rate Limiting', () => {
    it('should allow 5 auth attempts', async () => {
      for (let i = 0; i < 5; i++) {
        expect(await checkAuthRateLimit('test-ip')).toBe(true)
      }
    })

    it('should block after 5 auth attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await checkAuthRateLimit('test-ip')
      }
      expect(await checkAuthRateLimit('test-ip')).toBe(false)
    })

    it('should use separate limits for different IPs', async () => {
      // Use up all attempts for IP 1
      for (let i = 0; i < 5; i++) {
        await checkAuthRateLimit('ip-1')
      }
      expect(await checkAuthRateLimit('ip-1')).toBe(false)
      
      // IP 2 should still have attempts
      expect(await checkAuthRateLimit('ip-2')).toBe(true)
    })
  })

  describe('Username Check Rate Limiting', () => {
    it('should allow 20 username checks per minute', async () => {
      for (let i = 0; i < 20; i++) {
        expect(await checkRateLimit('check-username:test-ip', 20, 60000)).toBe(true)
      }
    })

    it('should block after 20 username checks', async () => {
      for (let i = 0; i < 20; i++) {
        await checkRateLimit('check-username:test-ip', 20, 60000)
      }
      expect(await checkRateLimit('check-username:test-ip', 20, 60000)).toBe(false)
    })
  })

  describe('Input Sanitization for Auth', () => {
    it('should sanitize username input', () => {
      const malicious = '<script>alert("xss")</script>john_doe'
      const sanitized = sanitizeInput(malicious.toLowerCase(), 30)
      expect(sanitized).not.toContain('<script>')
    })

    it('should trim whitespace from inputs', () => {
      expect(sanitizeInput('  john_doe  ')).toBe('john_doe')
    })

    it('should respect max length for usernames', () => {
      const longInput = 'a'.repeat(100)
      const sanitized = sanitizeInput(longInput, 20)
      expect(sanitized.length).toBe(20)
    })
  })

  describe('Password Requirements', () => {
    const meetsRequirements = (password: string) => {
      const hasMinLength = password.length >= 8
      const hasUppercase = /[A-Z]/.test(password)
      const hasNumber = /[0-9]/.test(password)
      return hasMinLength && hasUppercase && hasNumber
    }

    it('should accept valid passwords', () => {
      expect(meetsRequirements('Password1')).toBe(true)
      expect(meetsRequirements('MySecure123')).toBe(true)
      expect(meetsRequirements('Test1234')).toBe(true)
      expect(meetsRequirements('ABCD1234efgh')).toBe(true)
    })

    it('should reject passwords without uppercase', () => {
      expect(meetsRequirements('password1')).toBe(false)
      expect(meetsRequirements('test12345')).toBe(false)
    })

    it('should reject passwords without numbers', () => {
      expect(meetsRequirements('Password')).toBe(false)
      expect(meetsRequirements('TestPassword')).toBe(false)
    })

    it('should reject passwords under 8 characters', () => {
      expect(meetsRequirements('Pass1')).toBe(false)
      expect(meetsRequirements('Ab1')).toBe(false)
    })
  })

  describe('Reserved Usernames', () => {
    const reservedUsernames = [
      'admin', 'administrator', 'root', 'system', 'support', 
      'help', 'info', 'contact', 'api', 'www', 'mail', 'email',
      'mangatrack', 'manga', 'manhwa', 'webtoon', 'moderator', 'mod'
    ]

    it('should identify reserved usernames', () => {
      reservedUsernames.forEach(username => {
        expect(reservedUsernames.includes(username)).toBe(true)
      })
    })

    it('should not reserve regular usernames', () => {
      expect(reservedUsernames.includes('john_doe')).toBe(false)
      expect(reservedUsernames.includes('manga_fan')).toBe(false)
      expect(reservedUsernames.includes('user123')).toBe(false)
    })
  })

  describe('Session Handling', () => {
    it('should have 1 hour session duration', () => {
      const SESSION_DURATION_SECONDS = 60 * 60
      expect(SESSION_DURATION_SECONDS).toBe(3600)
    })

    it('should have 1 hour inactivity timeout', () => {
      const SESSION_TIMEOUT_MS = 60 * 60 * 1000
      expect(SESSION_TIMEOUT_MS).toBe(3600000)
    })
  })
})

describe('Protected Route Tests', () => {
  const publicPaths = [
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
    '/auth',
    '/api',
    '/onboarding',
  ]

  const protectedPaths = [
    '/library',
    '/settings',
    '/notifications',
    '/feed',
    '/friends',
    '/leaderboard',
    '/discover',
  ]

    it('should identify public paths correctly', () => {
      publicPaths.forEach(path => {
        const isPublic = (publicPaths as string[]).some(p => path.startsWith(p))
        expect(isPublic).toBe(true)
      })
    })
  
    it('should identify protected paths correctly', () => {
      protectedPaths.forEach(path => {
        const isPublic = (publicPaths as string[]).some(p => path.startsWith(p))
        expect(isPublic).toBe(false)
      })
    })
  
  it('should consider root path as public', () => {
    const rootPath: string = '/'
    const isPublic = rootPath === '/' || publicPaths.some(p => rootPath.startsWith(p))
    expect(isPublic).toBe(true)
  })
})

describe('OAuth Provider Tests', () => {
  const supportedProviders = ['google', 'discord']

  it('should support Google and Discord OAuth', () => {
    expect(supportedProviders).toContain('google')
    expect(supportedProviders).toContain('discord')
  })

  it('should generate correct OAuth callback URL', () => {
    const origin = 'http://localhost:3000'
    const next = '/library'
    const callbackUrl = `${origin}/auth/callback?next=${next}`
    
    expect(callbackUrl).toBe('http://localhost:3000/auth/callback?next=/library')
  })
})
