import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { notificationDeliveryQueue, notificationDeliveryPremiumQueue } from '@/lib/queues';

/**
 * Processor for Notification Timing Queue.
 * Implements the "Exact Notification Timing" logic:
 * - Deferred delivery (10m window)
 * - Source grouping (notifying per chapter, not per source)
 * - Just-in-time read check
 * - Deduplication
 */
export async function processNotificationTiming(job: Job) {
  // 1. Fetch pending notifications in batches
  // We use FOR UPDATE SKIP LOCKED to allow concurrent workers
  const pending = await prisma.$queryRaw<any[]>`
    WITH pending AS (
      SELECT q.id, q.user_id, q.series_id, q.chapter_id, q.notify_after
      FROM notifications_queue q
      WHERE q.notify_after <= now()
        AND q.sent_at IS NULL
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    )
    SELECT 
      p.*,
      s.title as series_title,
      c.chapter_number
    FROM pending p
    JOIN series s ON s.id = p.series_id
    JOIN chapters c ON c.id = p.chapter_id
    -- FINAL CHECK: Ensure user hasn't read the chapter in the last 10 minutes
    WHERE NOT EXISTS (
      SELECT 1 FROM user_chapter_reads_v2 r
      WHERE r.user_id = p.user_id 
        AND r.chapter_id = p.chapter_id
        AND r.is_read = true
    );
  `;

  if (pending.length === 0) {
    console.log('[NotificationTiming] No pending notifications to process');
    return { count: 0 };
  }

  const ids = pending.map(p => p.id);

  // 2. Mark as sent immediately to avoid double processing
  await prisma.$executeRaw`
    UPDATE notifications_queue 
    SET sent_at = now() 
    WHERE id = ANY(${ids}::uuid[]);
  `;

  // 3. Group by (seriesId, chapterId) to batch delivery
  const groups = new Map<string, any[]>();
  for (const item of pending) {
    const key = `${item.series_id}:${item.chapter_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  let totalDispatched = 0;

  for (const [key, items] of groups.entries()) {
    const [seriesId, chapterId] = key.split(':');
    const firstItem = items[0];

    // Find the best available source for this chapter to use in the notification
    const bestSource = await prisma.chapterSource.findFirst({
      where: {
        chapter_id: chapterId,
        is_available: true,
      },
      include: {
        series_source: true,
      },
      orderBy: {
        detected_at: 'asc', // Use the first source found
      },
    });

    if (!bestSource) {
      console.warn(`[NotificationTiming] No available source found for chapter ${chapterId}, skipping delivery`);
      continue;
    }

    // Split users by premium status
    const users = await prisma.user.findMany({
      where: { id: { in: items.map(i => i.user_id) } },
      select: { id: true, subscription_tier: true, notification_settings: true },
    });

    const premiumUserIds: string[] = [];
    const freeUserIds: string[] = [];
    const premiumPushUserIds: string[] = [];
    const freePushUserIds: string[] = [];

    for (const user of users) {
      const isPremium = user.subscription_tier !== 'free';
      const pushEnabled = (user.notification_settings as any)?.push ?? false;

      if (isPremium) {
        premiumUserIds.push(user.id);
        if (pushEnabled) premiumPushUserIds.push(user.id);
      } else {
        freeUserIds.push(user.id);
        if (pushEnabled) freePushUserIds.push(user.id);
      }
    }

    const commonPayload = {
      seriesId,
      sourceId: bestSource.series_source_id,
      sourceName: bestSource.series_source.source_name,
      chapterNumber: parseFloat(firstItem.chapter_number),
      newChapterCount: 1,
    };

    // Dispatch to delivery queues
    if (premiumUserIds.length > 0) {
      await notificationDeliveryPremiumQueue.add(
        `timing-premium-${seriesId}-${chapterId}`,
        {
          ...commonPayload,
          userIds: premiumUserIds,
          pushUserIds: premiumPushUserIds,
          isPremium: true,
          priority: 0, // P0 because it's usually series the user is reading
        },
        { removeOnComplete: true, priority: 1 }
      );
    }

    if (freeUserIds.length > 0) {
      await notificationDeliveryQueue.add(
        `timing-free-${seriesId}-${chapterId}`,
        {
          ...commonPayload,
          userIds: freeUserIds,
          pushUserIds: freePushUserIds,
          isPremium: false,
          priority: 0,
        },
        { removeOnComplete: true, priority: 10 }
      );
    }

    totalDispatched += items.length;
  }

  console.log(`[NotificationTiming] Dispatched ${totalDispatched} notifications across ${groups.size} chapters`);
  return { count: totalDispatched };
}
