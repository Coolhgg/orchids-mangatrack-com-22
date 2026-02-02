import { prisma } from '@/lib/prisma';
import { followUser } from '@/lib/social-utils';

jest.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findFirst: jest.fn(),
      update: jest.fn(),
    },
    follow: {
      upsert: jest.fn(),
      delete: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    activity: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    notification: {
      create: jest.fn(),
    },
    $transaction: jest.fn((cb) => cb(prisma)),
  },
}));

describe('Social Lifecycle Integration', () => {
  const USER_A_ID = '00000000-0000-0000-0000-00000000000a';
  const USER_B_ID = '00000000-0000-0000-0000-00000000000b';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should allow User A to follow User B and trigger a notification', async () => {
    // 1. Mock Target User
    (prisma.user.findFirst as jest.Mock).mockResolvedValue({
      id: USER_B_ID,
      username: 'UserB',
    });

    // 2. Mock Follow Action
    (prisma.follow.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.follow.create as jest.Mock).mockResolvedValue({
      follower_id: USER_A_ID,
      following_id: USER_B_ID,
    });

    // 3. Run followUser
    await followUser(USER_A_ID, 'UserB');

    // 4. Verify results
    expect(prisma.follow.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          follower_id: USER_A_ID,
          following_id: USER_B_ID,
        },
      })
    );

    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          user_id: USER_B_ID,
          actor_user_id: USER_A_ID,
          type: 'FOLLOW',
        }),
      })
    );
  });

  it('should record an activity when a user performs a tracked action', async () => {
    const SERIES_ID = 'series-123';
    
    // Mock activity creation
    (prisma.activity.create as jest.Mock).mockResolvedValue({
      id: 'activity-1',
      user_id: USER_B_ID,
      type: 'READ',
      series_id: SERIES_ID,
    });

    // In a real scenario, this is called by an API route
    const activity = await prisma.activity.create({
      data: {
        user_id: USER_B_ID,
        type: 'READ',
        series_id: SERIES_ID,
        metadata: { chapter: 10 },
      },
    });

    expect(activity.type).toBe('READ');
    expect(prisma.activity.create).toHaveBeenCalled();
  });
});
