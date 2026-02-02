import { getUserAchievementStats, calculateAchievementProgress } from '@/lib/gamification/achievement-progress';
import { prisma, TransactionClient } from '@/lib/prisma';

describe('Achievement Progress Logic', () => {
  const mockUserId = 'test-user-uuid';

  it('should calculate progress percentage correctly', () => {
    const stats = {
      chapters_read: 75,
      completed_count: 2,
      library_count: 10,
      follow_count: 5,
      streak_days: 3
    };

    const achievement = {
      id: 'ach-1',
      code: 'reader_100',
      name: 'Centurion',
      description: 'Read 100 chapters',
      rarity: 'rare',
      xp_reward: 500,
      is_hidden: false,
      is_seasonal: false,
      criteria: { type: 'chapter_count', threshold: 100 }
    };

    const progress = calculateAchievementProgress(achievement, stats, false, null);

    expect(progress).not.toBeNull();
    expect(progress?.progressPercent).toBe(75);
    expect(progress?.currentValue).toBe(75);
    expect(progress?.isUnlocked).toBe(false);
  });

  it('should cap progress at 100%', () => {
    const stats = {
      chapters_read: 150,
      completed_count: 0,
      library_count: 0,
      follow_count: 0,
      streak_days: 0
    };

    const achievement = {
      id: 'ach-1',
      code: 'reader_100',
      name: 'Centurion',
      description: 'Read 100 chapters',
      rarity: 'rare',
      xp_reward: 500,
      is_hidden: false,
      is_seasonal: false,
      criteria: { type: 'chapter_count', threshold: 100 }
    };

    const progress = calculateAchievementProgress(achievement, stats, false, null);

    expect(progress?.progressPercent).toBe(100);
  });

  it('should handle missing stats with defaults', async () => {
    // Mock prisma responses
    (prisma.user.findUnique as jest.Mock) = jest.fn().mockResolvedValue(null);
    (prisma.libraryEntry.count as jest.Mock) = jest.fn().mockResolvedValue(0);
    (prisma.follow.count as jest.Mock) = jest.fn().mockResolvedValue(0);

    const stats = await getUserAchievementStats(prisma as unknown as TransactionClient, mockUserId);

    expect(stats.chapters_read).toBe(0);
    expect(stats.completed_count).toBe(0);
  });
});
