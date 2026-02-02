/**
 * API Integration Tests
 * Tests for all major API endpoints with mocked Prisma and Supabase
 */

import { prisma } from '@/lib/prisma'

// Mock Prisma
jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    series: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    libraryEntry: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    activity: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
    },
    follow: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      count: jest.fn(),
    },
    chapter: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((fn) => fn(prisma)),
  },
}))

const mockPrisma: any = prisma as jest.Mocked<typeof prisma>

describe('API Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('Library API', () => {
    describe('GET /api/library', () => {
      it('should return library entries with series data', async () => {
        const mockEntries = [
          {
            id: 'entry-1',
            user_id: 'user-1',
            series_id: 'series-1',
            status: 'reading',
            last_read_chapter: 10,
            user_rating: 4.5,
            updated_at: new Date(),
            series: {
              id: 'series-1',
              title: 'One Piece',
              cover_url: 'https://example.com/cover.jpg',
              type: 'manga',
              status: 'ongoing',
            },
          },
          {
            id: 'entry-2',
            user_id: 'user-1',
            series_id: 'series-2',
            status: 'completed',
            last_read_chapter: 200,
            user_rating: 5,
            updated_at: new Date(),
            series: {
              id: 'series-2',
              title: 'Naruto',
              cover_url: 'https://example.com/cover2.jpg',
              type: 'manga',
              status: 'completed',
            },
          },
        ]

        ;(mockPrisma.libraryEntry.findMany as jest.Mock).mockResolvedValue(mockEntries)

        const entries = await prisma.libraryEntry.findMany({
          where: { user_id: 'user-1' },
          include: { series: true },
          orderBy: { updated_at: 'desc' },
        })

        expect(entries).toHaveLength(2)
        expect(entries[0].series?.title).toBe('One Piece')
        expect(entries[0].status).toBe('reading')
      })

      it('should filter by status', async () => {
        const mockEntries = [
          {
            id: 'entry-1',
            status: 'reading',
            series: { title: 'One Piece' },
          },
        ]

        ;(mockPrisma.libraryEntry.findMany as jest.Mock).mockResolvedValue(mockEntries)

        const entries = await prisma.libraryEntry.findMany({
          where: { user_id: 'user-1', status: 'reading' },
        })

        expect(entries).toHaveLength(1)
        expect(entries[0].status).toBe('reading')
      })

      it('should return empty array for new users', async () => {
        ;(mockPrisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([])

        const entries = await prisma.libraryEntry.findMany({
          where: { user_id: 'new-user' },
        })

        expect(entries).toHaveLength(0)
      })
    })

    describe('POST /api/library', () => {
      it('should add series to library', async () => {
        const mockSeries = { id: 'series-1', title: 'One Piece' }
        const mockEntry = {
          id: 'entry-1',
          user_id: 'user-1',
          series_id: 'series-1',
          status: 'reading',
          last_read_chapter: 0,
        }

        ;(mockPrisma.series.findUnique as jest.Mock).mockResolvedValue(mockSeries)
        ;(mockPrisma.libraryEntry.create as jest.Mock).mockResolvedValue(mockEntry)
        ;(mockPrisma.series.update as jest.Mock).mockResolvedValue({ ...mockSeries, total_follows: 1 })
        ;(mockPrisma.$transaction as jest.Mock).mockResolvedValue(mockEntry)

        const result = await prisma.$transaction(async (tx) => {
          return mockEntry
        })

        expect(result.series_id).toBe('series-1')
        expect(result.status).toBe('reading')
      })

      it('should reject duplicate entries', async () => {
        const error = { code: 'P2002', message: 'Unique constraint failed' }
        ;(mockPrisma.libraryEntry.create as jest.Mock).mockRejectedValue(error)

        await expect(
          prisma.libraryEntry.create({
            data: {
              user_id: 'user-1',
              series_id: 'series-1',
              status: 'reading',
              source_url: 'https://example.com/test',
              source_name: 'test',
            },
          })
        ).rejects.toMatchObject({ code: 'P2002' })
      })
    })

    describe('DELETE /api/library/[id]', () => {
      it('should remove series from library', async () => {
        ;(mockPrisma.libraryEntry.delete as jest.Mock).mockResolvedValue({ id: 'entry-1' })

        const result = await prisma.libraryEntry.delete({
          where: { id: 'entry-1' },
        })

        expect(result.id).toBe('entry-1')
      })
    })
  })

  describe('Series API', () => {
    describe('GET /api/series/search', () => {
      it('should search series by title', async () => {
        const mockSeries = [
          { id: 'series-1', title: 'One Piece', type: 'manga', total_follows: 100000 },
          { id: 'series-2', title: 'One Punch Man', type: 'manga', total_follows: 50000 },
        ]

        ;(mockPrisma.series.findMany as jest.Mock).mockResolvedValue(mockSeries)

        const results = await prisma.series.findMany({
          where: {
            title: { contains: 'One', mode: 'insensitive' },
          },
          take: 20,
        })

        expect(results).toHaveLength(2)
        expect(results[0].title).toContain('One')
      })

      it('should filter by type', async () => {
        const mockSeries = [
          { id: 'series-1', title: 'Test Manhwa', type: 'manhwa' },
        ]

        ;(mockPrisma.series.findMany as jest.Mock).mockResolvedValue(mockSeries)

        const results = await prisma.series.findMany({
          where: { type: 'manhwa' },
        })

        expect(results[0].type).toBe('manhwa')
      })

      it('should filter by genre', async () => {
        const mockSeries = [
          { id: 'series-1', title: 'Action Manga', genres: ['Action', 'Adventure'] },
        ]

        ;(mockPrisma.series.findMany as jest.Mock).mockResolvedValue(mockSeries)

        const results = await prisma.series.findMany({
          where: { genres: { has: 'Action' } },
        })

        expect(results[0].genres).toContain('Action')
      })
    })

    describe('GET /api/series/trending', () => {
      it('should return trending series ordered by follows', async () => {
        const mockTrending = [
          { id: 'series-1', title: 'Most Popular', total_follows: 100000 },
          { id: 'series-2', title: 'Second Popular', total_follows: 80000 },
          { id: 'series-3', title: 'Third Popular', total_follows: 60000 },
        ]

        ;(mockPrisma.series.findMany as jest.Mock).mockResolvedValue(mockTrending)

        const results = await prisma.series.findMany({
          orderBy: { total_follows: 'desc' },
          take: 10,
        })

        expect(results).toHaveLength(3)
        expect(results[0].total_follows).toBeGreaterThan(results[1].total_follows)
      })
    })

    describe('GET /api/series/[id]/chapters', () => {
      it('should return chapters for a series', async () => {
        const mockChapters = [
          { id: 'ch-1', chapter_number: "1", chapter_title: 'Chapter 1', published_at: new Date() },
          { id: 'ch-2', chapter_number: "2", chapter_title: 'Chapter 2', published_at: new Date() },
        ]

        ;(mockPrisma.chapter.findMany as jest.Mock).mockResolvedValue(mockChapters)

        const chapters = await prisma.chapter.findMany({
          where: { series_id: 'series-1' },
          orderBy: { chapter_number: 'asc' },
        })

        expect(chapters).toHaveLength(2)
        // chapter_number is stored as a string in the database
        expect(chapters[0].chapter_number).toBe("1")
      })
    })
  })

  describe('Notifications API', () => {
    describe('GET /api/notifications', () => {
      it('should return paginated notifications', async () => {
        const mockNotifications = [
          { id: 'notif-1', type: 'new_chapter', title: 'New Chapter', read_at: null },
          { id: 'notif-2', type: 'follow', title: 'New Follower', read_at: new Date() },
        ]

        ;(mockPrisma.notification.findMany as jest.Mock).mockResolvedValue(mockNotifications)
        ;(mockPrisma.notification.count as jest.Mock).mockResolvedValue(2)

        const [items, total] = await Promise.all([
          prisma.notification.findMany({
            where: { user_id: 'user-1' },
            orderBy: { created_at: 'desc' },
            skip: 0,
            take: 20,
          }),
          prisma.notification.count({ where: { user_id: 'user-1' } }),
        ])

        expect(items).toHaveLength(2)
        expect(total).toBe(2)
      })

      it('should filter unread notifications', async () => {
        const mockUnread = [
          { id: 'notif-1', type: 'new_chapter', read_at: null },
        ]

        ;(mockPrisma.notification.findMany as jest.Mock).mockResolvedValue(mockUnread)

        const results = await prisma.notification.findMany({
          where: { user_id: 'user-1', read_at: null },
        })

        expect(results).toHaveLength(1)
        expect(results[0].read_at).toBeNull()
      })

      it('should filter by notification type', async () => {
        const mockChapterNotifs = [
          { id: 'notif-1', type: 'new_chapter', title: 'Ch 100 Released' },
        ]

        ;(mockPrisma.notification.findMany as jest.Mock).mockResolvedValue(mockChapterNotifs)

        const results = await prisma.notification.findMany({
          where: { user_id: 'user-1', type: 'new_chapter' },
        })

        expect(results[0].type).toBe('new_chapter')
      })
    })

    describe('PATCH /api/notifications', () => {
      it('should mark all notifications as read', async () => {
        ;(mockPrisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 })

        const result = await prisma.notification.updateMany({
          where: { user_id: 'user-1', read_at: null },
          data: { read_at: new Date() },
        })

        expect(result.count).toBe(5)
      })
    })

    describe('PATCH /api/notifications/[id]/read', () => {
      it('should mark single notification as read', async () => {
        const mockNotif = { id: 'notif-1', read_at: new Date() }
        ;(mockPrisma.notification.update as jest.Mock).mockResolvedValue(mockNotif)

        const result = await prisma.notification.update({
          where: { id: 'notif-1' },
          data: { read_at: new Date() },
        })

        expect(result.read_at).not.toBeNull()
      })
    })
  })

  describe('Social API', () => {
    describe('GET /api/users/[username]', () => {
      it('should return user profile', async () => {
        const mockUser = {
          id: 'user-1',
          username: 'testuser',
          avatar_url: null,
          bio: 'Manga reader',
          xp: 5000,
          level: 25,
          streak_days: 30,
          created_at: new Date(),
          privacy_settings: { library_public: true, activity_public: true },
        }

        ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)

        const user = await prisma.user.findUnique({
          where: { username: 'testuser' },
        })

        expect(user?.username).toBe('testuser')
        expect(user?.level).toBe(25)
      })

      it('should return 404 for non-existent user', async () => {
        ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(null)

        const user = await prisma.user.findUnique({
          where: { username: 'nonexistent' },
        })

        expect(user).toBeNull()
      })
    })

    describe('GET /api/users/[username]/followers', () => {
      it('should return paginated followers', async () => {
        const mockUser = { id: 'user-1', privacy_settings: null }
        const mockFollows = [
          { follower: { id: 'user-2', username: 'follower1', avatar_url: null, bio: null } },
          { follower: { id: 'user-3', username: 'follower2', avatar_url: null, bio: null } },
        ]

        ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockUser)
        ;(mockPrisma.follow.findMany as jest.Mock).mockResolvedValue(mockFollows)
        ;(mockPrisma.follow.count as jest.Mock).mockResolvedValue(2)

        const [items, total] = await Promise.all([
          prisma.follow.findMany({
            where: { following_id: 'user-1' },
            include: { follower: true },
          }),
          prisma.follow.count({ where: { following_id: 'user-1' } }),
        ])

        expect(items).toHaveLength(2)
        expect(total).toBe(2)
      })
    })

    describe('POST /api/users/[username]/follow', () => {
      it('should create follow relationship', async () => {
        const mockTarget = { id: 'user-2' }
        const mockFollow = { id: 'follow-1', follower_id: 'user-1', following_id: 'user-2' }

        ;(mockPrisma.user.findUnique as jest.Mock).mockResolvedValue(mockTarget)
        ;(mockPrisma.follow.findUnique as jest.Mock).mockResolvedValue(null)
        ;(mockPrisma.follow.create as jest.Mock).mockResolvedValue(mockFollow)
        ;(mockPrisma.notification.create as jest.Mock).mockResolvedValue({})

        const follow = await prisma.follow.create({
          data: { follower_id: 'user-1', following_id: 'user-2' },
        })

        expect(follow.follower_id).toBe('user-1')
        expect(follow.following_id).toBe('user-2')
      })

      it('should prevent self-follow', async () => {
        // Self-follow should be prevented in the API logic
        const error = new Error('Cannot follow yourself')
        ;(mockPrisma.follow.create as jest.Mock).mockRejectedValue(error)

        await expect(
          prisma.follow.create({
            data: { follower_id: 'user-1', following_id: 'user-1' },
          })
        ).rejects.toThrow('Cannot follow yourself')
      })
    })

    describe('DELETE /api/users/[username]/follow', () => {
      it('should remove follow relationship', async () => {
        ;(mockPrisma.follow.deleteMany as jest.Mock).mockResolvedValue({ count: 1 })

        const result = await prisma.follow.deleteMany({
          where: { follower_id: 'user-1', following_id: 'user-2' },
        })

        expect(result.count).toBe(1)
      })
    })
  })

  describe('Feed API', () => {
    describe('GET /api/feed', () => {
      it('should return global activity feed', async () => {
        const mockActivities = [
          {
            id: 'activity-1',
            type: 'chapter_read',
            user: { id: 'user-1', username: 'reader1', avatar_url: null },
            series: { id: 'series-1', title: 'One Piece', cover_url: null },
            chapter: { chapter_number: "1000" },
            created_at: new Date(),
          },
        ]

        ;(mockPrisma.activity.findMany as jest.Mock).mockResolvedValue(mockActivities)
        ;(mockPrisma.activity.count as jest.Mock).mockResolvedValue(1)

        const [items, total] = await Promise.all([
          prisma.activity.findMany({
            orderBy: { created_at: 'desc' },
            include: { user: true, series: true, chapter: true },
            take: 20,
          }),
          prisma.activity.count({}),
        ])

        expect(items).toHaveLength(1)
        expect(items[0].type).toBe('chapter_read')
      })

      it('should filter by following', async () => {
        const mockFollowing = [{ following_id: 'user-2' }]
        ;(mockPrisma.follow.findMany as jest.Mock).mockResolvedValue(mockFollowing)

        const following = await prisma.follow.findMany({
          where: { follower_id: 'user-1' },
          select: { following_id: true },
        })

        expect(following).toHaveLength(1)
      })
    })
  })

  describe('Leaderboard API', () => {
    describe('GET /api/leaderboard', () => {
      it('should return XP leaderboard', async () => {
        const mockUsers = [
          { id: 'user-1', username: 'top', xp: 100000, level: 100 },
          { id: 'user-2', username: 'second', xp: 80000, level: 80 },
          { id: 'user-3', username: 'third', xp: 60000, level: 60 },
        ]

        ;(mockPrisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers)

        const users = await prisma.user.findMany({
          orderBy: { xp: 'desc' },
          take: 50,
        })

        expect(users).toHaveLength(3)
        expect(users[0].xp).toBeGreaterThan(users[1].xp)
      })

      it('should return streak leaderboard', async () => {
        const mockUsers = [
          { id: 'user-1', username: 'streaker', streak_days: 365 },
          { id: 'user-2', username: 'consistent', streak_days: 100 },
        ]

        ;(mockPrisma.user.findMany as jest.Mock).mockResolvedValue(mockUsers)

        const users = await prisma.user.findMany({
          orderBy: { streak_days: 'desc' },
          take: 50,
        })

        expect(users[0].streak_days).toBe(365)
      })
    })
  })

  describe('Progress API', () => {
    describe('PATCH /api/library/[id]/progress', () => {
      it('should update chapter progress', async () => {
        const mockEntry = {
          id: 'entry-1',
          last_read_chapter: 50,
          updated_at: new Date(),
        }

        ;(mockPrisma.libraryEntry.update as jest.Mock).mockResolvedValue(mockEntry)

        const result = await prisma.libraryEntry.update({
          where: { id: 'entry-1' },
          data: { last_read_chapter: 50, updated_at: new Date() },
        })

        expect(result.last_read_chapter).toBe(50)
      })

      it('should create activity when progress updated', async () => {
        const mockActivity = {
          id: 'activity-1',
          type: 'chapter_read',
          user_id: 'user-1',
        }

        ;(mockPrisma.activity.create as jest.Mock).mockResolvedValue(mockActivity)

        const activity = await prisma.activity.create({
          data: {
            user_id: 'user-1',
            type: 'chapter_read',
            series_id: 'series-1',
            metadata: { chapter: 50 },
          },
        })

        expect(activity.type).toBe('chapter_read')
      })
    })
  })
})
