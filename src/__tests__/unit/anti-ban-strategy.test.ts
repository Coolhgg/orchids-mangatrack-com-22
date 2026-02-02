import { normalizeSearchQuery } from '@/lib/search-utils';
import { SYNC_INTERVALS_BY_TIER } from '@/workers/schedulers/master.scheduler';

// Note: shouldEnqueueExternalSearch tests are in integration tests
// because they require real database interaction for queryStats

describe('Anti-Ban Strategy QA', () => {
  describe('Search Storm Protection - Normalization', () => {
    it('should normalize queries consistently', () => {
      const q1 = '  One Piece!  ';
      const q2 = 'one piece';
      expect(normalizeSearchQuery(q1)).toBe(normalizeSearchQuery(q2));
    });

    it('should remove diacritics', () => {
      const q1 = 'café';
      const q2 = 'cafe';
      expect(normalizeSearchQuery(q1)).toBe(normalizeSearchQuery(q2));
    });

    it('should handle special characters', () => {
      const q1 = 'One-Piece!!!';
      const q2 = 'onepiece';
      expect(normalizeSearchQuery(q1)).toBe(normalizeSearchQuery(q2));
    });

    it('should collapse multiple spaces', () => {
      const q1 = 'one    piece';
      const q2 = 'one piece';
      expect(normalizeSearchQuery(q1)).toBe(normalizeSearchQuery(q2));
    });
  });

  describe('Tier-Based Polling', () => {
    it('should have correct intervals for Tier A', () => {
      expect(SYNC_INTERVALS_BY_TIER.A.HOT).toBe(30 * 60 * 1000);
    });

    it('should have Tier C intervals defined', () => {
      expect(SYNC_INTERVALS_BY_TIER.C).toBeDefined();
    });

    it('should have longer intervals for lower tiers', () => {
      expect(SYNC_INTERVALS_BY_TIER.C.HOT).toBeGreaterThan(SYNC_INTERVALS_BY_TIER.A.HOT);
    });
  });
});
