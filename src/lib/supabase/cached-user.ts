import { cache } from 'react'
import { createClient } from './server'
import { User } from '@supabase/supabase-js'

// Timeout for cached user fetch (shorter than middleware since this is a secondary check)
const CACHED_USER_TIMEOUT_MS = 3000;

/**
 * Optimized user fetcher that uses React cache() to deduplicate requests 
 * within the same render cycle (server components).
 * This eliminates the 100-300ms latency from redundant getUser() calls
 * when middleware has already verified the session.
 * 
 * Includes timeout protection to prevent hanging when Supabase is slow.
 */
export const getCachedUser = cache(async (): Promise<User | null> => {
  try {
    const supabase = await createClient()
    
    // Add timeout to prevent hanging
    const authPromise = supabase.auth.getUser();
    const timeoutPromise = new Promise<{ data: { user: null }, error: null }>((resolve) => {
      setTimeout(() => {
        console.warn(`[AuthCache] getUser timed out after ${CACHED_USER_TIMEOUT_MS}ms`);
        resolve({ data: { user: null }, error: null });
      }, CACHED_USER_TIMEOUT_MS);
    });
    
    const { data, error } = await Promise.race([authPromise, timeoutPromise]);
    
    if (error || !data.user) {
      return null
    }
    
    return data.user
  } catch (err) {
    console.error('[AuthCache] Unexpected error fetching user:', err)
    return null
  }
})

/**
 * Get user with explicit retry support for degraded mode.
 * Use this when you need more control over retry behavior.
 */
export async function getUserWithRetry(maxRetries = 2): Promise<User | null> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const supabase = await createClient()
      
      const authPromise = supabase.auth.getUser();
      const timeoutPromise = new Promise<null>((resolve) => {
        setTimeout(() => resolve(null), CACHED_USER_TIMEOUT_MS);
      });
      
      const result = await Promise.race([authPromise, timeoutPromise]);
      
      if (result && 'data' in result && result.data.user) {
        return result.data.user;
      }
      
      // If we got a null result (timeout), wait briefly before retry
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1))); // exponential backoff
      }
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
  
  if (lastError) {
    console.error('[AuthCache] All retry attempts failed:', lastError.message);
  }
  
  return null;
}
