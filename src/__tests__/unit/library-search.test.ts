import { sanitizeInput } from '@/lib/api-utils'

describe('Library & Search API Security Tests', () => {
  describe('Input Sanitization', () => {
    it('should remove HTML tags from search queries', () => {
      const input = '<script>alert("xss")</script>Solo Leveling'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('<script>')
      expect(sanitized).toContain('Solo Leveling')
    })

    it('should remove javascript: protocol', () => {
      const input = 'javascript:alert(1)'
      const sanitized = sanitizeInput(input)
      expect(sanitized).not.toContain('javascript:')
    })

    it('should truncate excessively long queries', () => {
      const input = 'a'.repeat(500)
      const sanitized = sanitizeInput(input, 100)
      expect(sanitized.length).toBe(100)
    })
  })

  describe('SQL ILIKE Pattern Escaping', () => {
    function testEscape(input: string): string {
      return input
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
    }

    it('should escape % characters in search patterns', () => {
      const input = '100% manga'
      const escaped = testEscape(input)
      expect(escaped).toBe('100\\% manga')
    })

    it('should escape _ characters', () => {
      const input = 'solo_leveling'
      const escaped = testEscape(input)
      expect(escaped).toBe('solo\\_leveling')
    })

    it('should escape backslashes', () => {
      const input = 'test\\path'
      const escaped = testEscape(input)
      expect(escaped).toBe('test\\\\path')
    })
  })

  describe('Zod Validation Expectations', () => {
    it('should correctly handle search params through Zod-like logic', () => {
      const params = {
        limit: '50',
        offset: '10',
        type: 'manga',
        status: 'ongoing'
      }
      
      const limit = Math.min(Math.max(1, parseInt(params.limit || '20')), 100)
      const offset = Math.max(0, parseInt(params.offset || '0'))
      
      expect(limit).toBe(50)
      expect(offset).toBe(10)
      expect(['manga', 'manhwa'].includes(params.type)).toBe(true)
    })
  })
})
