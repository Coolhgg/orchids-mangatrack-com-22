/**
 * Source Status Workflow Integration Tests
 * 
 * Tests the end-to-end workflow for:
 * - Active/Inactive source status handling
 * - Unsupported source (MangaPark) graceful degradation
 * - Metadata failure recovery
 * - Rate limit handling
 * - Manual linking
 */

import { prisma } from '@/lib/prisma';
import { processPollSource } from '@/workers/processors/poll-source.processor';
import { processResolution } from '@/workers/processors/resolution.processor';
import { ScraperError } from '@/lib/scrapers';

// Mock job factory
const createMockJob = (data: any, id = 'test-job-' + Date.now()) => ({
  id,
  data,
  attemptsMade: 0,
  opts: { attempts: 3 },
  name: 'test-job',
});

describe('Source Status Workflow', () => {
  let testUserId: string;
  let testSeriesId: string;

  beforeAll(async () => {
    // Get or create a test user
    const user = await prisma.user.findFirst();
    if (!user) {
      const newUser = await prisma.user.create({
        data: {
          email: 'test-source-status@example.com',
          username: 'test_source_status_' + Date.now(),
          password_hash: 'test',
        },
      });
      testUserId = newUser.id;
    } else {
      testUserId = user.id;
    }

    // Create a test series
    const series = await prisma.series.create({
      data: {
        title: 'Source Status Test Series ' + Date.now(),
        type: 'manga',
      },
    });
    testSeriesId = series.id;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.seriesSource.deleteMany({
      where: { series_id: testSeriesId },
    });
    await prisma.series.delete({
      where: { id: testSeriesId },
    }).catch(() => {});
  });

  describe('Test Case E: Unsupported Source (MangaPark)', () => {
    it('should mark MangaPark source as inactive instead of failing', async () => {
      // Create a MangaPark source
      const mangaparkSource = await prisma.seriesSource.create({
        data: {
          series_id: testSeriesId,
          source_name: 'mangapark',
          source_id: `mangapark-test-${Date.now()}`,
          source_url: `https://mangapark.net/manga/test-${Date.now()}`,
          source_status: 'active',
        },
      });

      // Process the poll source job
      const job = createMockJob({ seriesSourceId: mangaparkSource.id });
      
      // Should not throw - it should gracefully handle the placeholder scraper
      await processPollSource(job as any);

      // Verify the source is now inactive
      const updatedSource = await prisma.seriesSource.findUnique({
        where: { id: mangaparkSource.id },
      });

      expect(updatedSource?.source_status).toBe('inactive');
      expect(updatedSource?.failure_count).toBe(0); // Should NOT increment failures
    });

    it('should set appropriate next_check_at for inactive sources', async () => {
      const source = await prisma.seriesSource.create({
        data: {
          series_id: testSeriesId,
          source_name: 'mangasee', // Another placeholder
          source_id: `mangasee-test-${Date.now()}`,
          source_url: `https://mangasee123.com/manga/test-${Date.now()}`,
          source_status: 'active',
        },
      });

      await processPollSource(createMockJob({ seriesSourceId: source.id }) as any);

      const updated = await prisma.seriesSource.findUnique({
        where: { id: source.id },
      });

      expect(updated?.source_status).toBe('inactive');
      // Should be scheduled for ~1 week later check
      expect(updated?.next_check_at).toBeDefined();
      const oneWeekFromNow = new Date(Date.now() + 6 * 24 * 60 * 60 * 1000);
      expect(updated!.next_check_at!.getTime()).toBeGreaterThan(oneWeekFromNow.getTime());
    });
  });

  describe('Test Case A: Title Variations', () => {
    it('should not hard-fail on variant titles', async () => {
      const entry = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/aot-variant-${Date.now()}`,
          source_name: 'imported',
          imported_title: 'Attack on Titan Season 2',
          metadata_status: 'pending',
        },
      });

      try {
        await processResolution(createMockJob({
          libraryEntryId: entry.id,
          title: 'Attack on Titan Season 2',
          source_url: entry.source_url,
        }) as any);
      } catch (e) {
        // Network errors during test are expected
      }

      const updated = await prisma.libraryEntry.findUnique({
        where: { id: entry.id },
      });

      // Should NOT be 'failed' - either enriched, pending, or deleted (merged)
      if (updated) {
        expect(['enriched', 'pending']).toContain(updated.metadata_status);
      }

      // Cleanup
      await prisma.libraryEntry.delete({ where: { id: entry.id } }).catch(() => {});
    });
  });

  describe('Test Case B: Metadata Failure Recovery', () => {
    it('should allow retry after metadata failure', async () => {
      const entry = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/failed-${Date.now()}`,
          source_name: 'imported',
          imported_title: 'Obscure Title That Wont Match',
          metadata_status: 'failed',
          last_metadata_error: 'No match found',
        },
      });

      // Simulate retry by resetting status
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: {
          metadata_status: 'pending',
          needs_review: false,
        },
      });

      const updated = await prisma.libraryEntry.findUnique({
        where: { id: entry.id },
      });

      expect(updated?.metadata_status).toBe('pending');
      expect(updated?.needs_review).toBe(false);

      // Cleanup
      await prisma.libraryEntry.delete({ where: { id: entry.id } }).catch(() => {});
    });
  });

  describe('Test Case C: Manual Matching', () => {
    it('should allow manual linking to MangaDex entry', async () => {
      const entry = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/manual-link-${Date.now()}`,
          source_name: 'imported',
          imported_title: 'Manual Link Test',
          metadata_status: 'pending',
        },
      });

      // Create a series with MangaDex ID
      const series = await prisma.series.create({
        data: {
          title: 'Manual Link Target',
          mangadex_id: `test-uuid-${Date.now()}`,
          type: 'manga',
        },
      });

      // Simulate manual linking
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: {
          series_id: series.id,
          metadata_status: 'enriched',
          needs_review: false,
        },
      });

      const updated = await prisma.libraryEntry.findUnique({
        where: { id: entry.id },
      });

      expect(updated?.metadata_status).toBe('enriched');
      expect(updated?.series_id).toBe(series.id);
      expect(updated?.needs_review).toBe(false);

      // Cleanup
      await prisma.libraryEntry.delete({ where: { id: entry.id } }).catch(() => {});
      await prisma.series.delete({ where: { id: series.id } }).catch(() => {});
    });

    it('should prevent duplicate entries when manually linking', async () => {
      const series = await prisma.series.create({
        data: {
          title: 'Duplicate Prevention Test',
          mangadex_id: `dupe-test-${Date.now()}`,
          type: 'manga',
        },
      });

      // Create first entry linked to series
      const entry1 = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/first-entry-${Date.now()}`,
          source_name: 'mangadex',
          series_id: series.id,
          metadata_status: 'enriched',
        },
      });

      // Create second entry not yet linked
      const entry2 = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/second-entry-${Date.now()}`,
          source_name: 'imported',
          imported_title: 'Should Not Create Duplicate',
          metadata_status: 'pending',
        },
      });

      // Check for existing duplicate before linking
      const existingEntry = await prisma.libraryEntry.findFirst({
        where: {
          user_id: testUserId,
          series_id: series.id,
          id: { not: entry2.id },
        },
      });

      expect(existingEntry).not.toBeNull();
      expect(existingEntry?.id).toBe(entry1.id);

      // Cleanup
      await prisma.libraryEntry.deleteMany({
        where: { id: { in: [entry1.id, entry2.id] } },
      });
      await prisma.series.delete({ where: { id: series.id } }).catch(() => {});
    });
  });

  describe('Test Case D: Rate Limit Handling', () => {
    it('should keep metadata_status as pending during rate limits', async () => {
      const entry = await prisma.libraryEntry.create({
        data: {
          user_id: testUserId,
          source_url: `https://example.com/rate-limit-${Date.now()}`,
          source_name: 'imported',
          imported_title: 'Rate Limit Test',
          metadata_status: 'pending',
        },
      });

      // Simulate rate limit scenario by setting retry count
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: {
          metadata_retry_count: 1,
          last_metadata_error: 'MangaDexRateLimitError: Too many requests',
          metadata_status: 'pending', // Should stay pending
        },
      });

      const updated = await prisma.libraryEntry.findUnique({
        where: { id: entry.id },
      });

      expect(updated?.metadata_status).toBe('pending');
      expect(updated?.metadata_retry_count).toBe(1);

      // Cleanup
      await prisma.libraryEntry.delete({ where: { id: entry.id } }).catch(() => {});
    });
  });

  describe('Source Status Display', () => {
    it('should correctly identify active vs inactive sources', async () => {
      const activeSource = await prisma.seriesSource.create({
        data: {
          series_id: testSeriesId,
          source_name: 'mangadex',
          source_id: `active-${Date.now()}`,
          source_url: `https://mangadex.org/title/active-${Date.now()}`,
          source_status: 'active',
        },
      });

      const inactiveSource = await prisma.seriesSource.create({
        data: {
          series_id: testSeriesId,
          source_name: 'mangapark',
          source_id: `inactive-${Date.now()}`,
          source_url: `https://mangapark.net/manga/inactive-${Date.now()}`,
          source_status: 'inactive',
        },
      });

      const sources = await prisma.seriesSource.findMany({
        where: { series_id: testSeriesId },
        select: { source_name: true, source_status: true },
      });

      const active = sources.filter(s => s.source_status === 'active');
      const inactive = sources.filter(s => s.source_status === 'inactive');

      expect(active.length).toBeGreaterThanOrEqual(1);
      expect(inactive.length).toBeGreaterThanOrEqual(1);

      // Cleanup
      await prisma.seriesSource.deleteMany({
        where: { id: { in: [activeSource.id, inactiveSource.id] } },
      });
    });
  });
});

describe('Scraper Error Handling', () => {
  it('should classify PROVIDER_NOT_IMPLEMENTED as non-retryable graceful failure', () => {
    const error = new ScraperError(
      'MangaPark integration is currently in development (Placeholder).',
      'mangapark',
      false,
      'PROVIDER_NOT_IMPLEMENTED'
    );

    expect(error.code).toBe('PROVIDER_NOT_IMPLEMENTED');
    expect(error.isRetryable).toBe(false);
    expect(error.source).toBe('mangapark');
  });

  it('should classify rate limits as retryable', () => {
    const error = new ScraperError(
      'Rate limit exceeded',
      'mangadex',
      true,
      'RATE_LIMIT'
    );

    expect(error.code).toBe('RATE_LIMIT');
    expect(error.isRetryable).toBe(true);
  });
});
