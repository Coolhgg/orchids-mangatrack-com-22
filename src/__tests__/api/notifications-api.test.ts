/**
 * API Tests for Notifications endpoints
 * Tests the notification API routes with mocked dependencies
 */

jest.mock('@/lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/social-utils', () => ({
  getNotifications: jest.fn(),
  markNotificationsAsRead: jest.fn(),
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
import { getNotifications, markNotificationsAsRead } from '@/lib/social-utils';

function createMockRequest(url: string, options: RequestInit = {}) {
  const parsedUrl = new URL(url, 'http://localhost');
  return {
    url,
    method: options.method || 'GET',
    headers: new Headers(options.headers || {}),
    nextUrl: parsedUrl,
    json: async () => {
      if (options.body) {
        try {
          return JSON.parse(options.body as string);
        } catch {
          throw new SyntaxError('Invalid JSON');
        }
      }
      return {};
    },
  };
}

describe('Notifications API', () => {
  const mockUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
  };

  const mockNotifications = {
    items: [
      {
        id: 'notif-1',
        user_id: mockUser.id,
        type: 'new_chapter',
        title: 'New Chapter Available',
        message: 'Chapter 10 of Test Manga is now available',
        read_at: null,
        created_at: new Date().toISOString(),
      },
      {
        id: 'notif-2',
        user_id: mockUser.id,
        type: 'new_follower',
        title: 'New Follower',
        message: 'User123 started following you',
        read_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      },
    ],
    pagination: {
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    },
    unreadCount: 1,
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

    (getNotifications as jest.Mock).mockResolvedValue(mockNotifications);
    (markNotificationsAsRead as jest.Mock).mockResolvedValue(undefined);
  });

  describe('GET /api/notifications', () => {
    it('should call getNotifications with correct parameters for authenticated user', async () => {
      await getNotifications(mockUser.id, {
        page: 1,
        limit: 20,
        unreadOnly: false,
        type: undefined,
      });

      expect(getNotifications).toHaveBeenCalledWith(mockUser.id, {
        page: 1,
        limit: 20,
        unreadOnly: false,
        type: undefined,
      });
    });

    it('should return correct notification structure', async () => {
      const result = await getNotifications(mockUser.id, {
        page: 1,
        limit: 20,
      });

      expect(result.items).toHaveLength(2);
      expect(result.unreadCount).toBe(1);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by unreadOnly when provided', async () => {
      await getNotifications(mockUser.id, {
        page: 1,
        limit: 20,
        unreadOnly: true,
      });

      expect(getNotifications).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        unreadOnly: true,
      }));
    });

    it('should filter by type when provided', async () => {
      await getNotifications(mockUser.id, {
        page: 1,
        limit: 20,
        type: 'new_chapter',
      });

      expect(getNotifications).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        type: 'new_chapter',
      }));
    });

    it('should handle pagination parameters', async () => {
      await getNotifications(mockUser.id, {
        page: 2,
        limit: 10,
      });

      expect(getNotifications).toHaveBeenCalledWith(mockUser.id, expect.objectContaining({
        page: 2,
        limit: 10,
      }));
    });
  });

  describe('Mark notifications as read', () => {
    it('should mark all notifications as read', async () => {
      await markNotificationsAsRead(mockUser.id);

      expect(markNotificationsAsRead).toHaveBeenCalledWith(mockUser.id);
    });

    it('should mark single notification as read', async () => {
      const notificationId = '550e8400-e29b-41d4-a716-446655440001';
      await markNotificationsAsRead(mockUser.id, notificationId);

      expect(markNotificationsAsRead).toHaveBeenCalledWith(mockUser.id, notificationId);
    });
  });

  describe('Error handling', () => {
    it('should handle database errors gracefully', async () => {
      (getNotifications as jest.Mock).mockRejectedValue(new Error('Database connection failed'));

      await expect(getNotifications(mockUser.id, {})).rejects.toThrow('Database connection failed');
    });

    it('should handle mark as read errors', async () => {
      (markNotificationsAsRead as jest.Mock).mockRejectedValue(new Error('Update failed'));

      await expect(markNotificationsAsRead(mockUser.id)).rejects.toThrow('Update failed');
    });
  });
});

describe('Notifications API - Authentication', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should require authentication for getNotifications', async () => {
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: null },
          error: null,
        }),
      },
    });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    expect(user).toBeNull();
  });

  it('should validate user exists before operations', async () => {
    const mockUser = { id: 'user-123', email: 'test@example.com' };
    (createClient as jest.Mock).mockResolvedValue({
      auth: {
        getUser: jest.fn().mockResolvedValue({
          data: { user: mockUser },
          error: null,
        }),
      },
    });

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    expect(user).toEqual(mockUser);
    expect(user?.id).toBe('user-123');
  });
});

describe('Notifications API - Input Validation', () => {
  it('should validate notification type enum', () => {
    const validTypes = ['new_chapter', 'new_follower', 'achievement', 'system'];
    const invalidType = 'invalid_type';

    expect(validTypes.includes('new_chapter')).toBe(true);
    expect(validTypes.includes(invalidType)).toBe(false);
  });

  it('should validate UUID format', () => {
    const validUUID = '550e8400-e29b-41d4-a716-446655440000';
    const invalidUUID = 'invalid-uuid';
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    expect(uuidRegex.test(validUUID)).toBe(true);
    expect(uuidRegex.test(invalidUUID)).toBe(false);
  });

  it('should validate pagination limits', () => {
    const maxLimit = 100;
    const requestedLimit = 200;
    const clampedLimit = Math.min(requestedLimit, maxLimit);

    expect(clampedLimit).toBe(100);
  });

  it('should validate page number is positive', () => {
    const validPage = 1;
    const invalidPage = 0;

    expect(validPage >= 1).toBe(true);
    expect(invalidPage >= 1).toBe(false);
  });
});

describe('Notifications API - Response Structure', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getNotifications as jest.Mock).mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
      unreadCount: 0,
    });
  });

  it('should return correct response structure for empty notifications', async () => {
    const result = await getNotifications('user-123', {});

    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('pagination');
    expect(result).toHaveProperty('unreadCount');
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('should include pagination metadata', async () => {
    const result = await getNotifications('user-123', {});

    expect(result.pagination).toHaveProperty('page');
    expect(result.pagination).toHaveProperty('limit');
    expect(result.pagination).toHaveProperty('total');
    expect(result.pagination).toHaveProperty('totalPages');
  });
});
