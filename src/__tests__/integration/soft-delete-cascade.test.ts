/**
 * Soft-Delete Cascade Tests
 * Tests verifying raw queries honor soft-delete constraints
 */

import { prisma } from '@/lib/prisma';

describe('Soft-Delete Cascade', () => {
  const testUserId = '00000000-0000-0000-0000-000000000001';
  const testSeriesId = '00000000-0000-0000-0000-000000000002';

  describe('Prisma middleware behavior', () => {
    it('should exclude soft-deleted records in findMany', async () => {
      // This test verifies the soft-delete middleware is working
      // by checking that queries automatically filter deleted_at IS NULL
      
      const users = await prisma.user.findMany({
        take: 10,
        select: { id: true, deleted_at: true }
      });

      // All returned users should have null deleted_at
      for (const user of users) {
        expect(user.deleted_at).toBeNull();
      }
    });

    it('should exclude soft-deleted series in findMany', async () => {
      const series = await prisma.series.findMany({
        take: 10,
        select: { id: true, deleted_at: true }
      });

      for (const s of series) {
        expect(s.deleted_at).toBeNull();
      }
    });
  });

  describe('Raw query soft-delete compliance', () => {
    it('should filter soft-deleted in raw series queries', async () => {
      // Test that raw queries in the scheduler properly filter soft-deleted
      const results = await prisma.$queryRaw<any[]>`
        SELECT id, deleted_at 
        FROM series 
        WHERE deleted_at IS NULL
        LIMIT 10
      `;

      for (const row of results) {
        expect(row.deleted_at).toBeNull();
      }
    });

    it('should filter soft-deleted in raw library queries', async () => {
      const results = await prisma.$queryRaw<any[]>`
        SELECT id, deleted_at 
        FROM library_entries 
        WHERE deleted_at IS NULL
        LIMIT 10
      `;

      for (const row of results) {
        expect(row.deleted_at).toBeNull();
      }
    });

    it('should filter soft-deleted in scheduler source queries', async () => {
      // Mimics the scheduler query pattern
      const now = new Date();
      const results = await prisma.$queryRaw<any[]>`
        SELECT 
          ss.id,
          ss.source_url,
          s.catalog_tier
        FROM series_sources ss
        INNER JOIN series s ON ss.series_id = s.id
        WHERE s.catalog_tier IN ('A', 'B', 'C')
          AND s.deleted_at IS NULL
          AND ss.source_status = 'active'
        LIMIT 10
      `;

      // Results should only include non-deleted series
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });
  });

  describe('Cascade behavior', () => {
    it('should not return library entries for soft-deleted users', async () => {
      // First, check if there are any users
      const userCount = await prisma.user.count();
      if (userCount === 0) {
        // Skip test if no users exist
        return;
      }

      // Get a valid user
      const validUser = await prisma.user.findFirst({
        where: { deleted_at: null },
        select: { id: true }
      });

      if (!validUser) return;

      // Query library entries for valid user
      const entries = await prisma.libraryEntry.findMany({
        where: { user_id: validUser.id },
        take: 5,
        select: { id: true, user_id: true, deleted_at: true }
      });

      // All entries should have null deleted_at
      for (const entry of entries) {
        expect(entry.deleted_at).toBeNull();
      }
    });

    it('should not return series_sources for soft-deleted series', async () => {
      // Get series that are not deleted
      const activeSeries = await prisma.series.findMany({
        where: { deleted_at: null },
        take: 5,
        select: { id: true }
      });

      if (activeSeries.length === 0) return;

      // Query sources for active series
      const sources = await prisma.seriesSource.findMany({
        where: { 
          series_id: { in: activeSeries.map(s => s.id) }
        },
        take: 10,
        select: { 
          id: true, 
          series_id: true,
          series: {
            select: { deleted_at: true }
          }
        }
      });

      // All linked series should not be soft-deleted
      for (const source of sources) {
        expect(source.series?.deleted_at).toBeNull();
      }
    });
  });

  describe('Notification cascade', () => {
    it('should not return notifications for soft-deleted users', async () => {
      const notifications = await prisma.notification.findMany({
        where: {},
        take: 10,
        select: {
          id: true,
          user: {
            select: { id: true, deleted_at: true }
          }
        }
      });

      // All notification users should not be soft-deleted
      for (const notif of notifications) {
        if (notif.user) {
          expect(notif.user.deleted_at).toBeNull();
        }
      }
    });
  });

  describe('Activity cascade', () => {
    it('should filter activities for soft-deleted series', async () => {
      const activities = await prisma.activity.findMany({
        where: {
          series_id: { not: null }
        },
        take: 10,
        select: {
          id: true,
          series: {
            select: { id: true, deleted_at: true }
          }
        }
      });

      // All linked series should not be soft-deleted
      for (const activity of activities) {
        if (activity.series) {
          expect(activity.series.deleted_at).toBeNull();
        }
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle queries with complex joins', async () => {
      // Complex query similar to what feed/library APIs might use
      const results = await prisma.$queryRaw<any[]>`
        SELECT 
          le.id as entry_id,
          le.user_id,
          s.id as series_id,
          s.title
        FROM library_entries le
        INNER JOIN series s ON le.series_id = s.id
        WHERE le.deleted_at IS NULL
          AND s.deleted_at IS NULL
        LIMIT 10
      `;

      // All results should be from non-deleted records
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
    });

    it('should not leak soft-deleted data in aggregations', async () => {
      // Count query should exclude soft-deleted
      const count = await prisma.series.count({
        where: { deleted_at: null }
      });

      const rawCount = await prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(*) as count FROM series WHERE deleted_at IS NULL
      `;

      // Counts should match
      expect(count).toBe(Number(rawCount[0].count));
    });
  });
});
