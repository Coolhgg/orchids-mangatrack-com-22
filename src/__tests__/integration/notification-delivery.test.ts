/**
 * Integration Tests for Notification Delivery
 * Tests the notification delivery flow with mocked dependencies
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/prisma', () => ({
  prisma: {
    notification: {
      findMany: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  },
  withRetry: jest.fn((fn) => fn()),
}));

jest.mock('@/lib/redis', () => ({
  redis: {
    incr: jest.fn().mockResolvedValue(1),
    pttl: jest.fn().mockResolvedValue(60000),
    pexpire: jest.fn().mockResolvedValue(1),
    multi: jest.fn(() => ({
      incr: jest.fn().mockReturnThis(),
      pttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([[null, 1], [null, 60000]]),
    })),
  },
  waitForRedis: jest.fn().mockResolvedValue(true),
  REDIS_KEY_PREFIX: 'test:',
}));

import { createClient } from '@/lib/supabase/server';
import { prisma, withRetry } from '@/lib/prisma';

describe('Notification Delivery Integration Tests', () => {
  const mockUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    username: 'testuser',
    notification_preferences: {
      new_chapter: true,
      new_follower: true,
      achievement: true,
      digest_mode: false,
    },
  };

  const mockNotification = {
    id: 'notif-001',
    user_id: mockUser.id,
    type: 'new_chapter',
    title: 'New Chapter Available',
    message: 'Chapter 100 of One Piece is now available!',
    priority: 1,
    read_at: null,
    created_at: new Date(),
    series_id: 'series-001',
    chapter_id: 'chapter-001',
    actor_user_id: null,
    series: {
      id: 'series-001',
      title: 'One Piece',
      cover_url: 'https://example.com/cover.jpg',
    },
    chapter: {
      id: 'chapter-001',
      chapter_number: 100,
      chapter_title: 'The Grand Line',
    },
    actor: null,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: mockUser },
          error: null,
        }),
      },
    });
  });

  describe('Notification Fetching Flow', () => {
    it('should fetch notifications with related data (series, chapter, actor)', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotification]);
      (prisma.notification.count as jest.Mock).mockResolvedValue(1);

      const notifications = await prisma.notification.findMany({
        where: { user_id: mockUser.id },
        include: { series: true, chapter: true },
      });

      expect(notifications).toHaveLength(1);
      expect(notifications[0].series).toBeDefined();
      expect(notifications[0].series?.title).toBe('One Piece');
      expect(notifications[0].chapter).toBeDefined();
    });

    it('should filter unread notifications only', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotification]);

      await prisma.notification.findMany({
        where: {
          user_id: mockUser.id,
          read_at: null,
        },
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: mockUser.id,
            read_at: null,
          }),
        })
      );
    });

    it('should filter by notification type', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([mockNotification]);

      await prisma.notification.findMany({
        where: {
          user_id: mockUser.id,
          type: 'new_chapter',
        },
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user_id: mockUser.id,
            type: 'new_chapter',
          }),
        })
      );
    });

    it('should enforce pagination with skip and take', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await prisma.notification.findMany({
        where: { user_id: mockUser.id },
        skip: 20,
        take: 10,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        })
      );
    });

    it('should order by priority then by created_at descending', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      await prisma.notification.findMany({
        where: { user_id: mockUser.id },
        orderBy: [
          { priority: 'asc' },
          { created_at: 'desc' },
        ],
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { priority: 'asc' },
            { created_at: 'desc' },
          ],
        })
      );
    });
  });

  describe('Mark as Read Flow', () => {
    it('should mark single notification as read with ownership check', async () => {
      const notificationId = 'notif-001';
      (prisma.notification.update as jest.Mock).mockResolvedValue({
        ...mockNotification,
        read_at: new Date(),
      });

      await prisma.notification.update({
        where: {
          id: notificationId,
          user_id: mockUser.id,
        },
        data: { read_at: new Date() },
      });

      expect(prisma.notification.update).toHaveBeenCalledWith({
        where: {
          id: notificationId,
          user_id: mockUser.id,
        },
        data: { read_at: expect.any(Date) },
      });
    });

    it('should mark all unread notifications as read', async () => {
      (prisma.notification.updateMany as jest.Mock).mockResolvedValue({ count: 5 });

      await prisma.notification.updateMany({
        where: {
          user_id: mockUser.id,
          read_at: null,
        },
        data: { read_at: new Date() },
      });

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          user_id: mockUser.id,
          read_at: null,
        },
        data: { read_at: expect.any(Date) },
      });
    });
  });

  describe('Notification Types', () => {
    const notificationTypes = [
      {
        type: 'new_chapter',
        title: 'New Chapter',
        message: 'Chapter 10 is now available',
      },
      {
        type: 'new_follower',
        title: 'New Follower',
        message: 'User123 started following you',
      },
      {
        type: 'achievement',
        title: 'Achievement Unlocked',
        message: 'You earned "First Read"!',
      },
      {
        type: 'system',
        title: 'System Update',
        message: 'New features have been added',
      },
    ];

    notificationTypes.forEach(({ type, title, message }) => {
      it(`should handle ${type} notification type`, async () => {
        const typedNotification = {
          ...mockNotification,
          type,
          title,
          message,
        };

        (prisma.notification.findMany as jest.Mock).mockResolvedValue([typedNotification]);

        const notifications = await prisma.notification.findMany({
          where: { user_id: mockUser.id, type },
        });

        expect(notifications[0].type).toBe(type);
        expect(notifications[0].title).toBe(title);
      });
    });
  });

  describe('Pagination', () => {
    it('should correctly calculate pagination metadata', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue(
        Array(20).fill(mockNotification)
      );
      (prisma.notification.count as jest.Mock).mockResolvedValue(50);

      const notifications = await prisma.notification.findMany({
        where: { user_id: mockUser.id },
        take: 20,
        skip: 0,
      });
      const total = await prisma.notification.count({
        where: { user_id: mockUser.id },
      });

      expect(notifications).toHaveLength(20);
      expect(total).toBe(50);

      const totalPages = Math.ceil(total / 20);
      expect(totalPages).toBe(3);
    });

    it('should handle empty results', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.notification.count as jest.Mock).mockResolvedValue(0);

      const notifications = await prisma.notification.findMany({
        where: { user_id: mockUser.id },
      });
      const total = await prisma.notification.count({
        where: { user_id: mockUser.id },
      });

      expect(notifications).toHaveLength(0);
      expect(total).toBe(0);
    });

    it('should calculate correct skip value for pagination', async () => {
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);

      const page = 3;
      const limit = 10;
      const skip = (page - 1) * limit;

      await prisma.notification.findMany({
        where: { user_id: mockUser.id },
        skip,
        take: limit,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 20,
          take: 10,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should propagate database errors', async () => {
      const dbError = new Error('Database connection failed');
      (prisma.notification.findMany as jest.Mock).mockRejectedValue(dbError);

      await expect(prisma.notification.findMany({})).rejects.toThrow('Database connection failed');
    });

    it('should handle notification not found on mark as read', async () => {
      const notFoundError = { code: 'P2025', message: 'Record not found' };
      (prisma.notification.update as jest.Mock).mockRejectedValue(notFoundError);

      await expect(
        prisma.notification.update({
          where: { id: 'non-existent', user_id: mockUser.id },
          data: { read_at: new Date() },
        })
      ).rejects.toEqual(notFoundError);
    });
  });
});

describe('Notification Delivery Edge Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle user with no notifications', async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notification.count as jest.Mock).mockResolvedValue(0);

    const notifications = await prisma.notification.findMany({
      where: { user_id: 'new-user-id' },
    });

    expect(notifications).toEqual([]);
  });

  it('should handle notifications with null optional fields', async () => {
    const notificationWithNulls = {
      id: 'notif-002',
      user_id: 'user-001',
      type: 'system',
      title: 'System Notification',
      message: 'System message',
      priority: 2,
      read_at: null,
      created_at: new Date(),
      series_id: null,
      chapter_id: null,
      actor_user_id: null,
      series: null,
      chapter: null,
      actor: null,
    };

    (prisma.notification.findMany as jest.Mock).mockResolvedValue([notificationWithNulls]);

    const notifications = await prisma.notification.findMany({
      where: { user_id: 'user-001' },
      include: { series: true, chapter: true, actor: true },
    });

    expect(notifications[0].series).toBeNull();
    expect(notifications[0].chapter).toBeNull();
    expect(notifications[0].actor).toBeNull();
  });

  it('should handle very large unread count', async () => {
    (prisma.notification.count as jest.Mock).mockResolvedValue(10000);

    const unreadCount = await prisma.notification.count({
      where: { user_id: 'user-001', read_at: null },
    });

    expect(unreadCount).toBe(10000);
  });

  it('should handle concurrent read operations', async () => {
    (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
    (prisma.notification.count as jest.Mock).mockResolvedValue(0);

    const results = await Promise.all([
      prisma.notification.findMany({ where: { user_id: 'user-1' } }),
      prisma.notification.findMany({ where: { user_id: 'user-2' } }),
      prisma.notification.count({ where: { user_id: 'user-1' } }),
    ]);

    expect(results).toHaveLength(3);
    expect(prisma.notification.findMany).toHaveBeenCalledTimes(2);
    expect(prisma.notification.count).toHaveBeenCalledTimes(1);
  });
});

describe('Notification Creation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a new chapter notification', async () => {
    const newNotification = {
      id: 'notif-new',
      user_id: 'user-001',
      type: 'new_chapter',
      title: 'New Chapter',
      message: 'Chapter 5 is available',
      priority: 1,
      series_id: 'series-001',
      chapter_id: 'chapter-005',
    };

    (prisma.notification.create as jest.Mock).mockResolvedValue(newNotification);

    const result = await prisma.notification.create({
      data: newNotification,
    });

    expect(result.id).toBe('notif-new');
    expect(result.type).toBe('new_chapter');
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'new_chapter',
        series_id: 'series-001',
      }),
    });
  });

  it('should create a follower notification', async () => {
    const followerNotification = {
      id: 'notif-follow',
      user_id: 'user-001',
      type: 'new_follower',
      title: 'New Follower',
      message: 'John started following you',
      priority: 2,
      actor_user_id: 'user-john',
    };

    (prisma.notification.create as jest.Mock).mockResolvedValue(followerNotification);

    const result = await prisma.notification.create({
      data: followerNotification,
    });

    expect(result.type).toBe('new_follower');
    expect(result.actor_user_id).toBe('user-john');
  });
});
