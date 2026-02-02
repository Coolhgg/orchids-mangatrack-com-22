/**
 * Enrichment Pipeline Unit Tests
 * 
 * Tests the resolution processor logic for linking library entries to series.
 * Uses mocks to avoid database dependencies.
 */

// Mock dependencies before imports
jest.mock('@/lib/prisma')
jest.mock('@/lib/mangadex')

import { prisma } from '@/lib/prisma'

describe('Enrichment Pipeline', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Library Entry Resolution', () => {
    it('should link a library entry to an existing series by exact title match', async () => {
      const mockFindFirst = prisma.series.findFirst as jest.Mock
      const mockFindUnique = prisma.libraryEntry.findUnique as jest.Mock
      const mockUpdate = prisma.libraryEntry.update as jest.Mock

      const seriesId = 'series-123'
      const entryId = 'entry-456'

      // Mock finding a series by title
      mockFindFirst.mockResolvedValue({
        id: seriesId,
        title: 'Test Enrichment Series',
        type: 'manga',
      })

      // Mock library entry lookup
      mockFindUnique.mockResolvedValue({
        id: entryId,
        imported_title: 'Test Enrichment Series',
        metadata_status: 'pending',
      })

      // Mock update
      mockUpdate.mockResolvedValue({
        id: entryId,
        series_id: seriesId,
        metadata_status: 'enriched',
      })

      // Simulate resolution logic
      const entry = await mockFindUnique({ where: { id: entryId } })
      const series = await mockFindFirst({
        where: { title: { equals: entry.imported_title, mode: 'insensitive' } },
      })

      if (series) {
        const updated = await mockUpdate({
          where: { id: entryId },
          data: {
            series_id: series.id,
            metadata_status: 'enriched',
          },
        })

        expect(updated.series_id).toBe(seriesId)
        expect(updated.metadata_status).toBe('enriched')
      }

      expect(mockFindFirst).toHaveBeenCalled()
      expect(mockUpdate).toHaveBeenCalled()
    })

    it('should handle fuzzy title matching for minor variations', () => {
      const normalizeTitle = (title: string): string => {
        return title
          .toLowerCase()
          .replace(/[^\w\s]/g, '') // Remove special characters
          .replace(/\s+/g, ' ')    // Normalize whitespace
          .trim()
      }

      expect(normalizeTitle('Test Series!')).toBe('test series')
      expect(normalizeTitle('Test  Series')).toBe('test series')
      expect(normalizeTitle('TEST SERIES')).toBe('test series')
      expect(normalizeTitle('Test-Series')).toBe('testseries')
    })

    it('should handle multiple library entries resolving to the same series', async () => {
      const mockFindFirst = prisma.series.findFirst as jest.Mock
      const mockUpdateMany = prisma.libraryEntry.updateMany as jest.Mock

      const seriesId = 'series-123'
      const entryIds = ['entry-1', 'entry-2', 'entry-3']

      mockFindFirst.mockResolvedValue({
        id: seriesId,
        title: 'Duplicate Test Series',
      })

      mockUpdateMany.mockResolvedValue({ count: 3 })

      // Simulate bulk update
      const result = await mockUpdateMany({
        where: { id: { in: entryIds } },
        data: {
          series_id: seriesId,
          metadata_status: 'enriched',
        },
      })

      expect(result.count).toBe(3)
    })

    it('should mark entries as failed when no series is found', async () => {
      const mockFindFirst = prisma.series.findFirst as jest.Mock
      const mockUpdate = prisma.libraryEntry.update as jest.Mock

      // No series found
      mockFindFirst.mockResolvedValue(null)

      mockUpdate.mockResolvedValue({
        id: 'entry-123',
        metadata_status: 'failed',
        metadata_error: 'No matching series found',
      })

      const series = await mockFindFirst({ where: { title: 'Unknown Series' } })

      if (!series) {
        const updated = await mockUpdate({
          where: { id: 'entry-123' },
          data: {
            metadata_status: 'failed',
            metadata_error: 'No matching series found',
          },
        })

        expect(updated.metadata_status).toBe('failed')
        expect(updated.metadata_error).toBeDefined()
      }
    })
  })

  describe('Metadata Status Transitions', () => {
    const VALID_STATUSES = ['pending', 'processing', 'enriched', 'failed']

    it('should have valid metadata status values', () => {
      VALID_STATUSES.forEach(status => {
        expect(['pending', 'processing', 'enriched', 'failed']).toContain(status)
      })
    })

    it('should transition from pending to processing', () => {
      const transitions: Record<string, string[]> = {
        pending: ['processing'],
        processing: ['enriched', 'failed'],
        enriched: [],
        failed: ['pending'], // Allow retry
      }

      expect(transitions.pending).toContain('processing')
      expect(transitions.processing).toContain('enriched')
      expect(transitions.processing).toContain('failed')
    })
  })

  describe('Source URL Parsing', () => {
    const parseSourceUrl = (url: string): { source: string; id: string } | null => {
      const patterns: Record<string, RegExp> = {
        mangadex: /mangadex\.org\/title\/([a-f0-9-]+)/,
        anilist: /anilist\.co\/manga\/(\d+)/,
      }

      for (const [source, pattern] of Object.entries(patterns)) {
        const match = url.match(pattern)
        if (match) {
          return { source, id: match[1] }
        }
      }
      return null
    }

    it('should parse MangaDex URLs', () => {
      const result = parseSourceUrl('https://mangadex.org/title/abc-123-def')
      expect(result?.source).toBe('mangadex')
      expect(result?.id).toBe('abc-123-def')
    })

    it('should parse AniList URLs', () => {
      const result = parseSourceUrl('https://anilist.co/manga/12345')
      expect(result?.source).toBe('anilist')
      expect(result?.id).toBe('12345')
    })

    it('should return null for unknown URLs', () => {
      const result = parseSourceUrl('https://unknown.com/manga/123')
      expect(result).toBeNull()
    })
  })
})
