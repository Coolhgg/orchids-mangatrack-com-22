import { supabaseAdmin } from '../supabase/admin';

export type ActivityEventType = 
  | 'chapter_detected'      // Weight: 1
  | 'chapter_source_added'  // Weight: 2
  | 'search_impression'     // Weight: 5
  | 'chapter_read'          // Weight: 50
  | 'series_followed'       // Weight: 100

export const ACTIVITY_WEIGHTS: Record<ActivityEventType, number> = {
  'chapter_detected': 1,
  'chapter_source_added': 2,
  'search_impression': 5,
  'chapter_read': 50,
  'series_followed': 100,
};

interface ActivityPayload {
  series_id: string;
  user_id?: string;
  chapter_id?: string;
  source_name?: string;
  event_type: ActivityEventType;
  weight?: number;
}

/**
 * Canonical record function for activity events.
 * Used for trending, recommendations, and tier promotions.
 */
export async function recordActivity(payload: ActivityPayload) {
  const weight = payload.weight ?? ACTIVITY_WEIGHTS[payload.event_type] ?? 1;

  const { error } = await supabaseAdmin
    .from('activity_events')
    .insert([{
      series_id: payload.series_id,
      user_id: payload.user_id,
      chapter_id: payload.chapter_id,
      source_name: payload.source_name,
      event_type: payload.event_type,
      weight: weight,
      created_at: new Date().toISOString()
    }]);

  if (error) {
    console.error(`[Analytics] Failed to record ${payload.event_type}:`, error.message);
    return { success: false, error };
  }

  return { success: true };
}
