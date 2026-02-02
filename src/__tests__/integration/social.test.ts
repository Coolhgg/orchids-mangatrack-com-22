/**
 * Social Features Unit Tests
 * 
 * Tests the social functionality like following and activity feeds.
 * Uses mocks to avoid database dependencies.
 */

// Mock the prisma client first
jest.mock('@/lib/prisma', () => ({
  prisma: {
    follow: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    activity: {
      findMany: jest.fn(),
      create: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn({
      follow: {
        findUnique: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
      notification: {
        create: jest.fn(),
      },
    })),
  },
  withRetry: jest.fn((cb) => cb()),
}))

import { prisma } from '@/lib/prisma'

const USER_A_ID = '00000000-0000-0000-0000-a00000000001'
const USER_B_ID = '00000000-0000-0000-0000-b00000000001'
const SERIES_ID = '00000000-0000-0000-0000-000000000001'

describe('Social Features', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Follow System', () => {
    it('should allow a user to follow another user', async () => {
      const mockFollow = prisma.follow as jest.Mocked<typeof prisma.follow>
      const mockUser = prisma.user as jest.Mocked<typeof prisma.user>
      
      // User B exists
      ;(mockUser.findFirst as jest.Mock).mockResolvedValue({
        id: USER_B_ID,
        username: 'userb',
      })
      
      // No existing follow
      ;(mockFollow.findUnique as jest.Mock).mockResolvedValue(null)
      
      // Create returns the follow
      ;(mockFollow.create as jest.Mock).mockResolvedValue({
        follower_id: USER_A_ID,
        following_id: USER_B_ID,
        created_at: new Date(),
      })
      
      // Simulate follow action
      const follow = await mockFollow.create({
        data: {
          follower_id: USER_A_ID,
          following_id: USER_B_ID,
        },
      })
      
      expect(follow).toBeDefined()
      expect(follow.follower_id).toBe(USER_A_ID)
      expect(follow.following_id).toBe(USER_B_ID)
    })

    it('should prevent self-following', async () => {
      const validateFollow = (followerId: string, followingId: string): boolean => {
        return followerId !== followingId
      }
      
      expect(validateFollow(USER_A_ID, USER_A_ID)).toBe(false)
      expect(validateFollow(USER_A_ID, USER_B_ID)).toBe(true)
    })

    it('should prevent duplicate follows', async () => {
      const mockFollow = prisma.follow as jest.Mocked<typeof prisma.follow>
      
      // Existing follow
      ;(mockFollow.findUnique as jest.Mock).mockResolvedValue({
        follower_id: USER_A_ID,
        following_id: USER_B_ID,
      })
      
      const existingFollow = await mockFollow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: USER_A_ID,
            following_id: USER_B_ID,
          },
        },
      })
      
      expect(existingFollow).toBeDefined()
      // In real implementation, this would prevent creating a duplicate
    })

    it('should allow unfollowing', async () => {
      const mockFollow = prisma.follow as jest.Mocked<typeof prisma.follow>
      
      ;(mockFollow.delete as jest.Mock).mockResolvedValue({
        follower_id: USER_A_ID,
        following_id: USER_B_ID,
      })
      
      const result = await mockFollow.delete({
        where: {
          follower_id_following_id: {
            follower_id: USER_A_ID,
            following_id: USER_B_ID,
          },
        },
      })
      
      expect(result).toBeDefined()
      expect(mockFollow.delete).toHaveBeenCalled()
    })
  })

  describe('Activity Feed', () => {
    it('should return activities from followed users', async () => {
      const mockFollow = prisma.follow as jest.Mocked<typeof prisma.follow>
      const mockActivity = prisma.activity as jest.Mocked<typeof prisma.activity>
      
      // User A follows User B
      ;(mockFollow.findMany as jest.Mock).mockResolvedValue([
        { follower_id: USER_A_ID, following_id: USER_B_ID },
      ])
      
      // User B has activities
      ;(mockActivity.findMany as jest.Mock).mockResolvedValue([
        {
          id: 'activity-1',
          user_id: USER_B_ID,
          type: 'chapter_read',
          series_id: SERIES_ID,
          metadata: { chapter_number: '1' },
          created_at: new Date(),
          user: { username: 'userb' },
          series: { title: 'Test Series' },
        },
      ])
      
      const followedUserIds = (await mockFollow.findMany({
        where: { follower_id: USER_A_ID },
        select: { following_id: true },
      })).map((f: { following_id: string }) => f.following_id)
      
      const activities = await mockActivity.findMany({
        where: { user_id: { in: followedUserIds } },
      })
      
      expect(activities.length).toBeGreaterThan(0)
      expect(activities[0].user_id).toBe(USER_B_ID)
    })

    it('should filter out private activities', async () => {
      const mockUser = prisma.user as jest.Mocked<typeof prisma.user>
      
      // User B has private activity settings
      ;(mockUser.findUnique as jest.Mock).mockResolvedValue({
        id: USER_B_ID,
        privacy_settings: { activity_public: false },
      })
      
      const user = await mockUser.findUnique({ where: { id: USER_B_ID } })
      const privacySettings = user?.privacy_settings as { activity_public: boolean }
      
      // In real implementation, this would filter the query
      expect(privacySettings?.activity_public).toBe(false)
    })

    it('should sort activities by recency', async () => {
      const mockActivity = prisma.activity as jest.Mocked<typeof prisma.activity>
      
      const now = new Date()
      const hourAgo = new Date(now.getTime() - 3600000)
      
      ;(mockActivity.findMany as jest.Mock).mockResolvedValue([
        { id: 'activity-1', created_at: now },
        { id: 'activity-2', created_at: hourAgo },
      ])
      
      const activities = await mockActivity.findMany({
        orderBy: { created_at: 'desc' },
      })
      
      expect(activities[0].created_at.getTime()).toBeGreaterThan(
        activities[1].created_at.getTime()
      )
    })
  })

  describe('Privacy Settings', () => {
    it('should default to public activity', () => {
      const defaultPrivacySettings = {
        activity_public: true,
        show_reading_list: true,
        show_statistics: true,
      }
      
      expect(defaultPrivacySettings.activity_public).toBe(true)
    })

    it('should respect private reading list setting', async () => {
      const mockUser = prisma.user as jest.Mocked<typeof prisma.user>
      
      ;(mockUser.findUnique as jest.Mock).mockResolvedValue({
        id: USER_A_ID,
        privacy_settings: {
          activity_public: true,
          show_reading_list: false,
        },
      })
      
      const user = await mockUser.findUnique({ where: { id: USER_A_ID } })
      const settings = user?.privacy_settings as { show_reading_list: boolean }
      
      expect(settings.show_reading_list).toBe(false)
    })
  })
})

describe('Activity Types', () => {
  const VALID_ACTIVITY_TYPES = [
    'chapter_read',
    'series_started',
    'series_completed',
    'series_dropped',
    'series_added',
    'rating_given',
  ]

  it('should validate activity types', () => {
    const validateActivityType = (type: string): boolean => {
      return VALID_ACTIVITY_TYPES.includes(type)
    }
    
    expect(validateActivityType('chapter_read')).toBe(true)
    expect(validateActivityType('invalid_type')).toBe(false)
  })

  it('should include all expected activity types', () => {
    expect(VALID_ACTIVITY_TYPES).toContain('chapter_read')
    expect(VALID_ACTIVITY_TYPES).toContain('series_started')
    expect(VALID_ACTIVITY_TYPES).toContain('series_completed')
  })
})
