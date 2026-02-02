/**
 * Authentication API Integration Tests
 * Tests auth flows, security measures, and edge cases
 */

import { NextRequest } from 'next/server'

// Mock environment - use Object.defineProperty to avoid readonly error
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  })),
}))

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
    },
  },
  withRetry: jest.fn((fn) => fn()),
  isTransientError: jest.fn(() => false),
}))

import { GET as checkUsername } from '@/app/api/auth/check-username/route'
import { prisma } from '@/lib/prisma'
import { clearRateLimit } from '@/lib/api-utils'

describe('Auth API - Username Check', () => {
  beforeEach(async () => {
    jest.clearAllMocks()
    // Clear rate limits between tests
    await clearRateLimit('check-username:unknown')
  })

  it('should return 400 if username is missing', async () => {
    const request = new NextRequest('http://localhost/api/auth/check-username')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toBe('Username is required')
  })

  it('should return 400 if username is too short', async () => {
    const request = new NextRequest('http://localhost/api/auth/check-username?username=ab')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('at least 3 characters')
  })

  it('should return 400 if username is too long', async () => {
    const longUsername = 'a'.repeat(25)
    const request = new NextRequest(`http://localhost/api/auth/check-username?username=${longUsername}`)
    const response = await checkUsername(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('20 characters')
  })

  it('should return 400 if username has invalid characters', async () => {
    const request = new NextRequest('http://localhost/api/auth/check-username?username=test@user!')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(400)
    const data = await response.json()
    expect(data.error).toContain('letters, numbers, underscores')
  })

  it('should return 409 for reserved usernames', async () => {
    const request = new NextRequest('http://localhost/api/auth/check-username?username=admin')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toContain('reserved')
  })

  it('should return 409 if username already exists', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce({ id: 'existing-id' })
    
    const request = new NextRequest('http://localhost/api/auth/check-username?username=existinguser')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(409)
    const data = await response.json()
    expect(data.error).toContain('already taken')
  })

  it('should return 200 if username is available', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null)
    
    const request = new NextRequest('http://localhost/api/auth/check-username?username=newuser')
    const response = await checkUsername(request)
    
    expect(response.status).toBe(200)
    const data = await response.json()
    expect(data.available).toBe(true)
  })

  it('should handle SQL injection attempts in username', async () => {
    (prisma.user.findFirst as jest.Mock).mockResolvedValueOnce(null)
    
    const maliciousUsername = "test'; DROP TABLE users;--"
    const request = new NextRequest(`http://localhost/api/auth/check-username?username=${encodeURIComponent(maliciousUsername)}`)
    const response = await checkUsername(request)
    
    // Should return 400 due to invalid characters, not execute SQL
    expect(response.status).toBe(400)
  })

  it('should be case-insensitive for username checks', async () => {
    (prisma.user.findFirst as jest.Mock).mockImplementation(({ where }: { where: { username: { mode: string } } }) => {
      // Verify case-insensitive mode is used
      expect(where.username.mode).toBe('insensitive')
      return Promise.resolve(null)
    })
    
    const request = new NextRequest('http://localhost/api/auth/check-username?username=TestUser')
    await checkUsername(request)
    
    expect(prisma.user.findFirst).toHaveBeenCalled()
  })
})

describe('Auth Security', () => {
  it('should enforce rate limiting', async () => {
    // Make 31 requests (limit is 30 per minute)
    for (let i = 0; i < 31; i++) {
      const request = new NextRequest(`http://localhost/api/auth/check-username?username=testuser${i}`)
      const response = await checkUsername(request)
      
      if (i === 30) {
        expect(response.status).toBe(429)
        const data = await response.json()
        expect(data.error).toContain('Too many requests')
      }
    }
  })
})
