import { prisma } from './prisma';

/**
 * Schedules notifications for a chapter update.
 * Implements deferred timing and deduplication logic.
 * SECURITY: Uses parameterized query to prevent SQL injection.
 */
export async function scheduleNotification(chapterId: string, delayMinutes: number = 10) {
  // SECURITY: Validate delayMinutes to prevent SQL injection via interval
  const safeDelayMinutes = Math.min(Math.max(1, Math.floor(delayMinutes)), 1440); // Max 24 hours
  
  // SECURITY: Use tagged template literal for parameterized query
  return await prisma.$executeRaw`
    INSERT INTO notifications_queue (
      user_id, 
      series_id, 
      chapter_id, 
      notify_after
    )
    SELECT 
      le.user_id, 
      le.series_id, 
      c.id as chapter_id,
      now() + (${safeDelayMinutes} * interval '1 minute')
    FROM chapters c
    JOIN library_entries le ON le.series_id = c.series_id
    WHERE c.id = ${chapterId}::uuid
      AND le.notify_new_chapters = true
      AND le.status != 'dropped'
      AND le.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM user_chapter_reads r
        WHERE r.user_id = le.user_id AND r.chapter_id = c.id
      )
    ON CONFLICT (user_id, chapter_id) DO NOTHING;
  `;
}

/**
 * Fetches notifications that are ready to be sent.
 * Includes a Just-In-Time check to ensure the user hasn't read the chapter during the delay.
 * SECURITY: Uses parameterized query to prevent SQL injection.
 */
export async function fetchPendingNotifications(batchSize: number = 100) {
  // SECURITY: Validate batchSize to prevent abuse
  const safeBatchSize = Math.min(Math.max(1, Math.floor(batchSize)), 1000);
  
  // SECURITY: Use tagged template literal for parameterized query
  return await prisma.$queryRaw<Array<{
    id: string;
    user_id: string;
    series_id: string;
    chapter_id: string;
    notify_after: Date;
    series_title: string;
    chapter_number: string;
  }>>`
    WITH pending AS (
      SELECT q.id, q.user_id, q.series_id, q.chapter_id, q.notify_after
      FROM notifications_queue q
      WHERE q.notify_after <= now()
        AND q.sent_at IS NULL
      LIMIT ${safeBatchSize}
      FOR UPDATE SKIP LOCKED
    )
    SELECT 
      p.*,
      s.title as series_title,
      c.chapter_number
    FROM pending p
      JOIN series s ON s.id = p.series_id
      JOIN chapters c ON c.id = p.chapter_id
      WHERE NOT EXISTS (
        SELECT 1 FROM user_chapter_reads r
        WHERE r.user_id = p.user_id AND r.chapter_id = p.chapter_id
      );
  `;
}

/**
 * Marks a batch of notifications as sent.
 */
export async function markNotificationsAsSent(ids: string[]) {
  if (ids.length === 0) return;
  
  return await prisma.notificationQueue.updateMany({
    where: {
      id: { in: ids }
    },
    data: {
      sent_at: new Date()
    }
  });
}
