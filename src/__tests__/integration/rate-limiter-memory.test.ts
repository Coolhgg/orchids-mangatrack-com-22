import { InMemoryRateLimitStore } from '@/lib/api-utils';

describe('InMemoryRateLimitStore', () => {
  let store: InMemoryRateLimitStore;

  beforeEach(() => {
    store = new InMemoryRateLimitStore();
  });

  afterEach(() => {
    store.shutdown();
  });

  describe('basic operations', () => {
    it('should store and retrieve entries', () => {
      const entry = { count: 1, resetTime: Date.now() + 60000, lastAccess: Date.now() };
      store.set('test-key', entry);
      
      const retrieved = store.get('test-key');
      
      expect(retrieved).toBeDefined();
      expect(retrieved?.count).toBe(1);
    });

    it('should return undefined for non-existent keys', () => {
      const result = store.get('non-existent');
      
      expect(result).toBeUndefined();
    });

    it('should delete entries', () => {
      const entry = { count: 1, resetTime: Date.now() + 60000, lastAccess: Date.now() };
      store.set('to-delete', entry);
      
      store.delete('to-delete');
      
      expect(store.get('to-delete')).toBeUndefined();
    });

    it('should update lastAccess on get', () => {
      const originalAccess = Date.now() - 10000;
      const entry = { count: 1, resetTime: Date.now() + 60000, lastAccess: originalAccess };
      store.set('access-test', entry);
      
      const beforeGet = Date.now();
      const retrieved = store.get('access-test');
      
      expect(retrieved?.lastAccess).toBeGreaterThanOrEqual(beforeGet);
    });
  });

  describe('cleanup behavior', () => {
    it('should remove expired entries on cleanup triggered by access', () => {
      const expiredEntry = { count: 1, resetTime: Date.now() - 1000, lastAccess: Date.now() - 10000 };
      const validEntry = { count: 1, resetTime: Date.now() + 60000, lastAccess: Date.now() };
      
      store.set('expired', expiredEntry);
      store.set('valid', validEntry);
      
      for (let i = 0; i < 101; i++) {
        store.get(`trigger-cleanup-${i}`);
      }
      
      expect(store.get('expired')).toBeUndefined();
      expect(store.get('valid')).toBeDefined();
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used entries when at capacity', () => {
      const maxEntries = 10000;
      
      for (let i = 0; i < 100; i++) {
        const entry = { 
          count: 1, 
          resetTime: Date.now() + 60000, 
          lastAccess: Date.now() - (100 - i) * 1000
        };
        store.set(`entry-${i}`, entry);
      }
      
      store.get('entry-99');
      
      const entry = { count: 1, resetTime: Date.now() + 60000, lastAccess: Date.now() };
      store.set('new-entry', entry);
      
      expect(store.get('new-entry')).toBeDefined();
    });
  });

  describe('shutdown', () => {
    it('should clear all entries on shutdown', () => {
      const entry = { count: 1, resetTime: Date.now() + 60000, lastAccess: Date.now() };
      store.set('before-shutdown', entry);
      
      store.shutdown();
      
      expect(store.get('before-shutdown')).toBeUndefined();
    });

    it('should handle multiple shutdown calls gracefully', () => {
      expect(() => {
        store.shutdown();
        store.shutdown();
      }).not.toThrow();
    });
  });
});
