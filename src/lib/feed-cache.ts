export interface FeedActivityItem {
  id: string;
  user_id: string;
  series_id?: string | null;
  chapter_id?: string | null;
  type: string;
  metadata?: Record<string, unknown> | null;
  created_at: string | Date;
  user?: {
    id: string;
    username: string;
    avatar_url?: string | null;
  };
  series?: {
    id: string;
    title: string;
    cover_url?: string | null;
  } | null;
  chapter?: {
    id: string;
    chapter_number: number;
    chapter_title?: string | null;
  } | null;
}

type CachedFeed = {
  items: FeedActivityItem[];
  timestamp: number;
  type: string;
};

const CACHE_KEY_PREFIX = 'mangatrack_feed_cache_';
const CACHE_TTL = 1000 * 60 * 10; // 10 minutes

export const FeedCache = {
  get(type: string): FeedActivityItem[] | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${type}`);
      if (!raw) return null;
      
      const cached: CachedFeed = JSON.parse(raw);
      if (Date.now() - cached.timestamp > CACHE_TTL) {
        localStorage.removeItem(`${CACHE_KEY_PREFIX}${type}`);
        return null;
      }
      
      return cached.items;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FeedCache] Failed to read from cache:', error instanceof Error ? error.message : 'Unknown error');
      }
      return null;
    }
  },

  set(type: string, items: FeedActivityItem[]): void {
    if (typeof window === 'undefined') return;
    try {
      const cached: CachedFeed = {
        items,
        timestamp: Date.now(),
        type,
      };
      localStorage.setItem(`${CACHE_KEY_PREFIX}${type}`, JSON.stringify(cached));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FeedCache] Failed to write to cache:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  },

  invalidate(type?: string): void {
    if (typeof window === 'undefined') return;
    try {
      if (type) {
        localStorage.removeItem(`${CACHE_KEY_PREFIX}${type}`);
      } else {
        Object.keys(localStorage)
          .filter(key => key.startsWith(CACHE_KEY_PREFIX))
          .forEach(key => localStorage.removeItem(key));
      }
      window.dispatchEvent(new CustomEvent('feed-cache-invalidated', { detail: { type } }));
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[FeedCache] Failed to invalidate cache:', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  }
};
