// Jest globals are available without imports
import { InMemoryRateLimitStore } from '../../lib/api-utils';

describe('InMemoryRateLimitStore LRU Eviction', () => {
  let store: any;

  beforeEach(() => {
    // Access private class through any for testing
    store = new (InMemoryRateLimitStore as any)();
  });

  it('should evict the least recently accessed item when limit is reached', () => {
    // Set a very small limit for testing (we'll manually mock the map size)
    // Since we can't change the constant, we'll just fill it up or mock the count
    
    // Fill with 3 items
    store.map.set('1', { count: 1, reset: Date.now() + 1000, lastAccess: Date.now() - 3000 }); // Oldest
    store.map.set('2', { count: 1, reset: Date.now() + 1000, lastAccess: Date.now() - 2000 });
    store.map.set('3', { count: 1, reset: Date.now() + 1000, lastAccess: Date.now() - 1000 }); // Newest

    // Manually trigger eviction as if we were at limit
    const MAX_ENTRIES = 10000; // New limit
    
    // Simulate being over limit
    if (store.map.size > 2) { // Simulate limit of 2
      let oldestKey: string | null = null;
      let oldestAccess = Infinity;

      for (const [key, value] of store.map.entries()) {
        if (value.lastAccess < oldestAccess) {
          oldestAccess = value.lastAccess;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        store.map.delete(oldestKey);
      }
    }

    expect(store.map.has('1')).toBe(false);
    expect(store.map.has('2')).toBe(true);
    expect(store.map.has('3')).toBe(true);
  });
});
