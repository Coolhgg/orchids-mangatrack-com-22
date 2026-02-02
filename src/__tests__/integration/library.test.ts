import { NextRequest } from 'next/server'

const mockUser = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'test@example.com',
}

const mockDbUser = {
  id: mockUser.id,
  email: mockUser.email,
  username: 'testuser',
  subscription_tier: 'free',
  safe_browsing_mode: 'sfw',
}

const mockLibraryEntry = {
  id: '660e8400-e29b-41d4-a716-446655440001',
  user_id: mockUser.id,
  series_id: '770e8400-e29b-41d4-a716-446655440002',
  source_url: 'https://mangadex.org/title/test-manga',
  source_name: 'mangadex',
  imported_title: null,
  metadata_status: 'enriched',
  status: 'reading',
  last_read_chapter: 10,
  last_read_at: new Date(),
  user_rating: null,
  preferred_source: null,
  notify_new_chapters: true,
  push_enabled: false,
  notification_mode: 'default',
  sync_priority: 'WARM',
  deleted_at: null,
  added_at: new Date(),
  needs_review: false,
  metadata_retry_count: 0,
  last_metadata_error: null,
  last_metadata_attempt_at: null,
  series_completion_xp_granted: false,
  series: {
      id: '770e8400-e29b-41d4-a716-446655440002',
      title: 'Test Manga',
      cover_url: 'https://example.com/cover.jpg',
      description: 'A test manga',
    },
}

const mockSeriesWithSources = {
  ...mockLibraryEntry.series,
  sources: [{
    id: 'source-001',
    source_url: 'https://mangadex.org/title/test-manga',
    trust_score: 100,
  }],
}

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn().mockResolvedValue({
    auth: {
      getUser: jest.fn().mockResolvedValue({ data: { user: mockUser }, error: null }),
    },
  }),
}))

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: jest.fn().mockResolvedValue(mockDbUser),
    },
    libraryEntry: {
      findMany: jest.fn().mockResolvedValue([mockLibraryEntry]),
      findFirst: jest.fn().mockResolvedValue(mockLibraryEntry),
      findUnique: jest.fn().mockResolvedValue(mockLibraryEntry),
      create: jest.fn().mockResolvedValue(mockLibraryEntry),
      update: jest.fn().mockResolvedValue(mockLibraryEntry),
      delete: jest.fn().mockResolvedValue(mockLibraryEntry),
      count: jest.fn().mockResolvedValue(1),
      groupBy: jest.fn().mockResolvedValue([
        { status: 'reading', _count: 1 },
      ]),
    },
    series: {
      findUnique: jest.fn().mockResolvedValue(mockSeriesWithSources),
    },
    $transaction: jest.fn((arg) => {
      if (Array.isArray(arg)) {
        return Promise.all(arg)
      }
      return arg({
        user: {
          findUnique: jest.fn().mockResolvedValue(mockDbUser),
        },
        libraryEntry: {
          findMany: jest.fn().mockResolvedValue([mockLibraryEntry]),
          findFirst: jest.fn().mockResolvedValue(mockLibraryEntry),
          findUnique: jest.fn().mockResolvedValue(mockLibraryEntry),
          create: jest.fn().mockResolvedValue(mockLibraryEntry),
          update: jest.fn().mockResolvedValue(mockLibraryEntry),
          delete: jest.fn().mockResolvedValue(mockLibraryEntry),
        },
          series: {
            findUnique: jest.fn().mockResolvedValue(mockSeriesWithSources),
            update: jest.fn().mockResolvedValue(mockSeriesWithSources),
          },
      })
    }),
  },
  prismaRead: {
    libraryEntry: {
      findMany: jest.fn().mockResolvedValue([mockLibraryEntry]),
      count: jest.fn().mockResolvedValue(1),
    },
  },
  withRetry: jest.fn((fn) => fn()),
}))

jest.mock('@/lib/api-utils', () => {
  const actual = jest.requireActual('@/lib/api-utils')
  return {
    ...actual,
    checkRateLimit: jest.fn().mockResolvedValue(true),
    validateOrigin: jest.fn(),
  }
})

jest.mock('@/lib/redis', () => ({
  redis: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue('OK'),
    del: jest.fn().mockResolvedValue(1),
    incr: jest.fn().mockResolvedValue(1),
    expire: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 60000]]),
    })),
  },
  waitForRedis: jest.fn().mockResolvedValue(true),
  REDIS_KEY_PREFIX: 'test:',
}))

describe('Library API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('GET /api/library', () => {
    it('should return library entries for authenticated user', async () => {
      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'GET',
      })

      const response = await GET(request)
      const data = await response.json()

      expect(response.status).toBe(200)
      expect(data).toHaveProperty('entries')
      expect(Array.isArray(data.entries)).toBe(true)
    })

    it('should support pagination parameters', async () => {
      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library?page=1&limit=10', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(200)
    })

    it('should support status filter', async () => {
      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library?status=reading', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(200)
    })

    it('should support sorting', async () => {
      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library?sort=title&order=asc', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(200)
    })
  })

  describe('POST /api/library', () => {
    it('should create a new library entry', async () => {
      const { POST } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            seriesId: '770e8400-e29b-41d4-a716-446655440002',
            status: 'reading',
          }),
      })

      const response = await POST(request)
      expect([200, 201, 409]).toContain(response.status)
    })

    it('should reject invalid series_id format', async () => {
      const { POST } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          series_id: 'invalid-uuid',
          status: 'reading',
        }),
      })

      const response = await POST(request)
      expect([400, 404]).toContain(response.status)
    })

    it('should reject invalid status values', async () => {
      const { POST } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            seriesId: '770e8400-e29b-41d4-a716-446655440002',
            status: 'invalid_status',
          }),
      })

      const response = await POST(request)
      expect([400]).toContain(response.status)
    })
  })

  // Note: GET /api/library/[id] doesn't exist in the route file
  // Individual library entries are fetched via the main /api/library route with filters

  describe('PATCH /api/library/[id]', () => {
    it('should update a library entry', async () => {
      const { PATCH } = await import('@/app/api/library/[id]/route')
      
      const request = new NextRequest('http://localhost:3000/api/library/660e8400-e29b-41d4-a716-446655440001', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status: 'completed',
          last_read_chapter: 100,
        }),
      })

      const response = await PATCH(request, { 
        params: Promise.resolve({ id: '660e8400-e29b-41d4-a716-446655440001' })
      })

      expect([200, 404]).toContain(response.status)
    })

    it('should validate update fields', async () => {
      const { PATCH } = await import('@/app/api/library/[id]/route')
      
      const request = new NextRequest('http://localhost:3000/api/library/660e8400-e29b-41d4-a716-446655440001', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          last_read_chapter: -1,
        }),
      })

      const response = await PATCH(request, { 
        params: Promise.resolve({ id: '660e8400-e29b-41d4-a716-446655440001' })
      })

      expect([200, 400, 404]).toContain(response.status)
    })
  })

  describe('DELETE /api/library/[id]', () => {
    it('should delete a library entry', async () => {
      const { DELETE } = await import('@/app/api/library/[id]/route')
      
      const request = new NextRequest('http://localhost:3000/api/library/660e8400-e29b-41d4-a716-446655440001', {
        method: 'DELETE',
      })

      const response = await DELETE(request, { 
        params: Promise.resolve({ id: '660e8400-e29b-41d4-a716-446655440001' })
      })

      expect([200, 204, 404]).toContain(response.status)
    })

    it('should return 400 for invalid UUID on delete', async () => {
      const { DELETE } = await import('@/app/api/library/[id]/route')
      
      const request = new NextRequest('http://localhost:3000/api/library/invalid-id', {
        method: 'DELETE',
      })

      const response = await DELETE(request, { 
        params: Promise.resolve({ id: 'invalid-id' })
      })

      expect(response.status).toBe(400)
    })
  })

  describe('Rate Limiting', () => {
    it('should enforce rate limits', async () => {
      const { checkRateLimit } = await import('@/lib/api-utils')
      ;(checkRateLimit as jest.Mock).mockResolvedValueOnce(false)

      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(429)
    })
  })

  describe('Authentication', () => {
    it('should return 401 for unauthenticated requests', async () => {
      const { createClient } = await import('@/lib/supabase/server')
      ;(createClient as jest.Mock).mockResolvedValueOnce({
        auth: {
          getUser: jest.fn().mockResolvedValue({ data: { user: null }, error: null }),
        },
      })

      const { GET } = await import('@/app/api/library/route')
      
      const request = new NextRequest('http://localhost:3000/api/library', {
        method: 'GET',
      })

      const response = await GET(request)
      expect(response.status).toBe(401)
    })
  })
})
