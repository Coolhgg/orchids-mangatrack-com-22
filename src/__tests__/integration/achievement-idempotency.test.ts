import { checkAchievements, AchievementTrigger } from '@/lib/gamification/achievements'

const mockUserId = '550e8400-e29b-41d4-a716-446655440000'

const mockAchievement = {
  id: 'ach-001',
  code: 'reader_novice',
  name: 'Novice Reader',
  description: 'Read 10 chapters',
  xp_reward: 100,
  rarity: 'common',
  is_seasonal: false,
  season_id: null,
  criteria: { type: 'chapter_count', threshold: 10 },
  created_at: new Date(),
  updated_at: new Date(),
}

const mockSeasonalAchievement = {
  id: 'ach-002',
  code: 'winter_reader',
  name: 'Winter Reader',
  description: 'Read 50 chapters this season',
  xp_reward: 500,
  rarity: 'rare',
  is_seasonal: true,
  season_id: null,
  criteria: { type: 'chapter_count', threshold: 50 },
  created_at: new Date(),
  updated_at: new Date(),
}

const mockSeason = {
  id: 'season-winter-2026',
  code: 'WINTER_2026',
  name: 'Winter 2026',
  starts_at: new Date('2026-01-01'),
  ends_at: new Date('2026-03-31'),
  is_active: true,
  created_at: new Date(),
}

const mockUser = {
  id: mockUserId,
  xp: 500,
  level: 3,
  chapters_read: 15,
  season_xp: 200,
  current_season: 'WINTER_2026',
}

const mockTx = {
  achievement: {
    findMany: jest.fn(),
  },
  season: {
    findFirst: jest.fn(),
  },
  user: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  userAchievement: {
    findFirst: jest.fn(),
    create: jest.fn(),
  },
  seasonalUserAchievement: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  libraryEntry: {
    count: jest.fn(),
  },
  follow: {
    count: jest.fn(),
  },
  activity: {
    create: jest.fn(),
  },
}

jest.mock('@/lib/gamification/activity', () => ({
  logActivity: jest.fn().mockResolvedValue(undefined),
}))

describe('Achievement Idempotency Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    mockTx.user.findUnique.mockResolvedValue(mockUser)
    mockTx.user.update.mockResolvedValue({ ...mockUser, xp: mockUser.xp + 100 })
    mockTx.season.findFirst.mockResolvedValue(mockSeason)
  })

  describe('Permanent Achievement Idempotency', () => {
    it('should not double-award XP when achievement already unlocked', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      mockTx.userAchievement.findFirst.mockResolvedValue({
        id: 'unlock-001',
        user_id: mockUserId,
        achievement_id: mockAchievement.id,
        unlocked_at: new Date(),
      })

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(0)
      expect(mockTx.userAchievement.create).not.toHaveBeenCalled()
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should award XP only once for new achievement unlock', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      mockTx.userAchievement.findFirst.mockResolvedValue(null)
      mockTx.userAchievement.create.mockResolvedValue({
        id: 'unlock-new',
        user_id: mockUserId,
        achievement_id: mockAchievement.id,
        unlocked_at: new Date(),
      })

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(1)
      expect(result[0].code).toBe('reader_novice')
      expect(mockTx.userAchievement.create).toHaveBeenCalledTimes(1)
      expect(mockTx.user.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('Seasonal Achievement Idempotency', () => {
    it('should not double-award XP when seasonal achievement already unlocked this season', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockSeasonalAchievement])
      
      mockTx.user.findUnique.mockResolvedValue({ ...mockUser, chapters_read: 55 })
      
      mockTx.seasonalUserAchievement.findUnique.mockResolvedValue({
        id: 'seasonal-unlock-001',
        user_id: mockUserId,
        achievement_id: mockSeasonalAchievement.id,
        season_id: mockSeason.id,
        unlocked_at: new Date(),
      })

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(0)
      expect(mockTx.seasonalUserAchievement.create).not.toHaveBeenCalled()
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should award XP for new seasonal achievement unlock', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([mockSeasonalAchievement])
      
      mockTx.user.findUnique.mockResolvedValue({ ...mockUser, chapters_read: 55 })
      
      mockTx.seasonalUserAchievement.findUnique.mockResolvedValue(null)
      mockTx.seasonalUserAchievement.create.mockResolvedValue({
        id: 'seasonal-unlock-new',
        user_id: mockUserId,
        achievement_id: mockSeasonalAchievement.id,
        season_id: mockSeason.id,
        unlocked_at: new Date(),
      })

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(1)
      expect(result[0].code).toBe('winter_reader')
      expect(result[0].is_seasonal).toBe(true)
      expect(mockTx.seasonalUserAchievement.create).toHaveBeenCalledTimes(1)
      expect(mockTx.user.update).toHaveBeenCalledTimes(1)
    })
  })

  describe('Concurrent Trigger Handling', () => {
    it('should handle P2002 unique constraint error gracefully', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      mockTx.userAchievement.findFirst.mockResolvedValue(null)
      mockTx.userAchievement.create.mockRejectedValue({
        code: 'P2002',
        message: 'Unique constraint failed',
      })

      const result = await checkAchievements(
        mockTx as any,
        mockUserId,
        'chapter_read' as AchievementTrigger
      )

      expect(result).toHaveLength(0)
      expect(mockTx.user.update).not.toHaveBeenCalled()
    })

    it('should re-throw non-P2002 errors', async () => {
      mockTx.achievement.findMany
        .mockResolvedValueOnce([mockAchievement])
        .mockResolvedValueOnce([])
      
      mockTx.userAchievement.findFirst.mockResolvedValue(null)
      mockTx.userAchievement.create.mockRejectedValue(new Error('Database connection failed'))

      await expect(
        checkAchievements(mockTx as any, mockUserId, 'chapter_read' as AchievementTrigger)
      ).rejects.toThrow('Database connection failed')
    })
  })
})
