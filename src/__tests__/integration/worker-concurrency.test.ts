/**
 * Worker Concurrency Limits Tests
 * Tests for race conditions in canStartJob() and global concurrency tracking
 */

import {
  canStartNewJob,
  recordJobStart,
  recordJobEnd,
  QUEUE_PRIORITIES,
} from '@/lib/bug-fixes/worker-scheduling';

describe('Worker Concurrency Limits', () => {
  beforeEach(() => {
    // Reset global concurrency state by ending all jobs
    for (let i = 0; i < 200; i++) {
      recordJobEnd('sync-source');
      recordJobEnd('notification');
      recordJobEnd('resolution');
      recordJobEnd('cover-refresh');
    }
  });

  describe('canStartNewJob', () => {
    it('should allow job when under global limit', () => {
      expect(canStartNewJob('sync-source')).toBe(true);
    });

    it('should respect queue-specific limits', () => {
      const syncSourceLimit = QUEUE_PRIORITIES.find(q => q.queueName === 'sync-source')?.maxConcurrent || 10;
      
      // Fill up to the limit
      for (let i = 0; i < syncSourceLimit; i++) {
        recordJobStart('sync-source');
      }
      
      // Should reject next job for sync-source
      expect(canStartNewJob('sync-source')).toBe(false);
      
      // But should allow jobs for other queues
      expect(canStartNewJob('notification')).toBe(true);
    });

    it('should block all queues when global limit reached', () => {
      // Fill up to global limit (100)
      for (let i = 0; i < 100; i++) {
        recordJobStart('notification'); // Has higher limit (20)
      }
      
      // All queues should be blocked
      expect(canStartNewJob('sync-source')).toBe(false);
      expect(canStartNewJob('notification')).toBe(false);
      expect(canStartNewJob('resolution')).toBe(false);
    });

    it('should respect source-level limits', () => {
      const sourceName = 'mangadex';
      const sourceLimit = 5;
      
      // Fill up source limit
      for (let i = 0; i < sourceLimit; i++) {
        recordJobStart('sync-source', sourceName);
      }
      
      // Should reject for same source
      expect(canStartNewJob('sync-source', sourceName)).toBe(false);
      
      // But allow for different source
      expect(canStartNewJob('sync-source', 'other-source')).toBe(true);
    });
  });

  describe('recordJobStart/recordJobEnd', () => {
    it('should correctly track job counts', () => {
      recordJobStart('sync-source');
      recordJobStart('sync-source');
      recordJobStart('notification');
      
      // End one sync-source job
      recordJobEnd('sync-source');
      
      // Should still allow more jobs
      expect(canStartNewJob('sync-source')).toBe(true);
    });

    it('should not go below zero on recordJobEnd', () => {
      // End more than started
      recordJobEnd('sync-source');
      recordJobEnd('sync-source');
      recordJobEnd('sync-source');
      
      // Should still work correctly
      expect(canStartNewJob('sync-source')).toBe(true);
      
      // Start a job
      recordJobStart('sync-source');
      expect(canStartNewJob('sync-source')).toBe(true);
    });

    it('should handle source-specific tracking', () => {
      const source = 'mangadex';
      
      recordJobStart('sync-source', source);
      recordJobStart('sync-source', source);
      recordJobEnd('sync-source', source);
      
      // Should still allow one more (limit is 5, we have 1)
      expect(canStartNewJob('sync-source', source)).toBe(true);
    });
  });

  describe('Race condition simulation', () => {
    it('should handle rapid concurrent checks', async () => {
      const results: boolean[] = [];
      const syncSourceLimit = QUEUE_PRIORITIES.find(q => q.queueName === 'sync-source')?.maxConcurrent || 10;
      
      // Simulate concurrent requests
      const promises = Array.from({ length: syncSourceLimit + 5 }, async (_, i) => {
        // Small random delay to simulate real-world timing
        await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
        const canStart = canStartNewJob('sync-source');
        if (canStart) {
          recordJobStart('sync-source');
          results.push(true);
        } else {
          results.push(false);
        }
      });
      
      await Promise.all(promises);
      
      // Should have allowed at most the limit number of jobs
      const successCount = results.filter(r => r).length;
      expect(successCount).toBeLessThanOrEqual(syncSourceLimit);
    });

    it('should handle interleaved start/end operations', async () => {
      const iterations = 50;
      const promises: Promise<void>[] = [];
      
      for (let i = 0; i < iterations; i++) {
        promises.push(
          (async () => {
            const canStart = canStartNewJob('sync-source');
            if (canStart) {
              recordJobStart('sync-source');
              // Simulate some work
              await new Promise(resolve => setTimeout(resolve, Math.random() * 5));
              recordJobEnd('sync-source');
            }
          })()
        );
      }
      
      await Promise.all(promises);
      
      // After all jobs complete, should be able to start new jobs
      expect(canStartNewJob('sync-source')).toBe(true);
    });
  });
});
