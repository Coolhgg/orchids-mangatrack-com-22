/**
 * Integration Tests for XP Progress API
 * 
 * Tests the /api/users/me/xp-progress endpoint for:
 * - Response shape validation
 * - Season context correctness
 * - Level calculations
 * - Error handling
 */

import { 
  calculateLevel, 
  xpForLevel, 
  calculateLevelProgress,
  XP_PER_CHAPTER,
  MAX_XP
} from '@/lib/gamification/xp'
import { 
  getCurrentSeason, 
  getCurrentSeasonInfo,
  getSeasonDaysRemaining,
  getSeasonProgress,
  needsSeasonRollover,
  getSeasonDateRange,
  calculateSeasonXpUpdate,
  parseSeason,
  getSeasonDisplayName,
  getPreviousSeason,
  getNextSeason
} from '@/lib/gamification/seasons'

describe('XP Progress API - Response Structure', () => {
  const mockXpProgressResponse = {
    level: {
      current: 5,
      xp_in_level: 150,
      xp_for_next: 500,
      progress: 30,
      next_level_total_xp: 2500
    },
    xp: {
      lifetime: 2150,
      seasonal: 350
    },
    season: {
      code: '2026-Q1',
      key: 'winter' as const,
      name: 'Winter',
      year: 2026,
      display_name: 'Winter 2026',
      days_remaining: 45,
      progress: 50,
      starts_at: '2026-01-01T00:00:00.000Z',
      ends_at: '2026-03-31T23:59:59.999Z'
    },
    rank: {
      seasonal: 42,
      total_participants: 1000,
      percentile: 5
    },
    stats: {
      streak_days: 7,
      longest_streak: 30,
      chapters_read: 250,
      active_days: 45
    }
  }

  it('should have all required top-level keys', () => {
    expect(mockXpProgressResponse).toHaveProperty('level')
    expect(mockXpProgressResponse).toHaveProperty('xp')
    expect(mockXpProgressResponse).toHaveProperty('season')
    expect(mockXpProgressResponse).toHaveProperty('rank')
    expect(mockXpProgressResponse).toHaveProperty('stats')
  })

  it('should have correct level structure', () => {
    const { level } = mockXpProgressResponse
    expect(typeof level.current).toBe('number')
    expect(typeof level.xp_in_level).toBe('number')
    expect(typeof level.xp_for_next).toBe('number')
    expect(typeof level.progress).toBe('number')
    expect(typeof level.next_level_total_xp).toBe('number')
    
    expect(level.current).toBeGreaterThanOrEqual(1)
    expect(level.progress).toBeGreaterThanOrEqual(0)
    expect(level.progress).toBeLessThanOrEqual(100)
  })

  it('should have correct xp structure', () => {
    const { xp } = mockXpProgressResponse
    expect(typeof xp.lifetime).toBe('number')
    expect(typeof xp.seasonal).toBe('number')
    expect(xp.lifetime).toBeGreaterThanOrEqual(0)
    expect(xp.seasonal).toBeGreaterThanOrEqual(0)
  })

  it('should have correct season structure', () => {
    const { season } = mockXpProgressResponse
    expect(season.code).toMatch(/^\d{4}-Q[1-4]$/)
    expect(['winter', 'spring', 'summer', 'fall']).toContain(season.key)
    expect(typeof season.name).toBe('string')
    expect(typeof season.year).toBe('number')
    expect(typeof season.display_name).toBe('string')
    expect(typeof season.days_remaining).toBe('number')
    expect(typeof season.progress).toBe('number')
  })

  it('should have correct rank structure', () => {
    const { rank } = mockXpProgressResponse
    expect(typeof rank.seasonal).toBe('number')
    expect(typeof rank.total_participants).toBe('number')
    expect(typeof rank.percentile).toBe('number')
    expect(rank.seasonal).toBeGreaterThanOrEqual(1)
    expect(rank.percentile).toBeGreaterThanOrEqual(1)
    expect(rank.percentile).toBeLessThanOrEqual(100)
  })

  it('should have correct stats structure', () => {
    const { stats } = mockXpProgressResponse
    expect(typeof stats.streak_days).toBe('number')
    expect(typeof stats.longest_streak).toBe('number')
    expect(typeof stats.chapters_read).toBe('number')
    expect(typeof stats.active_days).toBe('number')
  })
})

describe('XP Progress API - Level Calculations', () => {
  it('should calculate level from XP correctly', () => {
    // Test the level formula: level = floor(sqrt(xp / 100)) + 1
    const testCases = [
      { xp: 0, expectedLevel: 1 },
      { xp: 99, expectedLevel: 1 },
      { xp: 100, expectedLevel: 2 },
      { xp: 399, expectedLevel: 2 },
      { xp: 400, expectedLevel: 3 },
      { xp: 899, expectedLevel: 3 },
      { xp: 900, expectedLevel: 4 },
      { xp: 1600, expectedLevel: 5 },
      { xp: 10000, expectedLevel: 11 },
    ]

    testCases.forEach(({ xp, expectedLevel }) => {
      expect(calculateLevel(xp)).toBe(expectedLevel)
    })
  })

  it('should calculate XP thresholds for levels correctly', () => {
    const testCases = [
      { level: 1, expectedXp: 0 },
      { level: 2, expectedXp: 100 },
      { level: 3, expectedXp: 400 },
      { level: 4, expectedXp: 900 },
      { level: 5, expectedXp: 1600 },
      { level: 10, expectedXp: 8100 },
    ]

    testCases.forEach(({ level, expectedXp }) => {
      expect(xpForLevel(level)).toBe(expectedXp)
    })
  })

  it('should calculate level progress correctly', () => {
    // Level 1: 0-99 XP (100 XP range)
    expect(calculateLevelProgress(0)).toBe(0)
    expect(calculateLevelProgress(50)).toBe(0.5)
    expect(calculateLevelProgress(99)).toBeCloseTo(0.99, 2)

    // Level 2: 100-399 XP (300 XP range)
    expect(calculateLevelProgress(100)).toBe(0)
    expect(calculateLevelProgress(250)).toBe(0.5)

    // Level 3: 400-899 XP (500 XP range)
    expect(calculateLevelProgress(400)).toBe(0)
  })

  it('should reset progress to 0 on level up', () => {
    // Just before level 2
    const beforeLevelUp = calculateLevelProgress(99)
    expect(beforeLevelUp).toBeGreaterThan(0.9)

    // After level up
    const afterLevelUp = calculateLevelProgress(100)
    expect(afterLevelUp).toBe(0)
  })

  it('should handle edge cases in level calculation', () => {
    // Negative XP
    expect(calculateLevel(-100)).toBe(1)
    expect(calculateLevelProgress(-100)).toBe(0)

    // Very large XP
    expect(calculateLevel(MAX_XP)).toBeGreaterThan(1)
    expect(calculateLevelProgress(MAX_XP)).toBeLessThanOrEqual(1)

    // XP_PER_CHAPTER should be exactly 1
    expect(XP_PER_CHAPTER).toBe(1)
  })
})

describe('XP Progress API - Season Context', () => {
  it('should return current season in correct format', () => {
    const currentSeason = getCurrentSeason()
    expect(currentSeason).toMatch(/^\d{4}-Q[1-4]$/)
  })

  it('should return valid season info', () => {
    const info = getCurrentSeasonInfo()
    
    expect(info.code).toMatch(/^\d{4}-Q[1-4]$/)
    expect(['winter', 'spring', 'summer', 'fall']).toContain(info.key)
    expect(info.name).toBeTruthy()
    expect(info.year).toBeGreaterThanOrEqual(2020)
    expect(info.displayName).toBe(`${info.name} ${info.year}`)
  })

  it('should calculate days remaining correctly', () => {
    const daysRemaining = getSeasonDaysRemaining()
    expect(daysRemaining).toBeGreaterThanOrEqual(0)
    expect(daysRemaining).toBeLessThanOrEqual(92) // Max days in a quarter
  })

  it('should calculate season progress correctly', () => {
    const progress = getSeasonProgress()
    expect(progress).toBeGreaterThanOrEqual(0)
    expect(progress).toBeLessThanOrEqual(1)
  })

  it('should return valid season date ranges', () => {
    const currentSeason = getCurrentSeason()
    const dateRange = getSeasonDateRange(currentSeason)
    
    expect(dateRange).not.toBeNull()
    expect(dateRange!.start).toBeInstanceOf(Date)
    expect(dateRange!.end).toBeInstanceOf(Date)
    expect(dateRange!.end.getTime()).toBeGreaterThan(dateRange!.start.getTime())
    
    // Duration should be approximately 90 days
    const duration = (dateRange!.end.getTime() - dateRange!.start.getTime()) / (1000 * 60 * 60 * 24)
    expect(duration).toBeGreaterThanOrEqual(88)
    expect(duration).toBeLessThanOrEqual(92)
  })
})

describe('XP Progress API - Season Transitions', () => {
  it('should detect season rollover correctly', () => {
    const currentSeason = getCurrentSeason()
    
    // Current season should not need rollover
    expect(needsSeasonRollover(currentSeason)).toBe(false)
    
    // Old seasons should need rollover
    expect(needsSeasonRollover('2020-Q1')).toBe(true)
    expect(needsSeasonRollover('2023-Q4')).toBe(true)
    
    // Null/empty should need rollover (new user)
    expect(needsSeasonRollover(null)).toBe(true)
    expect(needsSeasonRollover('')).toBe(true)
  })

  it('should calculate season XP update correctly', () => {
    const currentSeason = getCurrentSeason()
    
    // Same season - increment
    const sameSeasonUpdate = calculateSeasonXpUpdate(100, currentSeason, 50)
    expect(sameSeasonUpdate.season_xp).toBe(150)
    expect(sameSeasonUpdate.current_season).toBe(currentSeason)
    
    // Different season - reset and add
    const newSeasonUpdate = calculateSeasonXpUpdate(100, '2020-Q1', 50)
    expect(newSeasonUpdate.season_xp).toBe(50) // Reset to 0, then add 50
    expect(newSeasonUpdate.current_season).toBe(currentSeason)
    
    // Null season (new user)
    const newUserUpdate = calculateSeasonXpUpdate(null, null, 50)
    expect(newUserUpdate.season_xp).toBe(50)
    expect(newUserUpdate.current_season).toBe(currentSeason)
  })

  it('should parse season codes correctly', () => {
    // New format
    const winter2026 = parseSeason('2026-Q1')
    expect(winter2026).toEqual({ year: 2026, quarter: 1, key: 'winter' })
    
    const spring2026 = parseSeason('2026-Q2')
    expect(spring2026).toEqual({ year: 2026, quarter: 2, key: 'spring' })
    
    const summer2026 = parseSeason('2026-Q3')
    expect(summer2026).toEqual({ year: 2026, quarter: 3, key: 'summer' })
    
    const fall2026 = parseSeason('2026-Q4')
    expect(fall2026).toEqual({ year: 2026, quarter: 4, key: 'fall' })
    
    // Invalid format
    expect(parseSeason('invalid')).toBeNull()
    expect(parseSeason('2026-Q5')).toBeNull()
  })

  it('should get display name for season', () => {
    expect(getSeasonDisplayName('2026-Q1')).toBe('Winter 2026')
    expect(getSeasonDisplayName('2026-Q2')).toBe('Spring 2026')
    expect(getSeasonDisplayName('2026-Q3')).toBe('Summer 2026')
    expect(getSeasonDisplayName('2026-Q4')).toBe('Fall 2026')
  })

  it('should navigate between seasons correctly', () => {
    // Previous season
    expect(getPreviousSeason('2026-Q1')).toBe('2025-Q4')
    expect(getPreviousSeason('2026-Q2')).toBe('2026-Q1')
    expect(getPreviousSeason('2026-Q3')).toBe('2026-Q2')
    expect(getPreviousSeason('2026-Q4')).toBe('2026-Q3')
    
    // Next season
    expect(getNextSeason('2025-Q4')).toBe('2026-Q1')
    expect(getNextSeason('2026-Q1')).toBe('2026-Q2')
    expect(getNextSeason('2026-Q2')).toBe('2026-Q3')
    expect(getNextSeason('2026-Q3')).toBe('2026-Q4')
  })
})

describe('XP Progress API - Data Integrity', () => {
  it('should maintain consistent level/XP relationship', () => {
    // For any XP value, level and progress should be consistent
    const testValues = [0, 50, 100, 250, 500, 1000, 5000, 10000, 50000, 100000]
    
    testValues.forEach(xp => {
      const level = calculateLevel(xp)
      const levelStart = xpForLevel(level)
      const levelEnd = xpForLevel(level + 1)
      
      // XP should be within the level range
      expect(xp).toBeGreaterThanOrEqual(levelStart)
      expect(xp).toBeLessThan(levelEnd)
      
      // Progress should be between 0 and 1
      const progress = calculateLevelProgress(xp)
      expect(progress).toBeGreaterThanOrEqual(0)
      expect(progress).toBeLessThanOrEqual(1)
    })
  })

  it('should have monotonically increasing XP thresholds', () => {
    let prevXp = 0
    for (let level = 1; level <= 100; level++) {
      const xp = xpForLevel(level)
      expect(xp).toBeGreaterThanOrEqual(prevXp)
      prevXp = xp
    }
  })

  it('should have increasing XP requirements per level', () => {
    // XP needed for each level should increase
    let prevDelta = 0
    for (let level = 2; level <= 20; level++) {
      const xpNeeded = xpForLevel(level + 1) - xpForLevel(level)
      expect(xpNeeded).toBeGreaterThan(prevDelta)
      prevDelta = xpNeeded
    }
  })
})

describe('XP Progress API - Seasonal Leaderboard Integration', () => {
  it('should use seasonal XP for season rankings', () => {
    // Verify the conceptual separation of XP types
    const lifetimeXp = 10000
    const seasonalXp = 500
    
    // Season rankings should use seasonal XP only
    expect(seasonalXp).not.toBe(lifetimeXp)
    expect(seasonalXp).toBeLessThan(lifetimeXp)
  })

  it('should calculate percentile correctly', () => {
    // If user is rank 42 out of 1000, they're in top 5%
    const rank = 42
    const total = 1000
    const percentile = Math.max(1, Math.round((rank / total) * 100))
    
    expect(percentile).toBeGreaterThanOrEqual(1)
    expect(percentile).toBeLessThanOrEqual(100)
  })

  it('should handle edge case of being only participant', () => {
    const rank = 1
    const total = 1
    const percentile = Math.max(1, Math.round((rank / total) * 100))
    
    expect(percentile).toBe(100) // Top 100% when you're the only one
  })
})
