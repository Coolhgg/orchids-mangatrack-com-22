import { supabaseAdmin } from '../supabase/admin';

/**
 * SIGNAL WEIGHT MAP
 * Explicit signals outweigh implicit ones.
 * Structural signals (genre/theme) are derived multipliers.
 */
export type SignalType =
  | 'add_to_library'
  | 'remove_from_library'
  | 'mark_chapter_read'
  | 'rating'
  | 'manga_click'
  | 'chapter_click'
  | 'long_read_session'
  | 'repeat_visit';

export const SIGNAL_WEIGHTS: Record<SignalType, number> = {
  // Explicit Signals
  add_to_library: 5.0,
  remove_from_library: -5.0,
  mark_chapter_read: 3.0,
  rating: 0, // Special case: rating * 2
  
  // Implicit Signals
  chapter_click: 2.0,
  long_read_session: 2.0,
  manga_click: 1.0,
  repeat_visit: 1.0,
};

export const STRUCTURAL_WEIGHTS = {
  genre_affinity: 0.5,
  theme_affinity: 0.5,
  type_preference: 0.3,
  source_preference: 0.3,
};

export interface SignalPayload {
  user_id: string;
  series_id?: string;
  signal_type: SignalType;
  metadata?: any;
}

/**
 * Records a user behavior signal to the database.
 * These signals form the raw input for the recommendation engine.
 * 
 * BUG FIX: Uses supabaseAdmin instead of createClient() which requires cookies
 * and fails in server-side contexts without a request.
 */
export async function recordSignal(payload: SignalPayload): Promise<{ success: boolean; error?: any }> {
  try {
    // Validate required fields
    if (!payload.user_id) {
      console.error('[Signals] Missing user_id in payload');
      return { success: false, error: { message: 'Missing user_id' } };
    }

    if (!payload.signal_type) {
      console.error('[Signals] Missing signal_type in payload');
      return { success: false, error: { message: 'Missing signal_type' } };
    }

    let weight = SIGNAL_WEIGHTS[payload.signal_type];
    
    // Handle special weight calculations
    if (payload.signal_type === 'rating') {
      const ratingValue = payload.metadata?.rating || 0;
      // Validate rating is within expected range (1-10)
      const clampedRating = Math.max(0, Math.min(10, Number(ratingValue) || 0));
      weight = clampedRating * 2;
    }

    // BUG FIX: Use supabaseAdmin for server-side operations
      const { error } = await supabaseAdmin
        .from('user_signals')
        .insert([{
          user_id: payload.user_id,
          series_id: payload.series_id || null,
          signal_type: payload.signal_type,
          weight: weight,
          metadata: payload.metadata || null,
          created_at: new Date().toISOString()
        }]);

      if (error) {
        console.error(`[Signals] Failed to record ${payload.signal_type}:`, error.message);
        return { success: false, error };
      }

      // Update series last activity timestamp for decay scoring
      if (payload.series_id) {
        supabaseAdmin
          .from('series')
          .update({ last_activity_at: new Date().toISOString() })
          .eq('id', payload.series_id)
          .then(({ error: updateError }) => {
            if (updateError) console.warn(`[Signals] Failed to update series activity: ${updateError.message}`);
          });
      }

      return { success: true };
  } catch (err: any) {
    console.error(`[Signals] Unexpected error recording ${payload.signal_type}:`, err.message);
    return { success: false, error: err };
  }
}

/**
 * Batch record multiple signals at once (optimization for high-volume events)
 */
export async function recordSignalsBatch(payloads: SignalPayload[]): Promise<{ success: boolean; recorded: number; errors: number }> {
  if (!payloads || payloads.length === 0) {
    return { success: true, recorded: 0, errors: 0 };
  }

  const records = payloads.map(payload => {
    let weight = SIGNAL_WEIGHTS[payload.signal_type];
    
    if (payload.signal_type === 'rating') {
      const ratingValue = payload.metadata?.rating || 0;
      const clampedRating = Math.max(0, Math.min(10, Number(ratingValue) || 0));
      weight = clampedRating * 2;
    }

    return {
      user_id: payload.user_id,
      series_id: payload.series_id || null,
      signal_type: payload.signal_type,
      weight: weight,
      metadata: payload.metadata || null,
      created_at: new Date().toISOString()
    };
  }).filter(r => r.user_id && r.signal_type);

  if (records.length === 0) {
    return { success: true, recorded: 0, errors: payloads.length };
  }

  const { error } = await supabaseAdmin
    .from('user_signals')
    .insert(records);

  if (error) {
    console.error(`[Signals] Batch insert failed:`, error.message);
    return { success: false, recorded: 0, errors: payloads.length };
  }

  return { success: true, recorded: records.length, errors: payloads.length - records.length };
}

/**
 * DECAY LOGIC (Conceptual/Documentation)
 * 
 * Score_new = Score_initial * exp(-lambda * t)
 * where lambda = ln(2) / half_life
 * For a 30-day half-life: lambda ≈ 0.0231
 * 
 * This logic is implemented in the PostgreSQL RPC 'calculate_user_affinities'.
 */
