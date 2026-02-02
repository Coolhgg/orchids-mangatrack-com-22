import { antiAbuse } from '@/lib/anti-abuse'

describe('Anti-Abuse System', () => {
  const testUserId = '550e8400-e29b-41d4-a716-446655440000'
  const testEntryId = '660e8400-e29b-41d4-a716-446655440000'

  describe('detectProgressBotPatterns', () => {
    it('should allow normal progress', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        10,
        5
      )
      expect(result.isBot).toBe(false)
    })

    it('should allow massive chapter jumps (for imports/migrations)', async () => {
      // Large chapter jumps are intentionally allowed for:
      // - Bulk imports from other trackers
      // - Migration from other services
      // - Binge reading sessions
      // XP is already capped at 1 per request regardless of jump size
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        1000,
        1
      )
      expect(result.isBot).toBe(false)
    })

    it('should handle null chapter number gracefully', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        null,
        5
      )
      expect(result.isBot).toBe(false)
    })

    it('should handle undefined chapter number gracefully', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        undefined,
        5
      )
      expect(result.isBot).toBe(false)
    })

    it('should handle zero chapter number', async () => {
      const result = await antiAbuse.detectProgressBotPatterns(
        testUserId,
        testEntryId,
        0,
        5
      )
      expect(result.isBot).toBe(false)
    })
  })

  describe('checkProgressRateLimit', () => {
    it('should return rate limit status', async () => {
      const result = await antiAbuse.checkProgressRateLimit(testUserId)
      expect(typeof result.allowed).toBe('boolean')
      expect(typeof result.hardBlock).toBe('boolean')
    })
  })

  describe('checkStatusRateLimit', () => {
    it('should return rate limit status for status changes', async () => {
      const result = await antiAbuse.checkStatusRateLimit(testUserId)
      expect(typeof result.allowed).toBe('boolean')
      expect(typeof result.hardBlock).toBe('boolean')
    })
  })

  describe('canGrantXp', () => {
    it('should return XP grant permission', async () => {
      const result = await antiAbuse.canGrantXp(testUserId)
      expect(typeof result).toBe('boolean')
    })
  })

  describe('detectStatusBotPatterns', () => {
    it('should allow normal status changes', async () => {
      const uniqueEntryId = `status-test-${Date.now()}`
      const result = await antiAbuse.detectStatusBotPatterns(
        testUserId,
        uniqueEntryId,
        'reading'
      )
      expect(result.isBot).toBe(false)
    })

    it('should allow different status changes', async () => {
      const uniqueEntryId = `status-test-diff-${Date.now()}`
      await antiAbuse.detectStatusBotPatterns(testUserId, uniqueEntryId, 'reading')
      const result = await antiAbuse.detectStatusBotPatterns(
        testUserId,
        uniqueEntryId,
        'completed'
      )
      expect(result.isBot).toBe(false)
    })
  })
})
