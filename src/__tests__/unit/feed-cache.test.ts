/**
 * Unit Tests for FeedCache
 * Tests client-side feed caching with localStorage
 */

import { FeedCache, FeedActivityItem } from '@/lib/feed-cache';

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
    key: jest.fn((i: number) => Object.keys(store)[i] || null),
    get length() { return Object.keys(store).length; },
    keys: () => Object.keys(store),
  };
})();

Object.defineProperty(global, 'localStorage', { value: mockLocalStorage });
Object.defineProperty(global, 'window', { 
  value: { 
    dispatchEvent: jest.fn(),
    localStorage: mockLocalStorage 
  },
  writable: true
});

Object.keys = jest.fn((obj) => {
  if (obj === mockLocalStorage) {
    return mockLocalStorage.keys();
  }
  return Object.getOwnPropertyNames(obj);
});

describe('FeedCache', () => {
  const mockFeedItem: FeedActivityItem = {
    id: 'activity-1',
    user_id: 'user-1',
    series_id: 'series-1',
    type: 'chapter_read',
    created_at: new Date().toISOString(),
    user: {
      id: 'user-1',
      username: 'testuser',
      avatar_url: null,
    },
    series: {
      id: 'series-1',
      title: 'Test Manga',
      cover_url: null,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
  });

  describe('get', () => {
    it('should return null when cache is empty', () => {
      const result = FeedCache.get('global');
      expect(result).toBeNull();
    });

    it('should return cached items when within TTL', () => {
      const cached = {
        items: [mockFeedItem],
        timestamp: Date.now(),
        type: 'global',
      };
      mockLocalStorage.setItem('mangatrack_feed_cache_global', JSON.stringify(cached));
      
      const result = FeedCache.get('global');
      expect(result).toEqual([mockFeedItem]);
    });

    it('should return null and remove expired cache', () => {
      const cached = {
        items: [mockFeedItem],
        timestamp: Date.now() - (1000 * 60 * 15), // 15 minutes ago (expired)
        type: 'global',
      };
      mockLocalStorage.setItem('mangatrack_feed_cache_global', JSON.stringify(cached));
      
      const result = FeedCache.get('global');
      expect(result).toBeNull();
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('mangatrack_feed_cache_global');
    });

    it('should handle JSON parse errors gracefully', () => {
      mockLocalStorage.setItem('mangatrack_feed_cache_global', 'invalid json');
      
      const result = FeedCache.get('global');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should store items in localStorage', () => {
      FeedCache.set('global', [mockFeedItem]);
      
      expect(mockLocalStorage.setItem).toHaveBeenCalled();
      const call = mockLocalStorage.setItem.mock.calls[0];
      expect(call[0]).toBe('mangatrack_feed_cache_global');
      
      const stored = JSON.parse(call[1]);
      expect(stored.items).toEqual([mockFeedItem]);
      expect(stored.type).toBe('global');
      expect(typeof stored.timestamp).toBe('number');
    });

    it('should handle localStorage quota errors gracefully', () => {
      mockLocalStorage.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError');
      });
      
      expect(() => FeedCache.set('global', [mockFeedItem])).not.toThrow();
    });
  });

  describe('invalidate', () => {
    it('should remove specific cache type', () => {
      mockLocalStorage.setItem('mangatrack_feed_cache_global', 'data');
      mockLocalStorage.setItem('mangatrack_feed_cache_following', 'data');
      
      FeedCache.invalidate('global');
      
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('mangatrack_feed_cache_global');
    });

    it('should dispatch custom event on invalidate', () => {
      FeedCache.invalidate('global');
      
      expect(window.dispatchEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'feed-cache-invalidated',
          detail: { type: 'global' },
        })
      );
    });

    it('should remove all feed caches when no type specified', () => {
      const keys = ['mangatrack_feed_cache_global', 'mangatrack_feed_cache_following', 'other_key'];
      Object.keys = jest.fn(() => keys);
      
      FeedCache.invalidate();
      
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('mangatrack_feed_cache_global');
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('mangatrack_feed_cache_following');
      expect(mockLocalStorage.removeItem).not.toHaveBeenCalledWith('other_key');
    });
  });

  describe('type safety', () => {
    it('should properly type feed items', () => {
      const items: FeedActivityItem[] = [
        {
          id: 'a1',
          user_id: 'u1',
          type: 'series_started',
          created_at: new Date(),
          user: { id: 'u1', username: 'user1' },
        },
        {
          id: 'a2',
          user_id: 'u2',
          series_id: 's1',
          chapter_id: 'c1',
          type: 'chapter_read',
          metadata: { chapter_number: 5 },
          created_at: '2024-01-01T00:00:00Z',
          user: { id: 'u2', username: 'user2', avatar_url: 'https://example.com/avatar.jpg' },
          series: { id: 's1', title: 'Test Series', cover_url: 'https://example.com/cover.jpg' },
          chapter: { id: 'c1', chapter_number: 5, chapter_title: 'Chapter 5' },
        },
      ];

      FeedCache.set('test', items);
      
      const cached = {
        items,
        timestamp: Date.now(),
        type: 'test',
      };
      mockLocalStorage.setItem('mangatrack_feed_cache_test', JSON.stringify(cached));
      
      const result = FeedCache.get('test');
      expect(result).toHaveLength(2);
      expect(result![0].user?.username).toBe('user1');
      expect(result![1].series?.title).toBe('Test Series');
    });
  });
});
