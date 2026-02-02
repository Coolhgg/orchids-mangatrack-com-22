import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { notificationDigestQueue } from '@/lib/queues';

const BATCH_SIZE = 50; // Users per job

/**
 * Notification Digest Processor
 * 1. Identifies users who are eligible for a digest based on their frequency.
 * 2. Groups their buffered notifications.
 * 3. Creates a single grouped notification for each user.
 * 4. Marks buffered entries as flushed.
 */
export async function processNotificationDigest(job: Job) {
  const now = new Date();

  // Find users who have unflushed entries in the buffer
  // and whose digest window has passed.
  // We check based on the OLDEST unflushed entry for each user.
  
    const eligibleUsers = await prisma.$queryRaw<Array<{ user_id: string, frequency: string }>>`
      SELECT DISTINCT u.id as user_id, u.notification_digest as frequency
      FROM users u
      JOIN notification_digest_buffer ndb ON ndb.user_id = u.id
      WHERE ndb.flushed_at IS NULL
      AND (
        (u.notification_digest = 'short' AND ndb.created_at <= ${now}::timestamptz - interval '10 minutes')
        OR (u.notification_digest = 'hourly' AND ndb.created_at <= ${now}::timestamptz - interval '1 hour')
        OR (u.notification_digest = 'daily' AND ndb.created_at <= ${now}::timestamptz - interval '24 hours')
      )
      LIMIT ${BATCH_SIZE}
    `;

  if (eligibleUsers.length === 0) {
    return { processed: 0 };
  }

  for (const { user_id, frequency } of eligibleUsers) {
    await processUserDigest(user_id, frequency);
  }

  // If we hit the batch size, enqueue another job immediately to process the rest
  if (eligibleUsers.length === BATCH_SIZE) {
    await notificationDigestQueue.add('process-more-digests', {}, { delay: 1000 });
  }

  return { processed: eligibleUsers.length };
}

async function processUserDigest(userId: string, frequency: string) {
  const now = new Date();

  // 1. Get all pending updates for this user
  const pendingUpdates = await prisma.notificationDigestBuffer.findMany({
    where: {
      user_id: userId,
      flushed_at: null,
    },
    include: {
      series: {
        select: { title: true }
      }
    },
    orderBy: {
      created_at: 'asc',
    },
  });

  if (pendingUpdates.length === 0) return;

  // 2. Group by series
  const seriesUpdates = new Map<string, { title: string, chapters: Set<string>, sources: Set<string> }>();
  
  for (const update of pendingUpdates) {
    const seriesId = update.series_id;
    if (!seriesUpdates.has(seriesId)) {
      seriesUpdates.set(seriesId, {
        title: update.series.title,
        chapters: new Set(),
        sources: new Set(),
      });
    }
    const group = seriesUpdates.get(seriesId)!;
    group.chapters.add(update.chapter_number.toString());
    update.source_names.forEach(s => group.sources.add(s));
  }

  // 3. Format Message
  let title = 'Update Digest';
  let message = '';
  const seriesList = Array.from(seriesUpdates.values());

  if (seriesList.length === 1) {
    const s = seriesList[0];
    const chapters = Array.from(s.chapters).sort((a, b) => Number(a) - Number(b));
    const sources = Array.from(s.sources);
    
    title = `Updates: ${s.title}`;
    if (chapters.length === 1) {
      message = `Chapter ${chapters[0]} is available on ${sources.join(', ')}.`;
    } else {
      message = `${chapters.length} new chapters (${chapters.join(', ')}) available on ${sources.join(', ')}.`;
    }
  } else {
    title = `${seriesList.length} Series Updated`;
    const seriesNames = seriesList.map(s => s.title);
    if (seriesNames.length <= 3) {
      message = `${seriesNames.join(', ')} have new chapters available.`;
    } else {
      message = `${seriesNames.slice(0, 2).join(', ')} and ${seriesNames.length - 2} others have new chapters available.`;
    }
  }

  // 4. Create Notification
  await prisma.$transaction([
    prisma.notification.create({
      data: {
        user_id: userId,
        type: 'DIGEST',
        title,
        message,
        metadata: {
          frequency,
          series_count: seriesList.length,
          series_ids: Array.from(seriesUpdates.keys()),
        },
      },
    }),
    // 5. Mark as flushed
    prisma.notificationDigestBuffer.updateMany({
      where: {
        user_id: userId,
        flushed_at: null,
        created_at: {
          lte: pendingUpdates[pendingUpdates.length - 1].created_at, // Only flush what we processed
        },
      },
      data: {
        flushed_at: now,
      },
    }),
  ]);

  console.log(`[Notification-Digest] Flushed digest for user ${userId} (${seriesList.length} series)`);
}
