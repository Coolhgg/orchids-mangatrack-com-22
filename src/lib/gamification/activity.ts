
import { TransactionClient } from '../prisma';

export type ActivityType = 
  | 'series_added' 
  | 'series_completed' 
  | 'chapter_read' 
  | 'achievement_unlocked'
  | 'seasonal_achievement_unlocked'
  | 'follow'
  | 'status_updated'
  | 'library_removed'
  | 'library_import';

async function incrementActiveDaysIfNeeded(
  tx: TransactionClient,
  userId: string
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];
  
  const user = await tx.user.findUnique({
    where: { id: userId },
    select: { last_active_date: true }
  });
  
  const lastActiveStr = user?.last_active_date 
    ? new Date(user.last_active_date).toISOString().split('T')[0]
    : null;
  
  if (lastActiveStr !== todayStr) {
    await tx.user.update({
      where: { id: userId },
      data: { 
        active_days: { increment: 1 },
        last_active_date: today
      }
    });
  }
}

/**
 * Logs an activity within a Prisma transaction
 */
export async function logActivity(
  tx: TransactionClient,
  userId: string,
  type: ActivityType,
  data: {
    seriesId?: string;
    chapterId?: string;
    achievementId?: string;
    metadata?: any;
  }
) {
  await incrementActiveDaysIfNeeded(tx, userId);
  
  return await tx.activity.create({
    data: {
      user_id: userId,
      type: type,
      series_id: data.seriesId,
      chapter_id: data.chapterId,
      achievement_id: data.achievementId,
      metadata: data.metadata || {},
    },
  });
}
