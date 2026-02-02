import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { shouldThrottleUser } from '@/lib/notifications-throttling';
import { getNotificationSystemHealth } from '@/lib/queues';
import { z } from 'zod';

const NotificationDeliveryDataSchema = z.object({
  seriesId: z.string().uuid(),
  sourceId: z.string().uuid(),
  sourceName: z.string().optional(),
    chapterNumber: z.number(),
    newChapterCount: z.number().int().positive(),
    userIds: z.array(z.string().uuid()),
    pushUserIds: z.array(z.string().uuid()).optional(),
    isPremium: z.boolean().default(false),
    priority: z.number().int().min(0).max(2).default(2),
  });

export type NotificationDeliveryData = z.infer<typeof NotificationDeliveryDataSchema>;

/**
 * Delivery Processor
 * 1. Implements Circuit Breakers based on system health.
 * 2. Checks per-user and per-manga throttling.
 * 3. Creates notifications in the DB.
 * 4. Gracefully degrades (Lite Mode) under load.
 */
export async function processNotificationDelivery(job: Job<NotificationDeliveryData>) {
  const parseResult = NotificationDeliveryDataSchema.safeParse(job.data);
  if (!parseResult.success) {
    console.error(`[Notification-Delivery] Invalid payload: ${parseResult.error.message}`);
    return;
  }

    const { seriesId, sourceId, sourceName, chapterNumber, newChapterCount, userIds, pushUserIds = [], isPremium, priority } = parseResult.data;


  // 1. Circuit Breaker / Overload Check
  const health = await getNotificationSystemHealth();
  
  if (health.isRejected && !isPremium) {
    console.error(`[Notification-Delivery] CIRCUIT BREAKER: System at capacity (${health.totalWaiting} waiting). Rejecting free job.`);
    return;
  }

  if (health.isOverloaded) {
    console.warn(`[Notification-Delivery] System overloaded (${health.totalWaiting} waiting). Applying 5s throttle delay.`);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const isLiteMode = health.isCritical; // Skip metadata if > 50K jobs
  if (isLiteMode) {
    console.warn(`[Notification-Delivery] LITE MODE ENABLED: Skipping metadata and detailed messages due to backlog.`);
  }

  const series = await prisma.series.findUnique({
    where: { id: seriesId },
    select: { title: true, last_chapter_at: true }
  });

  if (!series) {
    console.warn(`[Notification-Delivery] Series ${seriesId} not found, skipping batch`);
    return;
  }

  // SAFEGUARD: Don't send push for very old chapters (Stale updates)
  const isStale = series.last_chapter_at && (Date.now() - new Date(series.last_chapter_at).getTime() > 7 * 24 * 60 * 60 * 1000);

    const notificationsToCreate: Array<{
      user_id: string;
      type: string;
      title: string;
      series_id: string;
      message: string;
      metadata: Record<string, unknown>;
      priority: number;
    }> = [];
    const pushDeliveriesToTrigger: Array<{
      userId: string;
      title: string;
      body: string;
      metadata: Record<string, unknown>;
    }> = [];

    // 2. Fetch existing notifications to prevent duplicates and implement priority suppression
    const existingNotifications = await prisma.notification.findMany({
      where: {
        user_id: { in: userIds },
        series_id: seriesId,
        type: 'NEW_CHAPTER',
        metadata: {
          path: ['chapter_number'],
          equals: chapterNumber
        }
      },
      select: { user_id: true, priority: true, id: true }
    });

    const userNotificationMap = new Map<string, { priority: number, id: string }>();
    existingNotifications.forEach(n => {
      userNotificationMap.set(n.user_id, { priority: n.priority ?? 2, id: n.id });
    });

    // ...

    const notificationsToDelete: string[] = [];
    const pushUserIdSet = new Set(pushUserIds);

    // BUG 87: Use bounded concurrency (batching) to prevent event loop starvation 
    // when processing thousands of users for a single series.
    const BATCH_SIZE = 50;
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      const batch = userIds.slice(i, i + BATCH_SIZE);
      
      await Promise.all(batch.map(async (userId) => {
        const existing = userNotificationMap.get(userId);
        
        // Suppression Logic:
        // 1. If higher or equal priority already exists, skip creating the new one
        if (existing && existing.priority <= priority) {
          return;
        }

        // 2. If lower priority exists, we'll replace it with the new higher priority one
        if (existing && existing.priority > priority) {
          notificationsToDelete.push(existing.id);
        }

        // Check throttling
        const { throttle, reason } = await shouldThrottleUser(userId, seriesId, isPremium);
      
        if (throttle) {
          // Log only occasionally to prevent log spam
          if (Math.random() < 0.1) {
            console.log(`[Notification-Delivery] Throttled user ${userId} for series ${seriesId}. Reason: ${reason}`);
          }
          return;
        }

        notificationsToCreate.push({
          user_id: userId,
          type: 'NEW_CHAPTER',
          title: 'New Chapter Available',
          message: isLiteMode 
            ? `New update for ${series.title}`
            : `${newChapterCount} new chapter${newChapterCount > 1 ? 's' : ''} for "${series.title}"${sourceName ? ` on ${sourceName}` : ''}!`,
          series_id: seriesId,
          priority: priority,
          metadata: {
            source_id: sourceId,
            source_name: sourceName,
            chapter_count: newChapterCount,
            chapter_number: chapterNumber,
            delivery_job_id: job.id,
            is_lite: isLiteMode
          }
        });

        // PUSH DELIVERY LOGIC
        if (pushUserIdSet.has(userId) && !isStale) {
          pushDeliveriesToTrigger.push({
            userId,
            title: `New chapter of ${series.title}!`,
            body: `Chapter ${chapterNumber} is now available${sourceName ? ` on ${sourceName}` : ''}.`,
            metadata: { seriesId, chapterNumber }
          });
        }
      }));
    }


  if (notificationsToDelete.length > 0) {
    await prisma.notification.deleteMany({
      where: { id: { in: notificationsToDelete } }
    });
    console.log(`[Notification-Delivery] Suppressed/Deleted ${notificationsToDelete.length} lower priority notifications`);
  }

  if (notificationsToCreate.length > 0) {
    try {
      await prisma.notification.createMany({
        data: notificationsToCreate,
      });
      console.log(`[Notification-Delivery] Created ${notificationsToCreate.length} notifications for "${series.title}"${isLiteMode ? ' (Lite Mode)' : ''}`);
      
      // TRIGGER EXTERNAL PUSH (Simulated/Place-holder for actual provider)
      if (pushDeliveriesToTrigger.length > 0) {
        console.log(`[Notification-Delivery] Triggering ${pushDeliveriesToTrigger.length} external PUSH notifications for "${series.title}"`);
        // In a real implementation, this would call FCM/WebPush/OneSignal/etc.
        // For now, we log the fan-out prevention:
        const sample = pushDeliveriesToTrigger[0];
        console.log(`[Notification-Push] Sample Push for ${sample.userId}: ${sample.title} - ${sample.body}`);
      }
    } catch (error) {
      console.error(`[Notification-Delivery] DB Write Failure:`, error);
      // BullMQ will automatically retry the job based on the queue's defaultJobOptions.
      throw error; 
    }
  } else {
    console.log(`[Notification-Delivery] No notifications created for batch in "${series.title}" (all throttled or suppressed)`);
  }
}
