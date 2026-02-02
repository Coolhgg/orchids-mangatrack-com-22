/**
 * Integration Tests for Recommendation Input Signal System
 * 
 * Test Coverage:
 * 1. Signal recording with correct weights
 * 2. Signal validation and error handling
 * 3. Rating signal weight calculation
 * 4. Batch signal recording
 * 5. Signal decay verification (conceptual)
 */

import {
  recordSignal,
  recordSignalsBatch,
  SIGNAL_WEIGHTS,
  STRUCTURAL_WEIGHTS,
  SignalType,
  SignalPayload,
} from '../../lib/analytics/signals';

// Mock the supabaseAdmin
jest.mock('../../lib/supabase/admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      insert: jest.fn().mockResolvedValue({ error: null }),
    })),
  },
}));

import { supabaseAdmin } from '../../lib/supabase/admin';

describe('Recommendation Input Signal System', () => {
  const mockUserId = '123e4567-e89b-12d3-a456-426614174000';
  const mockSeriesId = '987fcdeb-51a2-3c4d-5e6f-789012345678';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ============================================
  // Signal Weight Configuration Tests
  // ============================================

  describe('Signal Weight Configuration', () => {
    test('explicit signals have higher weights than implicit', () => {
      expect(SIGNAL_WEIGHTS.add_to_library).toBeGreaterThan(SIGNAL_WEIGHTS.manga_click);
      expect(SIGNAL_WEIGHTS.mark_chapter_read).toBeGreaterThan(SIGNAL_WEIGHTS.chapter_click);
    });

    test('add_to_library has weight of 5.0', () => {
      expect(SIGNAL_WEIGHTS.add_to_library).toBe(5.0);
    });

    test('remove_from_library has negative weight of -5.0', () => {
      expect(SIGNAL_WEIGHTS.remove_from_library).toBe(-5.0);
    });

    test('mark_chapter_read has weight of 3.0', () => {
      expect(SIGNAL_WEIGHTS.mark_chapter_read).toBe(3.0);
    });

    test('rating has base weight of 0 (special calculation)', () => {
      expect(SIGNAL_WEIGHTS.rating).toBe(0);
    });

    test('implicit signals have lower weights', () => {
      expect(SIGNAL_WEIGHTS.manga_click).toBe(1.0);
      expect(SIGNAL_WEIGHTS.chapter_click).toBe(2.0);
      expect(SIGNAL_WEIGHTS.long_read_session).toBe(2.0);
      expect(SIGNAL_WEIGHTS.repeat_visit).toBe(1.0);
    });

    test('structural weights are defined', () => {
      expect(STRUCTURAL_WEIGHTS.genre_affinity).toBe(0.5);
      expect(STRUCTURAL_WEIGHTS.theme_affinity).toBe(0.5);
      expect(STRUCTURAL_WEIGHTS.type_preference).toBe(0.3);
      expect(STRUCTURAL_WEIGHTS.source_preference).toBe(0.3);
    });
  });

  // ============================================
  // Signal Recording Tests
  // ============================================

  describe('recordSignal', () => {
    test('records add_to_library signal with correct weight', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'add_to_library',
      });

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          user_id: mockUserId,
          series_id: mockSeriesId,
          signal_type: 'add_to_library',
          weight: 5.0,
        }),
      ]);
    });

    test('records manga_click signal with correct weight', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'manga_click',
      });

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          weight: 1.0,
        }),
      ]);
    });

    test('calculates rating weight as rating * 2', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'rating',
        metadata: { rating: 8 },
      });

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          weight: 16, // 8 * 2
        }),
      ]);
    });

    test('clamps rating to valid range (0-10)', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      // Test with rating > 10
      await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'rating',
        metadata: { rating: 15 },
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          weight: 20, // clamped to 10 * 2
        }),
      ]);
    });

    test('handles missing user_id', async () => {
      const result = await recordSignal({
        user_id: '',
        series_id: mockSeriesId,
        signal_type: 'manga_click',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Missing user_id');
    });

    test('handles missing signal_type', async () => {
      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: '' as SignalType,
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Missing signal_type');
    });

    test('handles database errors gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ 
        error: { message: 'Database error' } 
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'manga_click',
      });

      expect(result.success).toBe(false);
      expect(result.error?.message).toBe('Database error');
    });

    test('records signal without series_id (e.g., global actions)', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        signal_type: 'repeat_visit',
      });

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          series_id: null,
        }),
      ]);
    });

    test('includes metadata in recorded signal', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const metadata = { source: 'search_results', chapter_number: "42" };
      
      await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'chapter_click',
        metadata,
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          metadata,
        }),
      ]);
    });
  });

  // ============================================
  // Batch Signal Recording Tests
  // ============================================

  describe('recordSignalsBatch', () => {
    test('records multiple signals in single insert', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const payloads: SignalPayload[] = [
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: 'manga_click' },
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: 'chapter_click' },
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: 'add_to_library' },
      ];

      const result = await recordSignalsBatch(payloads);

      expect(result.success).toBe(true);
      expect(result.recorded).toBe(3);
      expect(result.errors).toBe(0);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    test('handles empty array', async () => {
      const result = await recordSignalsBatch([]);

      expect(result.success).toBe(true);
      expect(result.recorded).toBe(0);
      expect(result.errors).toBe(0);
    });

    test('filters out invalid payloads', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const payloads: SignalPayload[] = [
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: 'manga_click' },
        { user_id: '', series_id: mockSeriesId, signal_type: 'chapter_click' }, // Invalid: no user_id
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: '' as SignalType }, // Invalid: no signal_type
      ];

      const result = await recordSignalsBatch(payloads);

      expect(result.success).toBe(true);
      expect(result.recorded).toBe(1);
      expect(result.errors).toBe(2);
    });

    test('handles database errors in batch', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ 
        error: { message: 'Batch insert failed' } 
      });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const payloads: SignalPayload[] = [
        { user_id: mockUserId, series_id: mockSeriesId, signal_type: 'manga_click' },
      ];

      const result = await recordSignalsBatch(payloads);

      expect(result.success).toBe(false);
      expect(result.recorded).toBe(0);
    });
  });

  // ============================================
  // Signal Decay Tests (Conceptual Verification)
  // ============================================

  describe('Signal Decay Logic', () => {
    const LAMBDA = 0.0231; // 30-day half-life constant

    test('decay formula produces correct values at key intervals', () => {
      // Score_new = Score_initial * exp(-lambda * t)
      const initialWeight = 5.0;

      // At t=0 days
      const scoreAtDay0 = initialWeight * Math.exp(-LAMBDA * 0);
      expect(scoreAtDay0).toBeCloseTo(5.0, 2);

      // At t=30 days (half-life)
      const scoreAtDay30 = initialWeight * Math.exp(-LAMBDA * 30);
      expect(scoreAtDay30).toBeCloseTo(2.5, 1);

      // At t=60 days (two half-lives)
      const scoreAtDay60 = initialWeight * Math.exp(-LAMBDA * 60);
      expect(scoreAtDay60).toBeCloseTo(1.25, 1);

      // At t=90 days (three half-lives)
      const scoreAtDay90 = initialWeight * Math.exp(-LAMBDA * 90);
      expect(scoreAtDay90).toBeCloseTo(0.625, 1);
    });

    test('negative signals also decay toward zero', () => {
      const initialWeight = -5.0;

      const scoreAtDay30 = initialWeight * Math.exp(-LAMBDA * 30);
      expect(scoreAtDay30).toBeCloseTo(-2.5, 1);
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe('Edge Cases', () => {
    test('handles null metadata gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'manga_click',
        metadata: null,
      });

      expect(result.success).toBe(true);
      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          metadata: null,
        }),
      ]);
    });

    test('handles undefined metadata gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const result = await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'manga_click',
      });

      expect(result.success).toBe(true);
    });

    test('rating with non-numeric value defaults to 0', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      await recordSignal({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'rating',
        metadata: { rating: 'invalid' },
      });

      expect(mockInsert).toHaveBeenCalledWith([
        expect.objectContaining({
          weight: 0, // NaN becomes 0 after clamping
        }),
      ]);
    });

    test('handles very large batch gracefully', async () => {
      const mockInsert = jest.fn().mockResolvedValue({ error: null });
      (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert: mockInsert });

      const payloads: SignalPayload[] = Array(1000).fill(null).map(() => ({
        user_id: mockUserId,
        series_id: mockSeriesId,
        signal_type: 'manga_click' as SignalType,
      }));

      const result = await recordSignalsBatch(payloads);

      expect(result.success).toBe(true);
      expect(result.recorded).toBe(1000);
    });
  });
});

// ============================================
// Test Scenarios for Recommendation Use Cases
// ============================================

describe('Recommendation Signal Use Cases', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('User adds manga to library', () => {
    test('should record add_to_library signal with weight 5.0', () => {
      const expectedWeight = SIGNAL_WEIGHTS.add_to_library;
      expect(expectedWeight).toBe(5.0);
    });
  });

  describe('User reads from different sources', () => {
    test('chapter_click signals should track source in metadata', () => {
      // This is a conceptual test - actual implementation in API
      const signal: SignalPayload = {
        user_id: 'user-1',
        series_id: 'series-1',
        signal_type: 'chapter_click',
        metadata: {
          source_name: 'MangaDex',
          source_id: 'source-1',
        },
      };

      expect(signal.metadata?.source_name).toBe('MangaDex');
    });
  });

  describe('User stops reading manga', () => {
    test('remove_from_library should have negative weight', () => {
      const weight = SIGNAL_WEIGHTS.remove_from_library;
      expect(weight).toBeLessThan(0);
      expect(weight).toBe(-5.0);
    });
  });

  describe('Genre interest changes over time', () => {
    test('structural weights are lower than explicit signals', () => {
      expect(STRUCTURAL_WEIGHTS.genre_affinity).toBeLessThan(SIGNAL_WEIGHTS.add_to_library);
      expect(STRUCTURAL_WEIGHTS.theme_affinity).toBeLessThan(SIGNAL_WEIGHTS.add_to_library);
    });

    test('decay affects old genre preferences', () => {
      // 90-day-old genre affinity signal
      const initialWeight = STRUCTURAL_WEIGHTS.genre_affinity;
      const lambda = 0.0231;
      const daysOld = 90;

      const decayedWeight = initialWeight * Math.exp(-lambda * daysOld);

      // After 90 days (~3 half-lives), weight should be ~12.5% of original
      expect(decayedWeight).toBeLessThan(initialWeight * 0.15);
    });
  });
});
