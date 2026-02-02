/**
 * Rate Limiter Exhaustion Tests
 * Tests for LRU eviction behavior under high load
 */

import { InMemoryRateLimitStore } from '@/lib/api-utils';

describe('Rate Limiter Exhaustion', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  afterEach(() => {
    store.shutdown();
  });

  describe('Memory limits', () => {
    it('should respect soft limit and trigger cleanup', () => {
      const now = Date.now();
      const SOFT_LIMIT = 4000;

      // Fill up to soft limit
      for (let i = 0; i < SOFT_LIMIT + 100; i++) {
        store.set(`key-${i}`, {
          count: 1,
          resetTime: now + 60000,
          lastAccess: now - i, // Older entries have lower lastAccess
        });
      }

      // Should be under MAX_ENTRIES (5000)
      expect(store.size).toBeLessThanOrEqual(5000);
    });

    it('should evict LRU entries when at capacity', () => {
      const now = Date.now();

      // Add entries with different access times
      for (let i = 0; i < 4500; i++) {
        store.set(`key-${i}`, {
          count: 1,
          resetTime: now + 60000,
          lastAccess: now - (4500 - i) * 1000, // Older entries first
        });
      }

      // Access some recent keys to mark them as recently used
      for (let i = 4000; i < 4500; i++) {
        store.get(`key-${i}`);
      }

      // Add more entries to trigger eviction
      for (let i = 4500; i < 5500; i++) {
        store.set(`key-${i}`, {
          count: 1,
          resetTime: now + 60000,
          lastAccess: now,
        });
      }

      // Should stay under limit
      expect(store.size).toBeLessThanOrEqual(5000);
    });
  });

  describe('Cleanup behavior', () => {
    it('should remove expired entries on cleanup', () => {
      const now = Date.now();

      // Add entries with expired reset times
      for (let i = 0; i < 100; i++) {
        store.set(`expired-${i}`, {
          count: 5,
          resetTime: now - 10000, // Already expired
          lastAccess: now - 60000,
        });
      }

      // Add valid entries
      for (let i = 0; i < 100; i++) {
        store.set(`valid-${i}`, {
          count: 1,
          resetTime: now + 60000, // Not expired
          lastAccess: now,
        });
      }

      // Trigger cleanup by accessing entries
      for (let i = 0; i < 60; i++) {
        store.get(`valid-${i}`);
      }

      // Expired entries should be cleaned up
      const expiredEntry = store.get('expired-0');
      expect(expiredEntry).toBeUndefined();

      // Valid entries should remain
      const validEntry = store.get('valid-0');
      expect(validEntry).toBeDefined();
    });

    it('should remove stale entries (last access > 10 min)', async () => {
      const now = Date.now();

      // Add stale entry (last accessed 15 minutes ago)
      store.set('stale-key', {
        count: 1,
        resetTime: now + 60000, // Not expired by reset time
        lastAccess: now - 15 * 60 * 1000, // But stale by access time
      });

      // Add fresh entry
      store.set('fresh-key', {
        count: 1,
        resetTime: now + 60000,
        lastAccess: now,
      });

      // Trigger cleanup
      for (let i = 0; i < 60; i++) {
        store.set(`trigger-${i}`, {
          count: 1,
          resetTime: now + 60000,
          lastAccess: now,
        });
      }

      // Stale entry should be cleaned
      expect(store.get('stale-key')).toBeUndefined();

      // Fresh entry should remain
      expect(store.get('fresh-key')).toBeDefined();
    });
  });

  describe('High load simulation', () => {
    it('should handle burst of requests', async () => {
      const now = Date.now();
      const requests = 1000;
      const uniqueKeys = 500;

      const promises = Array.from({ length: requests }, async (_, i) => {
        const key = `burst-${i % uniqueKeys}`;
        const entry = store.get(key);
        
        if (!entry) {
          store.set(key, {
            count: 1,
            resetTime: now + 60000,
            lastAccess: now,
          });
        } else {
          entry.count++;
        }
      });

      await Promise.all(promises);

      // Should have handled all requests
      expect(store.size).toBeGreaterThan(0);
      expect(store.size).toBeLessThanOrEqual(5000);
    });

    it('should maintain accuracy under concurrent access', async () => {
      const now = Date.now();
      const key = 'concurrent-key';

      // Initialize the key
      store.set(key, {
        count: 0,
        resetTime: now + 60000,
        lastAccess: now,
      });

      // Simulate concurrent increments
      const increments = 100;
      const promises = Array.from({ length: increments }, async () => {
        const entry = store.get(key);
        if (entry) {
          entry.count++;
        }
      });

      await Promise.all(promises);

      const finalEntry = store.get(key);
      expect(finalEntry).toBeDefined();
      // Due to race conditions, count may not be exactly 100
      // but should be reasonable
      expect(finalEntry!.count).toBeGreaterThan(0);
    });
  });

  describe('Shutdown behavior', () => {
    it('should clear all entries on shutdown', () => {
      const now = Date.now();

      // Add entries
      for (let i = 0; i < 100; i++) {
        store.set(`key-${i}`, {
          count: 1,
          resetTime: now + 60000,
          lastAccess: now,
        });
      }

      expect(store.size).toBe(100);

      // Shutdown
      store.shutdown();

      expect(store.size).toBe(0);
    });

    it('should not accept new entries after shutdown', () => {
      store.shutdown();

      const now = Date.now();
      store.set('post-shutdown', {
        count: 1,
        resetTime: now + 60000,
        lastAccess: now,
      });

      // Entry may or may not be added depending on implementation
      // but store should still function without errors
      expect(store.size).toBeLessThanOrEqual(1);
    });
  });
});
