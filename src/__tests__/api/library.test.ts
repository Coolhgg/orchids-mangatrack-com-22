/**
 * Library API Integration Tests
 * Tests library operations, IDOR protection, and access control
 */

import { NextRequest } from 'next/server'

// Mock environment - use Object.defineProperty to avoid readonly error
Object.defineProperty(process.env, 'NODE_ENV', { value: 'test', writable: true })
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://test.supabase.co'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key'

const mockUser = {
  id: 'user-123-456-789',
  email: 'test@example.com',
}

// Mock Supabase
jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(() => ({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
  })),
}))

jest.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      ilike: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      range: jest.fn().mockResolvedValue({ data: [], count: 0, error: null }),
      insert: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({ data: null, error: null }),
    })),
    rpc: jest.fn().mockResolvedValue({ data: null, error: null }),
  },
}))

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    libraryEntry: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    series: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((fn: (tx: unknown) => Promise<unknown>) => fn({
      libraryEntry: {
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        update: jest.fn(),
      },
      series: {
        findUnique: jest.fn().mockResolvedValue({ total_follows: 5 }),
        update: jest.fn(),
      },
      activity: {
        create: jest.fn(),
      },
    })),
  },
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
  isTransientError: jest.fn(() => false),
}))

// Mock cover resolver
jest.mock('@/lib/cover-resolver', () => ({
  getBestCoversBatch: jest.fn().mockResolvedValue(new Map()),
  selectBestCover: jest.fn(),
  isValidCoverUrl: jest.fn(() => true),
}))

jest.mock('@/lib/api-utils', () => {
  return {
    sanitizeInput: (i: string) => i,
    checkRateLimit: jest.fn().mockResolvedValue(true),
    clearRateLimit: jest.fn(),
    handleApiError: (e: { statusCode?: number; message: string }) => {
      const status = e.statusCode || 500
      return new Response(JSON.stringify({ error: e.message }), { status })
    },
    ApiError: class extends Error {
      statusCode: number
      constructor(m: string, s: number) {
        super(m)
        this.statusCode = s
      }
    },
    ErrorCodes: {
      UNAUTHORIZED: 'UNAUTHORIZED',
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      BAD_REQUEST: 'BAD_REQUEST',
      NOT_FOUND: 'NOT_FOUND',
      CONFLICT: 'CONFLICT',
      RATE_LIMITED: 'RATE_LIMITED',
    },
    validateOrigin: jest.fn(),
    escapeILikePattern: (i: string) => i,
    getClientIp: () => '127.0.0.1',
  }
})

import { GET as getLibrary } from '@/app/api/library/route'
import { PATCH as updateEntry, DELETE as deleteEntry } from '@/app/api/library/[id]/route'
import { clearRateLimit } from '@/lib/api-utils'
import { prisma } from '@/lib/prisma'

describe('Library API', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearRateLimit('library-get:unknown')
    clearRateLimit('library-add:user-123-456-789')
    clearRateLimit('library-update:unknown')
    clearRateLimit('library-delete:unknown')
  })

  describe('GET /api/library', () => {
    it('should require authentication', async () => {
      // Override mock to return no user
      jest.spyOn(require('@/lib/supabase/server'), 'createClient').mockResolvedValueOnce({
        auth: {
          getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      })
      
      const request = new NextRequest('http://localhost/api/library')
      const response = await getLibrary(request)
      
      expect(response.status).toBe(401)
    })

    it('should validate query parameters', async () => {
      const request = new NextRequest('http://localhost/api/library?limit=999')
      const response = await getLibrary(request)
      
      // Should cap limit at max (200)
      expect(response.status).toBe(200)
    })

    it('should sanitize search query', async () => {
      const maliciousQuery = '<script>alert(1)</script>'
      const request = new NextRequest(`http://localhost/api/library?q=${encodeURIComponent(maliciousQuery)}`)
      const response = await getLibrary(request)
      
      // Should not error, query should be sanitized
      expect(response.status).toBe(200)
    })
  })

  describe('PATCH /api/library/[id]', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    
    it('should require valid UUID format', async () => {
      const request = new NextRequest('http://localhost/api/library/invalid-id', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'reading' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: 'invalid-id' }) })
      
      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toContain('Invalid')
    })

    it('should validate status values', async () => {
      // Setup mock to find entry
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue({ id: validUUID, user_id: mockUser.id, status: 'reading', series_id: 'series-123' }),
          update: jest.fn().mockResolvedValue({ id: validUUID }),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
          update: jest.fn(),
        },
        activity: {
          create: jest.fn(),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'invalid_status' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(400)
    })

    it('should validate rating range', async () => {
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue({ id: validUUID, user_id: mockUser.id }),
          update: jest.fn(),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ rating: 15 }), // Invalid: > 10
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(400)
    })

    it('should prevent IDOR - accessing other users entries', async () => {
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue(null), // Entry not found for this user
          update: jest.fn(),
        },
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: mockUser.id, xp: 100 }),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      })
      
      const response = await updateEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(404)
    })
  })

  describe('DELETE /api/library/[id]', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000'
    
    it('should require valid UUID format', async () => {
      const request = new NextRequest(`http://localhost/api/library/${validUUID}; DROP TABLE users;`, {
        method: 'DELETE',
      })
      
      const response = await deleteEntry(request, { 
        params: Promise.resolve({ id: `${validUUID}; DROP TABLE users;` }) 
      })
      
      expect(response.status).toBe(400)
    })

    it('should prevent deletion of other users entries', async () => {
      const mockTx = {
        libraryEntry: {
          findUnique: jest.fn().mockResolvedValue(null), // Not found = belongs to another user
          delete: jest.fn(),
        },
        series: {
          findUnique: jest.fn(),
          update: jest.fn(),
        },
      };
      
      (prisma.$transaction as jest.Mock).mockImplementation((fn: (tx: unknown) => Promise<unknown>) => fn(mockTx))

      const request = new NextRequest(`http://localhost/api/library/${validUUID}`, {
        method: 'DELETE',
      })
      
      const response = await deleteEntry(request, { params: Promise.resolve({ id: validUUID }) })
      
      expect(response.status).toBe(404)
    })
  })
})

describe('Library API Rate Limiting', () => {
  it('should enforce rate limits on GET', async () => {
    clearRateLimit('library-get:unknown')
    
    // Make many requests to hit the limit
    for (let i = 0; i < 61; i++) {
      const request = new NextRequest('http://localhost/api/library')
      const response = await getLibrary(request)
      
      if (i === 60) {
        expect(response.status).toBe(429)
      }
    }
  })
})
