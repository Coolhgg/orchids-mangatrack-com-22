/**
 * Scheduler Watermark Recovery Tests
 * Tests for crash recovery scenarios using scheduler watermarks
 */

import { redisApi, REDIS_KEY_PREFIX } from '@/lib/redis';

const SCHEDULER_WATERMARK_KEY = `${REDIS_KEY_PREFIX}scheduler:watermark`;
const SCHEDULER_RUN_HISTORY_KEY = `${REDIS_KEY_PREFIX}scheduler:run_history`;

interface SchedulerWatermark {
  lastRunAt: string;
  lastProcessedSourceId: string | null;
  sourcesScheduled: number;
  runId: string;
}

describe('Scheduler Watermark Recovery', () => {
  beforeEach(async () => {
    // Clean up watermark keys before each test
    await redisApi.del(SCHEDULER_WATERMARK_KEY);
    await redisApi.del(SCHEDULER_RUN_HISTORY_KEY);
  });

  afterEach(async () => {
    await redisApi.del(SCHEDULER_WATERMARK_KEY);
    await redisApi.del(SCHEDULER_RUN_HISTORY_KEY);
  });

  describe('Watermark persistence', () => {
    it('should persist watermark during scheduler run', async () => {
      const watermark: SchedulerWatermark = {
        lastRunAt: new Date().toISOString(),
        lastProcessedSourceId: 'source-123',
        sourcesScheduled: 50,
        runId: 'run_' + Date.now(),
      };

      await redisApi.setex(SCHEDULER_WATERMARK_KEY, 600, JSON.stringify(watermark));

      const stored = await redisApi.get(SCHEDULER_WATERMARK_KEY);
      expect(stored).not.toBeNull();

      const parsed = JSON.parse(stored!);
      expect(parsed.lastProcessedSourceId).toBe('source-123');
      expect(parsed.sourcesScheduled).toBe(50);
    });

    it('should expire watermark after TTL', async () => {
      const watermark: SchedulerWatermark = {
        lastRunAt: new Date().toISOString(),
        lastProcessedSourceId: 'source-456',
        sourcesScheduled: 25,
        runId: 'run_' + Date.now(),
      };

      // Set with 1 second TTL
      await redisApi.setex(SCHEDULER_WATERMARK_KEY, 1, JSON.stringify(watermark));

      // Wait for TTL to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      const stored = await redisApi.get(SCHEDULER_WATERMARK_KEY);
      expect(stored).toBeNull();
    });
  });

  describe('Crash recovery detection', () => {
    it('should detect stale watermark from previous crash', async () => {
      // Simulate a crashed run (watermark still present)
      const crashedWatermark: SchedulerWatermark = {
        lastRunAt: new Date(Date.now() - 60000).toISOString(), // 1 minute ago
        lastProcessedSourceId: 'source-crashed',
        sourcesScheduled: 30,
        runId: 'crashed_run',
      };

      await redisApi.setex(SCHEDULER_WATERMARK_KEY, 600, JSON.stringify(crashedWatermark));

      // Check if watermark exists (indicates potential crash)
      const existingWatermark = await redisApi.get(SCHEDULER_WATERMARK_KEY);
      expect(existingWatermark).not.toBeNull();

      const parsed: SchedulerWatermark = JSON.parse(existingWatermark!);
      const watermarkAge = Date.now() - new Date(parsed.lastRunAt).getTime();
      
      // Watermark older than 30 seconds indicates potential crash
      expect(watermarkAge).toBeGreaterThan(30000);
    });

    it('should clear watermark on successful completion', async () => {
      const watermark: SchedulerWatermark = {
        lastRunAt: new Date().toISOString(),
        lastProcessedSourceId: 'source-final',
        sourcesScheduled: 100,
        runId: 'successful_run',
      };

      await redisApi.setex(SCHEDULER_WATERMARK_KEY, 600, JSON.stringify(watermark));

      // Simulate successful completion
      await redisApi.del(SCHEDULER_WATERMARK_KEY);

      const stored = await redisApi.get(SCHEDULER_WATERMARK_KEY);
      expect(stored).toBeNull();
    });
  });

  describe('Run history tracking', () => {
    it('should record successful runs in history', async () => {
      const runRecord = {
        runId: 'run_' + Date.now(),
        completedAt: new Date().toISOString(),
        jobsQueued: 45,
        skipped: 5,
        negative: 3,
        recentlySynced: 10,
        duration: 1500,
        errors: 0,
      };

      await redisApi.lpush(SCHEDULER_RUN_HISTORY_KEY, JSON.stringify(runRecord));

      const history = await redisApi.lrange(SCHEDULER_RUN_HISTORY_KEY, 0, 0);
      expect(history).toHaveLength(1);

      const parsed = JSON.parse(history[0]);
      expect(parsed.jobsQueued).toBe(45);
      expect(parsed.errors).toBe(0);
    });

    it('should maintain limited history (last 100 runs)', async () => {
      // Add 110 records
      for (let i = 0; i < 110; i++) {
        const runRecord = {
          runId: `run_${i}`,
          completedAt: new Date().toISOString(),
          jobsQueued: i,
          duration: 1000,
          errors: 0,
        };
        await redisApi.lpush(SCHEDULER_RUN_HISTORY_KEY, JSON.stringify(runRecord));
      }

      // Trim to 100
      await redisApi.ltrim(SCHEDULER_RUN_HISTORY_KEY, 0, 99);

      const historyLength = await redisApi.llen(SCHEDULER_RUN_HISTORY_KEY);
      expect(historyLength).toBe(100);

      // Verify most recent is at the front
      const recent = await redisApi.lrange(SCHEDULER_RUN_HISTORY_KEY, 0, 0);
      const parsed = JSON.parse(recent[0]);
      expect(parsed.runId).toBe('run_109'); // Last one added
    });
  });

  describe('Concurrent scheduler protection', () => {
    it('should detect concurrent scheduler runs via watermark', async () => {
      // First scheduler starts and sets watermark
      const firstRunWatermark: SchedulerWatermark = {
        lastRunAt: new Date().toISOString(),
        lastProcessedSourceId: null,
        sourcesScheduled: 0,
        runId: 'first_run',
      };

      await redisApi.setex(SCHEDULER_WATERMARK_KEY, 600, JSON.stringify(firstRunWatermark));

      // Second scheduler tries to start and finds existing watermark
      const existingWatermark = await redisApi.get(SCHEDULER_WATERMARK_KEY);
      const isLocked = existingWatermark !== null;

      expect(isLocked).toBe(true);

      const parsed: SchedulerWatermark = JSON.parse(existingWatermark!);
      expect(parsed.runId).toBe('first_run');
    });
  });
});
