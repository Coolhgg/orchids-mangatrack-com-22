import { createClient } from '@/lib/supabase/server';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Marks a chapter as read for a specific user.
 * Reading from any source marks the chapter as read.
 * Idempotent: Does nothing if already marked as read.
 */
export async function markChapterAsRead(userId: string, chapterId: string, client?: SupabaseClient) {
  const supabase = client || await createClient();
  
  const { error } = await supabase
    .from('user_chapter_reads')
    .upsert(
      { user_id: userId, chapter_id: chapterId },
      { onConflict: 'user_id,chapter_id' }
    );

  if (error) {
    console.error('Error marking chapter as read:', error);
    throw error;
  }
}

/**
 * Checks if a chapter has been read by the user.
 */
export async function checkChapterReadStatus(userId: string, chapterId: string, client?: SupabaseClient): Promise<boolean> {
  const supabase = client || await createClient();

  const { data, error } = await supabase
    .from('user_chapter_reads')
    .select('user_id')
    .eq('user_id', userId)
    .eq('chapter_id', chapterId)
    .maybeSingle();

  if (error) {
    console.error('Error checking chapter read status:', error);
    throw error;
  }

  return !!data;
}
