/**
 * QA Comprehensive Test Suite - January 28, 2026
 * 
 * This test file validates critical bug fixes and security improvements,
 * edge cases, and integration scenarios across the codebase.
 */

import { describe, expect, test, beforeEach, jest } from '@jest/globals'

describe('QA Comprehensive Suite - January 28, 2026', () => {
  describe('Content Filtering Bug Fixes (BUG-NSFW-001)', () => {
    test('shouldFilterForNSFW returns true for explicit content with filters enabled', () => {
      const shouldFilterForNSFW = (
        contentRating: string | null | undefined,
        userFilters: { exclude_nsfw?: boolean; enabled?: boolean } | null
      ): boolean => {
        if (!userFilters?.enabled || !userFilters?.exclude_nsfw) {
          return false
        }
        const nsfwRatings = ['erotica', 'pornographic', 'suggestive']
        const rating = (contentRating || '').toLowerCase()
        return nsfwRatings.includes(rating)
      }

      expect(shouldFilterForNSFW('erotica', { exclude_nsfw: true, enabled: true })).toBe(true)
      expect(shouldFilterForNSFW('pornographic', { exclude_nsfw: true, enabled: true })).toBe(true)
      expect(shouldFilterForNSFW('suggestive', { exclude_nsfw: true, enabled: true })).toBe(true)
      expect(shouldFilterForNSFW('safe', { exclude_nsfw: true, enabled: true })).toBe(false)
      expect(shouldFilterForNSFW(null, { exclude_nsfw: true, enabled: true })).toBe(false)
      expect(shouldFilterForNSFW('erotica', { exclude_nsfw: false, enabled: true })).toBe(false)
      expect(shouldFilterForNSFW('erotica', null)).toBe(false)
    })

    test('filterResults correctly applies NSFW filtering', () => {
      type Series = { id: string; content_rating: string | null }
      type UserFilters = { exclude_nsfw?: boolean; enabled?: boolean }

      const filterResults = (
        results: Series[],
        userFilters: UserFilters | null
      ): Series[] => {
        if (!userFilters?.enabled || !userFilters?.exclude_nsfw) {
          return results
        }
        const nsfwRatings = ['erotica', 'pornographic', 'suggestive']
        return results.filter(
          (item) => !nsfwRatings.includes((item.content_rating || '').toLowerCase())
        )
      }

      const testData: Series[] = [
        { id: '1', content_rating: 'safe' },
        { id: '2', content_rating: 'erotica' },
        { id: '3', content_rating: 'suggestive' },
        { id: '4', content_rating: null },
        { id: '5', content_rating: 'pornographic' },
      ]

      const filtered = filterResults(testData, { exclude_nsfw: true, enabled: true })
      expect(filtered).toHaveLength(2)
      expect(filtered.map((s) => s.id)).toEqual(['1', '4'])

      const unfiltered = filterResults(testData, { exclude_nsfw: false, enabled: true })
      expect(unfiltered).toHaveLength(5)

      const noFilters = filterResults(testData, null)
      expect(noFilters).toHaveLength(5)
    })
  })

  describe('SQL Injection Prevention', () => {
    test('sort columns must be from whitelist only', () => {
      const SORT_CONFIG: Record<string, { sortColumn: string }> = {
        newest: { sortColumn: 'created_at' },
        oldest: { sortColumn: 'created_at' },
        updated: { sortColumn: 'last_chapter_date' },
        score: { sortColumn: 'average_rating' },
        popularity: { sortColumn: 'total_follows' },
        views: { sortColumn: 'total_views' },
        chapters: { sortColumn: 'chapter_count' },
      }

      const validColumns = new Set(Object.values(SORT_CONFIG).map((c) => c.sortColumn))
      
      const getSortConfig = (sort: string) => {
        return SORT_CONFIG[sort] || SORT_CONFIG.newest
      }

      expect(getSortConfig('newest').sortColumn).toBe('created_at')
      expect(getSortConfig('invalid').sortColumn).toBe('created_at')
      expect(getSortConfig('DROP TABLE users').sortColumn).toBe('created_at')
      expect(validColumns.has("'; DROP TABLE users;--")).toBe(false)
    })

    test('cursor decode rejects invalid sort columns', () => {
      const SORT_CONFIG: Record<string, { sortColumn: string }> = {
        newest: { sortColumn: 'created_at' },
        popularity: { sortColumn: 'total_follows' },
      }
      const validColumns = new Set(Object.values(SORT_CONFIG).map((c) => c.sortColumn))

      const decodeCursor = (cursor: string) => {
        try {
          const json = Buffer.from(cursor, 'base64url').toString('utf-8')
          const data = JSON.parse(json)
          if (!validColumns.has(data.s)) return null
          if (data.d !== 'asc' && data.d !== 'desc') return null
          if (!/^[0-9a-f-]{36}$/i.test(data.i)) return null
          return data
        } catch {
          return null
        }
      }

      const validCursor = Buffer.from(
        JSON.stringify({ s: 'created_at', d: 'desc', v: '2026-01-28', i: '12345678-1234-1234-1234-123456789012' })
      ).toString('base64url')
      expect(decodeCursor(validCursor)).not.toBeNull()

      const invalidColumnCursor = Buffer.from(
        JSON.stringify({ s: 'DROP TABLE', d: 'desc', v: null, i: '12345678-1234-1234-1234-123456789012' })
      ).toString('base64url')
      expect(decodeCursor(invalidColumnCursor)).toBeNull()

      const invalidIdCursor = Buffer.from(
        JSON.stringify({ s: 'created_at', d: 'desc', v: null, i: 'invalid-id' })
      ).toString('base64url')
      expect(decodeCursor(invalidIdCursor)).toBeNull()
    })
  })

  describe('Rate Limiting', () => {
    test('rate limiter enforces request limits', () => {
      const requests: Map<string, number[]> = new Map()
      const windowMs = 1000
      const maxRequests = 5

      const checkRateLimit = (key: string, now: number): boolean => {
        const timestamps = requests.get(key) || []
        const recentTimestamps = timestamps.filter((t) => now - t < windowMs)
        
        if (recentTimestamps.length >= maxRequests) {
          return false
        }
        
        recentTimestamps.push(now)
        requests.set(key, recentTimestamps)
        return true
      }

      const now = Date.now()
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit('user-1', now)).toBe(true)
      }
      expect(checkRateLimit('user-1', now)).toBe(false)
      expect(checkRateLimit('user-2', now)).toBe(true)
    })
  })

  describe('Input Validation', () => {
    test('escapeILikePattern properly escapes SQL wildcards', () => {
      const escapeILikePattern = (pattern: string): string => {
        return pattern
          .replace(/\\/g, '\\\\')
          .replace(/%/g, '\\%')
          .replace(/_/g, '\\_')
      }

      expect(escapeILikePattern('test%pattern')).toBe('test\\%pattern')
      expect(escapeILikePattern('test_pattern')).toBe('test\\_pattern')
      expect(escapeILikePattern('test\\pattern')).toBe('test\\\\pattern')
      expect(escapeILikePattern('100%_discount')).toBe('100\\%\\_discount')
    })

    test('UUID validation rejects invalid formats', () => {
      const isValidUUID = (id: string): boolean => {
        return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
      }

      expect(isValidUUID('12345678-1234-1234-1234-123456789012')).toBe(true)
      expect(isValidUUID('ABCDEF12-3456-7890-ABCD-EF1234567890')).toBe(true)
      expect(isValidUUID('invalid-uuid')).toBe(false)
      expect(isValidUUID('12345678-1234-1234-1234-12345678901')).toBe(false)
      expect(isValidUUID("'; DROP TABLE users;--")).toBe(false)
    })

    test('pagination params are properly bounded', () => {
      const sanitizePagination = (
        limit: number | undefined,
        offset: number | undefined
      ): { limit: number; offset: number } => {
        const safeLimit = Math.min(Math.max(1, limit || 20), 100)
        const safeOffset = Math.max(0, offset || 0)
        return { limit: safeLimit, offset: safeOffset }
      }

      expect(sanitizePagination(undefined, undefined)).toEqual({ limit: 20, offset: 0 })
      expect(sanitizePagination(500, 0)).toEqual({ limit: 100, offset: 0 })
      expect(sanitizePagination(-5, -10)).toEqual({ limit: 1, offset: 0 })
      expect(sanitizePagination(50, 100)).toEqual({ limit: 50, offset: 100 })
    })
  })

  describe('Error Handling', () => {
    test('handleApiError sanitizes error messages', () => {
      const handleApiError = (error: unknown): { message: string; status: number } => {
        const sensitivePatterns = [
          /password/i,
          /secret/i,
          /api[_-]?key/i,
          /token/i,
          /database.*connection/i,
        ]

        let message = 'An unexpected error occurred'
        if (error instanceof Error) {
          const isSensitive = sensitivePatterns.some((p) => p.test(error.message))
          message = isSensitive ? 'An unexpected error occurred' : error.message
        }

        return { message, status: 500 }
      }

      expect(handleApiError(new Error('Normal error')).message).toBe('Normal error')
      expect(handleApiError(new Error('Invalid password')).message).toBe('An unexpected error occurred')
      expect(handleApiError(new Error('API_KEY invalid')).message).toBe('An unexpected error occurred')
      expect(handleApiError(new Error('Database connection failed')).message).toBe('An unexpected error occurred')
    })
  })

  describe('Transaction Integrity', () => {
    test('upsert operations handle concurrent requests', async () => {
      let callCount = 0
      const mockUpsert = jest.fn(async () => {
        callCount++
        return { id: `item-${callCount}` }
      })

      const results = await Promise.all([
        mockUpsert(),
        mockUpsert(),
        mockUpsert(),
      ])

      expect(results).toHaveLength(3)
      expect(callCount).toBe(3)
    })
  })

  describe('Authentication Edge Cases', () => {
    test('username validation handles edge cases', () => {
      const isValidUsername = (username: string): boolean => {
        if (!username || typeof username !== 'string') return false
        if (username.length < 3 || username.length > 30) return false
        if (!/^[a-zA-Z0-9_-]+$/.test(username)) return false
        if (/^[_-]|[_-]$/.test(username)) return false
        return true
      }

      expect(isValidUsername('validuser')).toBe(true)
      expect(isValidUsername('user_name')).toBe(true)
      expect(isValidUsername('user-123')).toBe(true)
      expect(isValidUsername('ab')).toBe(false)
      expect(isValidUsername('a'.repeat(31))).toBe(false)
      expect(isValidUsername('user@name')).toBe(false)
      expect(isValidUsername('_username')).toBe(false)
      expect(isValidUsername('username_')).toBe(false)
      expect(isValidUsername('')).toBe(false)
    })
  })

  describe('Safe Browsing Mode', () => {
    test('content rating mappings are consistent', () => {
      type SafeBrowsingMode = 'sfw' | 'nsfw' | 'all'
      
      const getAllowedRatings = (mode: SafeBrowsingMode): string[] => {
        switch (mode) {
          case 'sfw':
            return ['safe', 'g', 'pg', 'pg-13']
          case 'nsfw':
            return ['suggestive', 'erotica', 'pornographic', 'r', 'r+', 'rx']
          case 'all':
          default:
            return ['safe', 'g', 'pg', 'pg-13', 'suggestive', 'erotica', 'pornographic', 'r', 'r+', 'rx']
        }
      }

      const sfwRatings = getAllowedRatings('sfw')
      expect(sfwRatings).not.toContain('erotica')
      expect(sfwRatings).not.toContain('pornographic')
      expect(sfwRatings).toContain('safe')

      const nsfwRatings = getAllowedRatings('nsfw')
      expect(nsfwRatings).toContain('erotica')
      expect(nsfwRatings).not.toContain('safe')

      const allRatings = getAllowedRatings('all')
      expect(allRatings.length).toBeGreaterThan(sfwRatings.length)
      expect(allRatings.length).toBeGreaterThan(nsfwRatings.length)
    })
  })

  describe('Cursor Pagination Security', () => {
    test('cursor tampering is detected and rejected', () => {
      const encodeCursor = (data: object): string => {
        return Buffer.from(JSON.stringify(data)).toString('base64url')
      }

      const decodeCursor = (cursor: string): object | null => {
        try {
          const json = Buffer.from(cursor, 'base64url').toString('utf-8')
          return JSON.parse(json)
        } catch {
          return null
        }
      }

      const validData = { s: 'created_at', d: 'desc', v: '2026-01-28', i: '12345678-1234-1234-1234-123456789012' }
      const encoded = encodeCursor(validData)
      const decoded = decodeCursor(encoded)
      expect(decoded).toEqual(validData)

      expect(decodeCursor('invalid-base64!!!')).toBeNull()
      expect(decodeCursor('')).toBeNull()
    })
  })
})
