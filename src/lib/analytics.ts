import { recordActivity, ActivityEventType } from './analytics/record';
import { supabaseAdmin } from './supabase/admin';

export interface SearchEvent {
  normalized_query: string;
  intent_type: string;
  source?: string;
  local_hit: boolean;
  external_attempted: boolean;
  results_count: number;
  resolution_time_ms: number;
  status: string;
}

export type SeriesEventType = 
  | 'chapter_detected' 
  | 'user_read' 
  | 'user_follow' 
  | 'update_click' 
  | 'search_frequency'

export interface SeriesActivityEvent {
  series_id: string
  event_type: SeriesEventType
  user_id?: string
  source_name?: string
  weight?: number
}

/**
 * Records a search event to the database asynchronously.
 */
export function recordSearchEvent(event: SearchEvent) {
  (async () => {
    try {
      const { error } = await supabaseAdmin
        .from('search_events')
        .insert([event]);
      if (error) {
        console.error('[Analytics] Failed to record search event:', error.message);
      }
    } catch (err) {
      console.error('[Analytics] Unexpected error recording search event:', err);
    }
  })();
}

/**
 * Records a series activity event (trending signal) asynchronously.
 */
export function recordSeriesActivityEvent(event: SeriesActivityEvent) {
  // Map legacy event types to the new canonical ones
  const eventMap: Record<SeriesEventType, ActivityEventType> = {
    'chapter_detected': 'chapter_detected',
    'user_read': 'chapter_read',
    'user_follow': 'series_followed',
    'update_click': 'chapter_read', // Treat as read for weight
    'search_frequency': 'search_impression'
  }

  recordActivity({
    series_id: event.series_id,
    user_id: event.user_id,
    source_name: event.source_name,
    event_type: eventMap[event.event_type] || 'search_impression',
    weight: event.weight
  });
}
