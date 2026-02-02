import { prisma, withRetry } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { PRODUCTION_QUERIES } from "./sql/production-queries";
import { checkAchievements, UnlockedAchievement } from "./gamification/achievements";

// FIX L2: Added maximum pagination limit constant
const MAX_PAGINATION_LIMIT = 100;

export type PaginationParams = {
  page?: number;
  limit?: number;
};

export type NotificationFilters = {
  unreadOnly?: boolean;
  type?: string;
};

export async function getNotifications(
  userId: string,
  { page = 1, limit = 20, unreadOnly = false, type }: PaginationParams & NotificationFilters = {}
) {
  // FIX L2: Enforce maximum limit
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  const skip = (page - 1) * safeLimit;
  const where: Prisma.NotificationWhereInput = {
    user_id: userId,
    ...(unreadOnly && { read_at: null }),
    ...(type && { type }),
  };

  const [items, total] = await withRetry(() => Promise.all([
    prisma.notification.findMany({
      where,
      orderBy: [
        { priority: "asc" },
        { created_at: "desc" }
      ],
      skip,
      take: safeLimit,
      include: {
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
        chapter: {
          select: {
            id: true,
            chapter_number: true,
            chapter_title: true,
          },
        },
        actor: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
          },
        },
      },
    }),
    prisma.notification.count({ where }),
  ]));

  const unreadCount = unreadOnly
    ? total
    : await withRetry(() => prisma.notification.count({
        where: { user_id: userId, read_at: null },
      }));

  return {
    items,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
    unreadCount,
  };
}

export async function markNotificationsAsRead(userId: string, notificationId?: string) {
  if (notificationId) {
    // FIX M1: Added user_id to where clause for ownership check
    return withRetry(() => prisma.notification.update({
      where: { 
        id: notificationId, 
        user_id: userId  // Ensure user owns this notification
      },
      data: { read_at: new Date() },
    }));
  }

  return withRetry(() => prisma.notification.updateMany({
    where: { user_id: userId, read_at: null },
    data: { read_at: new Date() },
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return withRetry(() => prisma.notification.count({
    where: { user_id: userId, read_at: null },
  }));
}

export async function getFollowers(
  username: string,
  { page = 1, limit = 20 }: PaginationParams = {},
  viewerId?: string
) {
  // FIX L2: Enforce maximum limit
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  const skip = (page - 1) * safeLimit;

  const user = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: username, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true, privacy_settings: true },
  }));

  if (!user) throw new Error("User not found");

  // Privacy check: if viewer is not the user themselves, check privacy settings
  if (viewerId !== user.id) {
    const privacySettings = user.privacy_settings as { followers_public?: boolean } | null;
    if (privacySettings?.followers_public === false) {
      throw new Error("Followers list is private");
    }
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.follow.findMany({
      where: { following_id: user.id },
      orderBy: { created_at: "desc" },
      skip,
      take: safeLimit,
      include: {
        follower: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
          },
        },
      },
    }),
    prisma.follow.count({ where: { following_id: user.id } }),
  ]));

  return {
    items: items.map((f) => f.follower),
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

export async function getFollowing(
  username: string,
  { page = 1, limit = 20 }: PaginationParams = {},
  viewerId?: string
) {
  // FIX L2: Enforce maximum limit
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  const skip = (page - 1) * safeLimit;

  const user = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: username, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true, privacy_settings: true },
  }));

  if (!user) throw new Error("User not found");

  // Privacy check: if viewer is not the user themselves, check privacy settings
  if (viewerId !== user.id) {
    const privacySettings = user.privacy_settings as { following_public?: boolean } | null;
    if (privacySettings?.following_public === false) {
      throw new Error("Following list is private");
    }
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.follow.findMany({
      where: { follower_id: user.id },
      orderBy: { created_at: "desc" },
      skip,
      take: safeLimit,
      include: {
        following: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
            bio: true,
          },
        },
      },
    }),
    prisma.follow.count({ where: { follower_id: user.id } }),
  ]));

  return {
    items: items.map((f) => f.following),
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  };
}

export async function checkFollowStatus(followerId: string, followingId: string): Promise<boolean> {
  const follow = await withRetry(() => prisma.follow.findUnique({
    where: {
      follower_id_following_id: {
        follower_id: followerId,
        following_id: followingId,
      },
    },
  }));

  return !!follow;
}

/**
 * Follow a user
 * 
 * Returns follow record with unlocked achievements for response contract compliance
 */
export async function followUser(followerId: string, targetUsername: string): Promise<{
  follow: any;
  unlockedAchievements: UnlockedAchievement[];
}> {
  const target = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: targetUsername, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true },
  }));

  if (!target) throw new Error("Target user not found");
  // FIX M4: Better error message for self-follow
  if (target.id === followerId) throw new Error("You cannot follow yourself");

  return withRetry(async () => {
    return prisma.$transaction(async (tx) => {
      // 1. Check if follow already exists
      const existingFollow = await tx.follow.findUnique({
        where: {
          follower_id_following_id: {
            follower_id: followerId,
            following_id: target.id,
          },
        },
      });

      if (existingFollow) {
        return { follow: existingFollow, unlockedAchievements: [] };
      }

      // 2. Create follow record
      const follow = await tx.follow.create({
        data: {
          follower_id: followerId,
          following_id: target.id,
        },
      });

      // 3. Create notification and activity
      // Check if notification already exists to avoid duplicates on retry
      const existingNotif = await tx.notification.findFirst({
        where: {
          user_id: target.id,
          actor_user_id: followerId,
          type: "new_follower",
          created_at: { gte: new Date(Date.now() - 30000) } // 30s window
        }
      });

      if (!existingNotif) {
        await tx.notification.create({
          data: {
            user_id: target.id,
            actor_user_id: followerId,
            type: "new_follower",
            title: "New Follower",
            message: "started following you",
          },
        });

        await tx.activity.create({
          data: {
            user_id: followerId,
            type: "user_followed",
            metadata: { following_id: target.id, following_username: targetUsername },
          },
        });
      }

      // 4. Check achievements for follow trigger (XP awarded internally)
      const unlockedAchievements: UnlockedAchievement[] = [];
      try {
        const achievements = await checkAchievements(tx, followerId, 'follow');
        unlockedAchievements.push(...achievements);
      } catch (achievementError) {
        console.error('Failed to check achievements:', achievementError);
      }

      return { follow, unlockedAchievements };
    });
  });
}


export async function unfollowUser(followerId: string, targetUsername: string) {
  const target = await withRetry(() => prisma.user.findFirst({
    where: { 
      username: { 
        equals: targetUsername, 
        mode: 'insensitive' 
      } 
    },
    select: { id: true },
  }));

  if (!target) throw new Error("Target user not found");

  const result = await withRetry(() => prisma.follow.deleteMany({
    where: {
      follower_id: followerId,
      following_id: target.id,
    },
  }));

  if (result.count > 0) {
    await prisma.activity.create({
      data: {
        user_id: followerId,
        type: "user_unfollowed",
        metadata: { following_id: target.id, following_username: targetUsername },
      },
    });
  }

  return result;
}


export async function getActivityFeed(
  userId: string | null,
  {
    page = 1,
    limit = 20,
    type = "global",
    viewerId,
  }: PaginationParams & {
    type?: "global" | "following" | "personal";
    viewerId?: string;
  } = {}
) {
  // FIX L2: Enforce maximum limit
  const safeLimit = Math.min(Math.max(1, limit), MAX_PAGINATION_LIMIT);
  const skip = (page - 1) * safeLimit;

  // Build where clause based on type
  let where: Prisma.ActivityWhereInput = {};
  
  if (type === "personal" && userId) {
    where = { user_id: userId };
  } else if (type === "following" && userId) {
    where = {
      OR: [
        { user_id: userId },
        { user: { followers: { some: { follower_id: userId } } } }
      ]
    };
  }
  // For "global", where remains empty (all activities)

  // Use optimized SQL for aggregate feed (user + following)
  if ((type === "following" || type === "personal") && userId && viewerId === userId) {
    const rawItems = await prisma.$queryRawUnsafe<any[]>(
      PRODUCTION_QUERIES.ACTIVITY_FEED,
      userId,
      safeLimit
    );

    // Get total count for pagination (using same logic as SQL)
    const total = await prisma.activity.count({ where });

    const { sanitizePrismaObject } = await import('@/lib/utils');
    return sanitizePrismaObject({
      items: rawItems, // BUG FIX: Use rawItems instead of undefined items
      pagination: {
        page,
        limit: safeLimit,
        total,
        totalPages: Math.ceil(total / safeLimit),
      },
    });
  }

  const [items, total] = await withRetry(() => Promise.all([
    prisma.activity.findMany({
      where, // BUG FIX: Use the defined where clause
      orderBy: { created_at: "desc" },
      skip,
      take: safeLimit,
      include: {
        user: {
          select: {
            id: true,
            username: true,
            avatar_url: true,
          },
        },
        series: {
          select: {
            id: true,
            title: true,
            cover_url: true,
          },
        },
        chapter: {
          select: {
            id: true,
            chapter_number: true,
            chapter_title: true,
          },
        },
      },
    }),
    prisma.activity.count({ where }),
  ]));

  const { sanitizePrismaObject } = await import('@/lib/utils');
  return sanitizePrismaObject({
    items,
    pagination: {
      page,
      limit: safeLimit,
      total,
      totalPages: Math.ceil(total / safeLimit),
    },
  });
}
