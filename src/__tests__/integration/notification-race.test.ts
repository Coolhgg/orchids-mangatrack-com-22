import { processNotification } from '@/workers/processors/notification.processor';
import { processNotificationDelivery } from '@/workers/processors/notification-delivery.processor';
import { prisma } from '@/lib/prisma';
import { notificationDeliveryQueue, notificationDeliveryPremiumQueue, isQueueHealthy, getNotificationSystemHealth } from '@/lib/queues';
import { shouldNotifyChapter, shouldThrottleUser } from '@/lib/notifications-throttling';

// Mock dependencies
jest.mock('@/lib/prisma', () => ({
  prisma: {
    seriesSource: { findUnique: jest.fn() },
    libraryEntry: { findMany: jest.fn() },
    userChapterReadV2: { findMany: jest.fn() },
    notification: { findMany: jest.fn(), createMany: jest.fn() },
    series: { findUnique: jest.fn() },
    $executeRaw: jest.fn(),
  },
  withRetry: jest.fn((fn) => fn()),
}));

jest.mock('@/lib/queues', () => ({
  notificationDeliveryQueue: { add: jest.fn() },
  notificationDeliveryPremiumQueue: { add: jest.fn() },
  notificationQueue: { add: jest.fn() },
  isQueueHealthy: jest.fn().mockResolvedValue(true),
  getNotificationSystemHealth: jest.fn().mockResolvedValue({ isRejected: false, isOverloaded: false, isCritical: false }),
}));

jest.mock('@/lib/notifications-throttling', () => ({
  shouldNotifyChapter: jest.fn().mockResolvedValue(true),
  shouldThrottleUser: jest.fn().mockResolvedValue({ throttle: false }),
}));

describe('Notification Race Condition Fixes', () => {
  const seriesId = '00000000-0000-0000-0000-000000000001';
  const sourceId = '00000000-0000-0000-0000-000000000002';
  const userId = '00000000-0000-0000-0000-000000000003';
  const chapterNumber = 10;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Pre-emptive Read Race (Fan-out Filter)', () => {
    it('should NOT include users who have already read the chapter in fan-out', async () => {
      // Mock subscribers
      (prisma.libraryEntry.findMany as jest.Mock).mockResolvedValue([
        {
          user_id: userId,
          notification_mode: 'immediate',
          user: { notification_digest: 'immediate', subscription_tier: 'free' }
        }
      ]);

      const mockJob = {
        data: {
          seriesId,
          sourceId,
          sourceName: 'Test Source',
          chapterNumber,
          newChapterCount: 1
        }
      } as any;

      await processNotification(mockJob);

      // Verify Prisma query included the read-check filter
      expect(prisma.libraryEntry.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            user: {
              chapter_reads_v2: {
                none: {
                  chapter: {
                    series_id: seriesId,
                    chapter_number: chapterNumber
                  }
                }
              }
            }
          })
        })
      );
    });
  });

  describe('Fan-out Latency Gap (Delivery Check)', () => {
    it('should NOT create notification if user read chapter after fan-out but before delivery', async () => {
      // Mock series
      (prisma.series.findUnique as jest.Mock).mockResolvedValue({ title: 'Test Series' });
      
      // Mock existing notifications (none)
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      
      // Mock already read check (USER READ IT!)
      (prisma.userChapterReadV2.findMany as jest.Mock).mockResolvedValue([
        { user_id: userId }
      ]);

      const mockJob = {
        data: {
          seriesId,
          sourceId,
          sourceName: 'Test Source',
          chapterNumber,
          newChapterCount: 1,
          userIds: [userId],
          isPremium: false
        }
      } as any;

      await processNotificationDelivery(mockJob);

      // Verify no notification was created
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    });

    it('should create notification if user has NOT read chapter', async () => {
      (prisma.series.findUnique as jest.Mock).mockResolvedValue({ title: 'Test Series' });
      (prisma.notification.findMany as jest.Mock).mockResolvedValue([]);
      
      // Mock already read check (EMPTY)
      (prisma.userChapterReadV2.findMany as jest.Mock).mockResolvedValue([]);

      const mockJob = {
        data: {
          seriesId,
          sourceId,
          sourceName: 'Test Source',
          chapterNumber,
          newChapterCount: 1,
          userIds: [userId],
          isPremium: false
        }
      } as any;

      await processNotificationDelivery(mockJob);

      // Verify notification WAS created
      expect(prisma.notification.createMany).toHaveBeenCalledWith({
        data: expect.arrayContaining([
          expect.objectContaining({ user_id: userId })
        ])
      });
    });
  });
});
