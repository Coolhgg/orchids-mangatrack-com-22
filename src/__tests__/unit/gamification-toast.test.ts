import { showGamificationToasts, GamificationEvent } from '@/lib/toast';
import { toast } from 'sonner';

jest.mock('sonner', () => ({
  toast: {
    success: jest.fn(),
    error: jest.fn(),
  },
}));

describe('Gamification Toast System', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('showGamificationToasts', () => {
    it('CASE 1: Shows XP toast for basic chapter read', () => {
      const event: GamificationEvent = {
        xp_gained: 10,
        streak_bonus: 0,
        streak_days: 1,
        level_up: null,
        achievements_unlocked: [],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith('+10 XP', { duration: 3000 });
    });

    it('CASE 2: Shows achievement toast when unlocked', () => {
      const event: GamificationEvent = {
        xp_gained: 60,
        streak_bonus: 0,
        streak_days: 1,
        level_up: null,
        achievements_unlocked: [{ name: 'First Read', xp_reward: 50 }],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        'Achievement Unlocked: First Read (+50 XP)',
        { duration: 4000 }
      );
    });

    it('CASE 3: Stacks multiple achievements', () => {
      const event: GamificationEvent = {
        xp_gained: 100,
        streak_bonus: 0,
        streak_days: 1,
        level_up: null,
        achievements_unlocked: [
          { name: 'First Read', xp_reward: 50 },
          { name: 'Streak Starter', xp_reward: 25 },
        ],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      expect(toast.success).toHaveBeenCalledTimes(2);
    });

    it('CASE 4: Level up takes priority and stacks with achievements', () => {
      const event: GamificationEvent = {
        xp_gained: 100,
        streak_bonus: 0,
        streak_days: 5,
        level_up: 2,
        achievements_unlocked: [{ name: 'Level 2', xp_reward: 100 }],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      // Level up + achievement should both show (no base XP suppressed)
      expect(toast.success).toHaveBeenCalledTimes(2);
      expect(toast.success).toHaveBeenNthCalledWith(
        1,
        'Level Up! You reached Level 2',
        { duration: 4000 }
      );
    });

    it('CASE 5: Streak milestone shows correctly', () => {
      const event: GamificationEvent = {
        xp_gained: 10,
        streak_bonus: 5,
        streak_days: 7,
        level_up: null,
        achievements_unlocked: [],
        streak_milestone: 7,
      };

      showGamificationToasts(event);

      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        '7-Day Streak! Keep it up!',
        { duration: 4000 }
      );
    });

    it('CASE 6: Shows streak bonus when no major event', () => {
      const event: GamificationEvent = {
        xp_gained: 10,
        streak_bonus: 5,
        streak_days: 3,
        level_up: null,
        achievements_unlocked: [],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        '+5 XP (3-day Streak)',
        { duration: 3000 }
      );
    });

    it('CASE 7: Suppresses base XP when major event occurs', () => {
      const event: GamificationEvent = {
        xp_gained: 10,
        streak_bonus: 5,
        streak_days: 3,
        level_up: 5,
        achievements_unlocked: [],
        streak_milestone: null,
      };

      showGamificationToasts(event);

      // Only level up should show, not base XP or streak bonus
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(toast.success).toHaveBeenCalledWith(
        'Level Up! You reached Level 5',
        { duration: 4000 }
      );
    });

    it('CASE 8: Handles null/undefined values gracefully', () => {
      const event: GamificationEvent = {
        xp_gained: null,
        streak_bonus: null,
        streak_days: null,
        level_up: null,
        achievements_unlocked: null,
        streak_milestone: null,
      };

      expect(() => showGamificationToasts(event)).not.toThrow();
      expect(toast.success).not.toHaveBeenCalled();
    });

    it('CASE 9: Handles empty event gracefully', () => {
      const event: GamificationEvent = {};

      expect(() => showGamificationToasts(event)).not.toThrow();
      expect(toast.success).not.toHaveBeenCalled();
    });
  });
});
