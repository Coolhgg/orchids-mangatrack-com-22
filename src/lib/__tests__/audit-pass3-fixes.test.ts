/**
 * AUDIT PASS 3 BUG FIXES - COMPREHENSIVE TEST SUITE
 * 
 * Tests for bugs 36-60:
 * - 36: URL normalization
 * - 37: Source ID extraction
 * - 38: Similarity scoring
 * - 39: Worker env validation
 * - 40: Redis health checks
 * - 41: Worker execution IDs
 * - 42: Queue configuration
 * - 43: Dead letter queue
 * - 44: Job payload validation
 * - 45-46: Chapter dedup and source locking
 * - 47-48: Sync error classification
 * - 49-51: Scheduler watermarks
 * - 52-54: API validation
 * - 55-56: Structured logging
 * - 57-60: TypeScript safety
 */

import {
  // Bug 36
  normalizeUrl,
  generateUrlDedupeKey,
  // Bug 37
  extractPlatformIdSafe,
  // Bug 38
  normalizeForSimilarity,
  calculateSimilarityUnicodeSafe,
  // Bug 39
  validateWorkerEnv,
  // Bug 40
  checkRedisHealth,
  // Bug 41
  initWorkerRunId,
  getWorkerRunId,
  getWorkerUptime,
  // Bug 42
  QUEUE_CONFIGS,
  getQueueConfig,
  // Bug 43
  addToDeadLetterQueue,
  getDeadLetterQueueEntries,
  getDeadLetterQueueCount,
  // Bug 44
  JobPayloadSchemas,
  validateJobPayload,
  // Bug 45-46
  generateChapterDedupeKey,
  buildSourceLockQuery,
  // Bug 47-48
  classifySyncError,
  // Bug 49-51
  startSchedulerRun,
  completeSchedulerRun,
  getSchedulerWatermark,
  shouldScheduleSource,
  // Bug 52-54
  createApiError,
  createApiSuccess,
  validateSourceUrl,
  // Bug 55-56
  createLogContext,
  formatStructuredLog,
  logStateTransition,
  getRecentTransitions,
  // Bug 57-60
  parseApiResponse,
  requireProperty,
  assertExhaustive,
  handleMetadataStatus,
  toUTCDate,
  toUTCTimestamp,
  formatUTCDate,
  nowUTC,
} from '../audit-pass3-fixes';
import { z } from 'zod';

// ==========================================
// BUG 36: URL Normalization Tests
// ==========================================
describe('Bug 36: URL Normalization', () => {
  describe('normalizeUrl', () => {
    it('should preserve query parameters', () => {
      const result = normalizeUrl('https://example.com/page?foo=bar&baz=qux');
      expect(result?.query).toBe('baz=qux&foo=bar'); // Sorted alphabetically
      expect(result?.normalized).toContain('?baz=qux&foo=bar');
    });

    it('should preserve hash fragments', () => {
      const result = normalizeUrl('https://example.com/page#section');
      expect(result?.hash).toBe('#section');
      expect(result?.normalized).toContain('#section');
    });

    it('should handle case sensitivity correctly', () => {
      const result = normalizeUrl('HTTPS://EXAMPLE.COM/Path/To/Page');
      expect(result?.scheme).toBe('https:');
      expect(result?.host).toBe('example.com');
      expect(result?.path).toBe('/Path/To/Page'); // Path preserves case
    });

    it('should remove trailing slashes from paths', () => {
      const result = normalizeUrl('https://example.com/page/');
      expect(result?.path).toBe('/page');
    });

    it('should keep root path as-is', () => {
      const result = normalizeUrl('https://example.com/');
      expect(result?.path).toBe('/');
    });

    it('should return null for invalid URLs', () => {
      expect(normalizeUrl(null)).toBeNull();
      expect(normalizeUrl(undefined)).toBeNull();
      expect(normalizeUrl('')).toBeNull();
    });

    it('should handle invalid URL format gracefully', () => {
      const result = normalizeUrl('not-a-url');
      expect(result?.isValid).toBe(false);
    });

    it('should remove duplicate slashes', () => {
      const result = normalizeUrl('https://example.com//path//to//page');
      expect(result?.path).toBe('/path/to/page');
    });
  });

  describe('generateUrlDedupeKey', () => {
    it('should generate consistent keys for same URLs', () => {
      const key1 = generateUrlDedupeKey('https://mangadex.org/title/abc-123');
      const key2 = generateUrlDedupeKey('https://mangadex.org/title/abc-123/');
      expect(key1).toBe(key2);
    });

    it('should generate different keys for different paths', () => {
      const key1 = generateUrlDedupeKey('https://mangadex.org/title/abc');
      const key2 = generateUrlDedupeKey('https://mangadex.org/title/def');
      expect(key1).not.toBe(key2);
    });
  });
});

// ==========================================
// BUG 37: Source ID Extraction Tests
// ==========================================
describe('Bug 37: Source ID Extraction', () => {
  describe('extractPlatformIdSafe', () => {
    it('should extract MangaDex IDs correctly', () => {
      const result = extractPlatformIdSafe('https://mangadex.org/title/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.platform).toBe('mangadex');
        expect(result.id).toBe('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
        expect(result.confidence).toBe('high');
      }
    });

    it('should return detailed error for invalid URL', () => {
      const result = extractPlatformIdSafe('not-a-url');
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toBe('invalid_url');
        expect(result.message).toContain('not a valid URL');
      }
    });

    it('should return detailed error for unsupported source', () => {
      const result = extractPlatformIdSafe('https://unknown-site.com/manga/123');
      expect(result.success).toBe(false);
      if (result.success === false) {
        expect(result.error).toBe('unsupported_source');
        expect(result.message).toContain('does not match');
      }
    });

    it('should return error for null/undefined URL', () => {
      const result1 = extractPlatformIdSafe(null);
      expect(result1.success).toBe(false);
      if (result1.success === false) {
        expect(result1.error).toBe('invalid_url');
      }

      const result2 = extractPlatformIdSafe(undefined);
      expect(result2.success).toBe(false);
    });

    it('should extract MangaSee IDs', () => {
      const result = extractPlatformIdSafe('https://mangasee123.com/manga/One-Piece');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.platform).toBe('mangasee');
        expect(result.id).toBe('One-Piece');
      }
    });

    it('should extract MangaPark IDs', () => {
      const result = extractPlatformIdSafe('https://mangapark.net/title/some-manga-id');
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.platform).toBe('mangapark');
      }
    });
  });
});

// ==========================================
// BUG 38: Similarity Scoring Tests
// ==========================================
describe('Bug 38: Similarity Scoring with Unicode', () => {
  describe('normalizeForSimilarity', () => {
    it('should normalize accented characters', () => {
      const normalized = normalizeForSimilarity('Café Stories');
      expect(normalized).toBe('cafe stories');
    });

    it('should handle Japanese characters', () => {
      const normalized = normalizeForSimilarity('ワンピース (One Piece)');
      expect(normalized).toContain('ワンピース');
    });

    it('should remove bracketed content', () => {
      const normalized = normalizeForSimilarity('Series Name [Scanlator Group]');
      expect(normalized).toBe('series name');
    });

    it('should remove articles', () => {
      expect(normalizeForSimilarity('The Great Manga')).toBe('great manga');
      expect(normalizeForSimilarity('A Hero\'s Journey')).toBe("hero's journey");
    });
  });

  describe('calculateSimilarityUnicodeSafe', () => {
    it('should return 1.0 for identical strings after normalization', () => {
      const score = calculateSimilarityUnicodeSafe('Café', 'cafe');
      expect(score).toBe(1.0);
    });

    it('should handle Unicode characters correctly', () => {
      const score = calculateSimilarityUnicodeSafe('naïve', 'naive');
      expect(score).toBe(1.0);
    });

    it('should score similar strings highly', () => {
      const score = calculateSimilarityUnicodeSafe('One Piece', 'One Piece (Manga)');
      expect(score).toBeGreaterThan(0.7);
    });

    it('should return 0 for very short strings', () => {
      expect(calculateSimilarityUnicodeSafe('a', 'b')).toBe(0);
    });
  });
});

// ==========================================
// BUG 39: Worker Env Validation Tests
// ==========================================
describe('Bug 39: Worker Environment Validation', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should validate when all required vars are present', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    process.env.REDIS_URL = 'redis://localhost:6379';
    
    const result = validateWorkerEnv();
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    process.env.REDIS_URL = 'redis://localhost:6379';
    
    const result = validateWorkerEnv();
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('DATABASE_URL'))).toBe(true);
  });

  it('should accept Upstash REST URL as alternative to REDIS_URL', () => {
    process.env.DATABASE_URL = 'postgresql://localhost/test';
    delete process.env.REDIS_URL;
    process.env.UPSTASH_REDIS_REST_URL = 'https://upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'token123';
    
    const result = validateWorkerEnv();
    expect(result.valid).toBe(true);
  });
});

// ==========================================
// BUG 40: Redis Health Check Tests
// ==========================================
describe('Bug 40: Redis Health Check', () => {
  it('should return healthy status for successful ping', async () => {
    const mockRedis = { ping: jest.fn().mockResolvedValue('PONG') };
    
    const result = await checkRedisHealth(mockRedis);
    expect(result.healthy).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.error).toBeNull();
  });

  it('should return unhealthy status for failed ping', async () => {
    const mockRedis = { ping: jest.fn().mockRejectedValue(new Error('Connection refused')) };
    
    const result = await checkRedisHealth(mockRedis);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('Connection refused');
  });

  it('should timeout if ping takes too long', async () => {
    const mockRedis = { 
      ping: jest.fn().mockImplementation(() => new Promise(r => setTimeout(r, 10000)))
    };
    
    const result = await checkRedisHealth(mockRedis, 100);
    expect(result.healthy).toBe(false);
    expect(result.error).toContain('timeout');
  });
});

// ==========================================
// BUG 41: Worker Execution ID Tests
// ==========================================
describe('Bug 41: Worker Execution ID', () => {
  it('should generate unique worker run IDs', () => {
    const id1 = initWorkerRunId();
    const id2 = initWorkerRunId();
    expect(id1).not.toBe(id2);
  });

  it('should return same ID after initialization', () => {
    initWorkerRunId();
    const id1 = getWorkerRunId();
    const id2 = getWorkerRunId();
    expect(id1).toBe(id2);
  });

  it('should track uptime', async () => {
    initWorkerRunId();
    const uptime1 = getWorkerUptime();
    await new Promise(r => setTimeout(r, 50));
    const uptime2 = getWorkerUptime();
    expect(uptime2).toBeGreaterThan(uptime1);
  });
});

// ==========================================
// BUG 42: Queue Configuration Tests
// ==========================================
describe('Bug 42: Queue Configuration', () => {
  it('should have lock duration for sync-source queue', () => {
    const config = getQueueConfig('sync-source');
    expect(config.lockDuration).toBe(120000); // 2 minutes
    expect(config.stalledInterval).toBe(30000);
  });

  it('should have extended lock duration for series-resolution', () => {
    const config = getQueueConfig('series-resolution');
    expect(config.lockDuration).toBe(300000); // 5 minutes
  });

  it('should return defaults for unknown queues', () => {
    const config = getQueueConfig('unknown-queue');
    expect(config.queueName).toBe('unknown-queue');
    expect(config.lockDuration).toBe(60000);
  });
});

// ==========================================
// BUG 43: Dead Letter Queue Tests
// ==========================================
describe('Bug 43: Dead Letter Queue', () => {
  it('should add entries to DLQ', () => {
    const initialCount = getDeadLetterQueueCount();
    
    addToDeadLetterQueue({
      originalQueue: 'test-queue',
      jobId: 'job-123',
      jobName: 'test-job',
      payload: { data: 'test' },
      failureReason: 'Test failure',
      attemptsMade: 3,
      maxAttempts: 3
    });

    expect(getDeadLetterQueueCount()).toBe(initialCount + 1);
  });

  it('should retrieve recent entries', () => {
    const entries = getDeadLetterQueueEntries(10);
    expect(Array.isArray(entries)).toBe(true);
  });

  it('should include worker run ID in entries', () => {
    initWorkerRunId();
    const entry = addToDeadLetterQueue({
      originalQueue: 'test-queue',
      jobId: 'job-456',
      jobName: 'test-job',
      payload: {},
      failureReason: 'Test',
      attemptsMade: 1,
      maxAttempts: 3
    });

    expect(entry.workerRunId).toBeDefined();
    expect(entry.workerRunId.startsWith('worker-')).toBe(true);
  });
});

// ==========================================
// BUG 44: Job Payload Validation Tests
// ==========================================
describe('Bug 44: Job Payload Validation', () => {
  it('should validate sync-source payload', () => {
    const result = validateJobPayload('syncSource', {
      seriesSourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    });
    expect(result.valid).toBe(true);
  });

  it('should reject invalid UUID in sync-source', () => {
    const result = validateJobPayload('syncSource', {
      seriesSourceId: 'not-a-uuid'
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should validate chapter-ingest payload', () => {
    const result = validateJobPayload('chapterIngest', {
      seriesSourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      seriesId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      chapterNumber: 1,
      chapterTitle: 'Chapter 1',
      chapterUrl: 'https://example.com/chapter/1',
      publishedAt: '2025-01-01T00:00:00Z'
    });
    expect(result.valid).toBe(true);
  });

  it('should reject invalid chapter URL', () => {
    const result = validateJobPayload('chapterIngest', {
      seriesSourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      seriesId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
      chapterTitle: null,
      chapterUrl: 'not-a-url',
      publishedAt: null
    });
    expect(result.valid).toBe(false);
  });
});

// ==========================================
// BUG 45-46: Chapter Dedup and Source Locking Tests
// ==========================================
describe('Bug 45-46: Chapter Dedup and Source Locking', () => {
  it('should generate consistent dedup keys', () => {
    const key1 = generateChapterDedupeKey('series-1', '10');
    const key2 = generateChapterDedupeKey('series-1', 10);
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different chapters', () => {
    const key1 = generateChapterDedupeKey('series-1', '10');
    const key2 = generateChapterDedupeKey('series-1', '11');
    expect(key1).not.toBe(key2);
  });

  it('should build proper lock query', () => {
    const query = buildSourceLockQuery('a1b2c3d4-e5f6-7890-abcd-ef1234567890');
    expect(query).toContain('FOR UPDATE SKIP LOCKED');
    expect(query).toContain('series_sources');
  });
});

// ==========================================
// BUG 47-48: Sync Error Classification Tests
// ==========================================
describe('Bug 47-48: Sync Error Classification', () => {
  it('should classify timeout errors', () => {
    const result = classifySyncError(new Error('Request timeout'));
    expect(result.errorType).toBe('timeout');
    expect(result.retryable).toBe(true);
  });

  it('should classify network errors', () => {
    const result = classifySyncError(new Error('ECONNREFUSED'));
    expect(result.errorType).toBe('network');
    expect(result.retryable).toBe(true);
  });

  it('should classify parse errors as non-retryable', () => {
    const result = classifySyncError(new Error('JSON parse error'));
    expect(result.errorType).toBe('parse');
    expect(result.retryable).toBe(false);
  });

  it('should truncate long error messages', () => {
    const longError = new Error('x'.repeat(1000));
    const result = classifySyncError(longError);
    expect(result.message.length).toBeLessThanOrEqual(500);
  });
});

// ==========================================
// BUG 49-51: Scheduler Watermarks Tests
// ==========================================
describe('Bug 49-51: Scheduler State and Watermarks', () => {
  it('should track scheduler runs', () => {
    const runId = startSchedulerRun('test-scheduler');
    expect(runId).toContain('test-scheduler');
    
    const watermark = getSchedulerWatermark('test-scheduler');
    expect(watermark?.lastRunStatus).toBe('running');
  });

  it('should complete scheduler runs', () => {
    startSchedulerRun('complete-test');
    completeSchedulerRun('complete-test', 100);
    
    const watermark = getSchedulerWatermark('complete-test');
    expect(watermark?.lastRunStatus).toBe('completed');
    expect(watermark?.itemsProcessed).toBe(100);
  });

  it('should mark runs with errors as failed', () => {
    startSchedulerRun('error-test');
    completeSchedulerRun('error-test', 50, ['Error 1', 'Error 2']);
    
    const watermark = getSchedulerWatermark('error-test');
    expect(watermark?.lastRunStatus).toBe('failed');
    expect(watermark?.errors).toHaveLength(2);
  });

  describe('shouldScheduleSource', () => {
    it('should not schedule disabled sources', () => {
      const result = shouldScheduleSource({
        source_status: 'disabled',
        sync_priority: 'HOT'
      });
      expect(result.schedule).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should not schedule broken sources', () => {
      const result = shouldScheduleSource({
        source_status: 'broken',
        sync_priority: 'HOT'
      });
      expect(result.schedule).toBe(false);
    });

    it('should not schedule frozen sources', () => {
      const result = shouldScheduleSource({
        source_status: 'active',
        sync_priority: 'FROZEN'
      });
      expect(result.schedule).toBe(false);
    });

    it('should not schedule sources with too many failures', () => {
      const result = shouldScheduleSource({
        source_status: 'active',
        sync_priority: 'HOT',
        consecutive_failures: 15
      });
      expect(result.schedule).toBe(false);
    });

    it('should schedule healthy sources', () => {
      const result = shouldScheduleSource({
        source_status: 'active',
        sync_priority: 'HOT',
        consecutive_failures: 0
      });
      expect(result.schedule).toBe(true);
    });
  });
});

// ==========================================
// BUG 52-54: API Validation and Error Shapes Tests
// ==========================================
describe('Bug 52-54: API Validation', () => {
  describe('createApiError', () => {
    it('should create standardized error response', () => {
      const error = createApiError('NOT_FOUND', 'Resource not found', 'req-123');
      expect(error.success).toBe(false);
      expect(error.error.code).toBe('NOT_FOUND');
      expect(error.error.message).toBe('Resource not found');
      expect(error.requestId).toBe('req-123');
      expect(error.timestamp).toBeDefined();
    });

    it('should include details when provided', () => {
      const error = createApiError('VALIDATION_ERROR', 'Invalid input', 'req-456', {
        field: 'email',
        constraint: 'format'
      });
      expect(error.error.details?.field).toBe('email');
    });
  });

  describe('createApiSuccess', () => {
    it('should create standardized success response', () => {
      const response = createApiSuccess({ id: '123', name: 'Test' }, 'req-789');
      expect(response.success).toBe(true);
      expect(response.data.id).toBe('123');
      expect(response.requestId).toBe('req-789');
    });
  });

  describe('validateSourceUrl', () => {
    it('should validate MangaDex URLs', () => {
      const result = validateSourceUrl('https://mangadex.org/title/a1b2c3d4-e5f6-7890-abcd-ef1234567890');
      expect(result.valid).toBe(true);
      expect(result.platform).toBe('mangadex');
    });

    it('should reject invalid URLs', () => {
      const result = validateSourceUrl('not-a-url');
      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid URL format');
    });

    it('should accept unknown platforms as valid but unidentified', () => {
      const result = validateSourceUrl('https://unknown-manga-site.com/series/123');
      expect(result.valid).toBe(true);
      expect(result.platform).toBeNull();
    });
  });
});

// ==========================================
// BUG 55-56: Structured Logging Tests
// ==========================================
describe('Bug 55-56: Structured Logging', () => {
  describe('createLogContext', () => {
    it('should include worker run ID', () => {
      initWorkerRunId();
      const ctx = createLogContext({ jobId: 'job-123' });
      expect(ctx.workerRunId).toBeDefined();
      expect(ctx.jobId).toBe('job-123');
    });
  });

  describe('formatStructuredLog', () => {
    it('should format log with context', () => {
      const ctx = createLogContext({ seriesId: 'series-123' });
      const log = formatStructuredLog('info', 'Test message', ctx);
      expect(log).toContain('[INFO]');
      expect(log).toContain('Test message');
      expect(log).toContain('seriesId="series-123"');
    });
  });

  describe('logStateTransition', () => {
    it('should log state transitions', () => {
      logStateTransition({
        entityType: 'library_entry',
        entityId: 'entry-123',
        field: 'metadata_status',
        previousValue: 'pending',
        newValue: 'enriched',
        changedBy: 'worker'
      });

      const transitions = getRecentTransitions('entry-123');
      expect(transitions.length).toBeGreaterThan(0);
      expect(transitions[0].field).toBe('metadata_status');
    });
  });
});

// ==========================================
// BUG 57-60: TypeScript Safety Tests
// ==========================================
describe('Bug 57-60: TypeScript Safety', () => {
  describe('parseApiResponse', () => {
    it('should parse valid responses', () => {
      const schema = z.object({ id: z.string(), name: z.string() });
      const result = parseApiResponse({ id: '123', name: 'Test' }, schema, 'TestAPI');
      expect(result.id).toBe('123');
    });

    it('should throw on invalid responses', () => {
      const schema = z.object({ id: z.string() });
      expect(() => parseApiResponse({ invalid: true }, schema, 'TestAPI')).toThrow();
    });
  });

  describe('requireProperty', () => {
    it('should return value when present', () => {
      const obj = { name: 'Test', value: 42 };
      expect(requireProperty(obj, 'name')).toBe('Test');
      expect(requireProperty(obj, 'value')).toBe(42);
    });

    it('should throw when object is null', () => {
      expect(() => requireProperty(null, 'name' as never)).toThrow();
    });

    it('should throw when property is undefined', () => {
      const obj = { name: undefined as string | undefined };
      expect(() => requireProperty(obj, 'name')).toThrow();
    });
  });

  describe('handleMetadataStatus', () => {
    it('should handle all status values', () => {
      expect(handleMetadataStatus('pending')).toContain('Awaiting');
      expect(handleMetadataStatus('enriched')).toContain('successfully');
      expect(handleMetadataStatus('unavailable')).toContain('No metadata');
      expect(handleMetadataStatus('failed')).toContain('failed');
    });
  });

  describe('UTC Date Handling', () => {
    it('should convert to UTC date', () => {
      const date = toUTCDate('2025-01-15T12:00:00Z');
      expect(date).toBeInstanceOf(Date);
      expect(date?.toISOString()).toBe('2025-01-15T12:00:00.000Z');
    });

    it('should return null for invalid dates', () => {
      expect(toUTCDate('not-a-date')).toBeNull();
      expect(toUTCDate(null)).toBeNull();
      expect(toUTCDate(undefined)).toBeNull();
    });

    it('should format dates to ISO string', () => {
      const date = new Date('2025-01-15T12:00:00Z');
      expect(formatUTCDate(date)).toBe('2025-01-15T12:00:00.000Z');
    });

    it('should get current UTC timestamp', () => {
      const before = Date.now();
      const now = nowUTC();
      const after = Date.now();
      
      expect(now.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.getTime()).toBeLessThanOrEqual(after);
    });
  });
});

// ==========================================
// Integration Tests
// ==========================================
describe('Integration Tests', () => {
  it('should handle full URL normalization and platform extraction flow', () => {
    const url = 'https://mangadex.org/title/a1b2c3d4-e5f6-7890-abcd-ef1234567890/some-manga';
    
    // Normalize
    const normalized = normalizeUrl(url);
    expect(normalized?.isValid).toBe(true);
    
    // Extract platform ID
    const extraction = extractPlatformIdSafe(url);
    expect(extraction.success).toBe(true);
    
    // Validate for library
    const validation = validateSourceUrl(url);
    expect(validation.valid).toBe(true);
    expect(validation.platform).toBe('mangadex');
  });

  it('should handle full job processing flow', () => {
    // Start scheduler
    const runId = startSchedulerRun('integration-test');
    
    // Process job
    const payload = {
      seriesSourceId: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
    };
    const validated = validateJobPayload('syncSource', payload);
    expect(validated.valid).toBe(true);
    
    // Complete scheduler
    completeSchedulerRun('integration-test', 1);
    
    const watermark = getSchedulerWatermark('integration-test');
    expect(watermark?.lastRunStatus).toBe('completed');
  });

  it('should handle error flow with DLQ', () => {
    // Classify error
    const error = new Error('Connection timeout');
    const classified = classifySyncError(error);
    
    // Add to DLQ if non-retryable (for demo, we add anyway)
    const dlqEntry = addToDeadLetterQueue({
      originalQueue: 'test-queue',
      jobId: 'integration-job',
      jobName: 'test',
      payload: { test: true },
      failureReason: classified.message,
      attemptsMade: 3,
      maxAttempts: 3
    });
    
    expect(dlqEntry.id).toBeDefined();
    expect(dlqEntry.failureReason).toContain('timeout');
  });
});
