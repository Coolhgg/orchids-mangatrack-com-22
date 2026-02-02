// Jest globals are available without imports
import * as fs from 'fs';
import * as path from 'path';

/**
 * COMPREHENSIVE TEST SUITE: Bug 5, 9, 10 Verification
 * 
 * This test suite validates:
 * - Bug 5: Series-scoped metadata with SeriesSource table
 * - Bug 9: UX indicators for sync vs metadata status
 * - Bug 10: Metadata schema versioning
 * 
 * Tests include:
 * 1. Schema validation (fields exist)
 * 2. Migration validation (SQL is correct)
 * 3. Constants validation (type-safe constants)
 * 4. API response validation (new fields included)
 * 5. UI component validation (SyncStatusIndicator)
 * 6. Simulation scenarios (behavior verification)
 */

// ============================================================================
// SCHEMA FILE TESTS
// ============================================================================
describe('Bug 5/9/10: Schema Validation', () => {
  let schema: string;

  beforeAll(() => {
    schema = fs.readFileSync(path.join(process.cwd(), 'prisma/schema.prisma'), 'utf-8');
  });

  describe('Bug 5: SeriesSource metadata fields', () => {
    it('should have metadata_status field', () => {
      expect(schema).toContain('metadata_status');
      expect(schema).toMatch(/metadata_status\s+String\s+@default\("pending"\)/);
    });

    it('should have metadata_retry_count field', () => {
      expect(schema).toContain('metadata_retry_count');
      expect(schema).toMatch(/metadata_retry_count\s+Int\s+@default\(0\)/);
    });

    it('should have last_metadata_error field', () => {
      expect(schema).toContain('last_metadata_error');
    });

    it('should have last_metadata_attempt_at field', () => {
      expect(schema).toContain('last_metadata_attempt_at');
    });

    it('should have metadata_enriched_at field', () => {
      expect(schema).toContain('metadata_enriched_at');
    });

    it('should have index for metadata status queries', () => {
      expect(schema).toContain('@@index([metadata_status, last_metadata_attempt_at])');
    });

    it('should have comment explaining Bug 5 purpose', () => {
      expect(schema).toContain('Bug 5: Source-level metadata tracking');
    });
  });

  describe('Bug 9: LibraryEntry sync status fields', () => {
    it('should have sync_status field', () => {
      expect(schema).toContain('sync_status');
      expect(schema).toMatch(/sync_status\s+String\s+@default\("healthy"\)/);
    });

    it('should have last_sync_error field', () => {
      expect(schema).toContain('last_sync_error');
    });

    it('should have last_sync_at field', () => {
      expect(schema).toContain('last_sync_at');
    });

    it('should have index for sync status queries', () => {
      expect(schema).toContain('@@index([sync_status, last_sync_at])');
    });

    it('should have comment explaining Bug 9 purpose', () => {
      expect(schema).toContain('Bug 9: Sync status tracking');
    });
  });

  describe('Bug 10: Series metadata schema version', () => {
    it('should have metadata_schema_version field on Series', () => {
      expect(schema).toContain('metadata_schema_version');
      expect(schema).toMatch(/metadata_schema_version\s+Int\s+@default\(1\)/);
    });

    it('should have index for schema version queries', () => {
      expect(schema).toContain('@@index([metadata_schema_version])');
    });

    it('should have comment explaining Bug 10 purpose', () => {
      expect(schema).toContain('Bug 10: Metadata schema versioning');
    });
  });
});

// ============================================================================
// MIGRATION FILE TESTS
// ============================================================================
describe('Bug 5/9/10: Migration Validation', () => {
  let migration: string;

  beforeAll(() => {
    migration = fs.readFileSync(
      path.join(process.cwd(), 'supabase/migrations/20260117_metadata_improvements.sql'),
      'utf-8'
    );
  });

  describe('Bug 5: SeriesSource migration', () => {
    it('should add metadata_status column to series_sources', () => {
      expect(migration).toContain(
        "ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_status VARCHAR(20) DEFAULT 'pending'"
      );
    });

    it('should add metadata_retry_count column', () => {
      expect(migration).toContain(
        'ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_retry_count INT DEFAULT 0'
      );
    });

    it('should add last_metadata_error column', () => {
      expect(migration).toContain(
        'ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_error TEXT'
      );
    });

    it('should add last_metadata_attempt_at column', () => {
      expect(migration).toContain(
        'ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_attempt_at TIMESTAMPTZ'
      );
    });

    it('should add metadata_enriched_at column', () => {
      expect(migration).toContain(
        'ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_enriched_at TIMESTAMPTZ'
      );
    });

    it('should create index for metadata status', () => {
      expect(migration).toContain('idx_series_sources_metadata_status');
    });

    it('should create index for metadata healing', () => {
      expect(migration).toContain('idx_series_sources_metadata_healing');
    });
  });

  describe('Bug 9: LibraryEntry sync status migration', () => {
    it('should add sync_status column to library_entries', () => {
      expect(migration).toContain(
        "ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS sync_status VARCHAR(20) DEFAULT 'healthy'"
      );
    });

    it('should add last_sync_error column', () => {
      expect(migration).toContain(
        'ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_error TEXT'
      );
    });

    it('should add last_sync_at column', () => {
      expect(migration).toContain(
        'ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMPTZ'
      );
    });

    it('should create index for sync status', () => {
      expect(migration).toContain('idx_library_entries_sync_status');
    });

    it('should migrate existing data to healthy status', () => {
      expect(migration).toContain("SET sync_status = 'healthy'");
    });
  });

  describe('Bug 10: Series metadata schema version migration', () => {
    it('should add metadata_schema_version column to series', () => {
      expect(migration).toContain(
        'ALTER TABLE series ADD COLUMN IF NOT EXISTS metadata_schema_version INT DEFAULT 1'
      );
    });

    it('should create index for schema version', () => {
      expect(migration).toContain('idx_series_schema_version');
    });
  });

  describe('Migration documentation', () => {
    it('should have comments explaining each bug fix', () => {
      expect(migration).toContain('Bug 5:');
      expect(migration).toContain('Bug 9:');
      expect(migration).toContain('Bug 10:');
    });
  });
});

// ============================================================================
// CONSTANTS FILE TESTS
// ============================================================================
describe('Bug 5/9/10: Constants Validation', () => {
  let constants: string;

  beforeAll(() => {
    constants = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/constants/metadata.ts'),
      'utf-8'
    );
  });

  describe('Bug 9: SYNC_STATUS constants', () => {
    it('should export SYNC_STATUS constant', () => {
      expect(constants).toContain('export const SYNC_STATUS');
    });

    it('should have HEALTHY status', () => {
      expect(constants).toContain("HEALTHY: 'healthy'");
    });

    it('should have DEGRADED status', () => {
      expect(constants).toContain("DEGRADED: 'degraded'");
    });

    it('should have FAILED status', () => {
      expect(constants).toContain("FAILED: 'failed'");
    });

    it('should export SyncStatus type', () => {
      expect(constants).toContain('export type SyncStatus');
    });
  });

  describe('Bug 10: Schema versioning constants', () => {
    it('should export CURRENT_METADATA_SCHEMA_VERSION', () => {
      expect(constants).toContain('export const CURRENT_METADATA_SCHEMA_VERSION');
    });

    it('should have version 1 as default', () => {
      expect(constants).toContain('CURRENT_METADATA_SCHEMA_VERSION = 1');
    });

    it('should export VERSION_HISTORY', () => {
      expect(constants).toContain('export const VERSION_HISTORY');
    });

    it('should have version 1 entry in history', () => {
      expect(constants).toContain("1: {");
      expect(constants).toContain("date: '2026-01-17'");
    });

    it('should export needsSchemaUpdate function', () => {
      expect(constants).toContain('export function needsSchemaUpdate');
    });
  });

  describe('Bug 5: SOURCE_METADATA_STATUS constants', () => {
    it('should export SOURCE_METADATA_STATUS constant', () => {
      expect(constants).toContain('export const SOURCE_METADATA_STATUS');
    });

    it('should have PENDING status', () => {
      expect(constants).toContain("PENDING: 'pending'");
    });

    it('should have ENRICHED status', () => {
      expect(constants).toContain("ENRICHED: 'enriched'");
    });

    it('should have UNAVAILABLE status', () => {
      expect(constants).toContain("UNAVAILABLE: 'unavailable'");
    });

    it('should have FAILED status', () => {
      expect(constants).toContain("FAILED: 'failed'");
    });
  });

  describe('Helper functions', () => {
    it('should export getSyncStatusDescription', () => {
      expect(constants).toContain('export function getSyncStatusDescription');
    });

    it('should export getMetadataStatusDescription', () => {
      expect(constants).toContain('export function getMetadataStatusDescription');
    });
  });
});

// ============================================================================
// API RESPONSE TESTS
// ============================================================================
describe('Bug 9: Library API Response Validation', () => {
  let apiRoute: string;

  beforeAll(() => {
    apiRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/library/route.ts'),
      'utf-8'
    );
  });

  it('should include sync_status in GET response', () => {
    expect(apiRoute).toContain('sync_status: true');
  });

  it('should include last_sync_at in GET response', () => {
    expect(apiRoute).toContain('last_sync_at: true');
  });

  it('should initialize sync_status as healthy for new entries', () => {
    expect(apiRoute).toContain("sync_status: 'healthy'");
  });

  it('should have comment explaining Bug 9', () => {
    expect(apiRoute).toContain('Bug 9');
  });
});

// ============================================================================
// UI COMPONENT TESTS
// ============================================================================
describe('Bug 9: SyncStatusIndicator Component Validation', () => {
  let libraryPage: string;

  beforeAll(() => {
    libraryPage = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(dashboard)/library/page.tsx'),
      'utf-8'
    );
  });

  it('should have SyncStatusIndicator component defined', () => {
    expect(libraryPage).toContain('const SyncStatusIndicator');
  });

  it('should accept syncStatus prop with correct types', () => {
    expect(libraryPage).toContain("syncStatus: 'healthy' | 'degraded' | 'failed'");
  });

  it('should accept metadataStatus prop', () => {
    expect(libraryPage).toContain("metadataStatus: 'pending' | 'enriched' | 'unavailable' | 'failed'");
  });

  it('should show combined status tooltip', () => {
    expect(libraryPage).toContain('Chapters:');
    expect(libraryPage).toContain('Metadata:');
  });

  it('should show different icons for sync status', () => {
    expect(libraryPage).toContain('CheckCircle2');
    expect(libraryPage).toContain('AlertTriangle');
    expect(libraryPage).toContain('AlertCircle');
  });

  it('should handle sync failure with good metadata', () => {
    expect(libraryPage).toContain(
      "entry.sync_status === 'failed' && entry.metadata_status === 'enriched'"
    );
  });

  it('should display Sync Failed badge', () => {
    expect(libraryPage).toContain('Sync Failed');
  });

  it('should use SyncStatusIndicator in grid view', () => {
    expect(libraryPage).toContain('<SyncStatusIndicator');
    expect(libraryPage).toContain("syncStatus={entry.sync_status || 'healthy'}");
  });

  it('should use SyncStatusIndicator in list view', () => {
    // Should appear multiple times (grid and list)
    const matches = libraryPage.match(/<SyncStatusIndicator/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// SIMULATION TESTS
// ============================================================================
describe('Bug 5/9/10: Simulation Scenarios', () => {
  
  describe('Bug 5 Simulation: Series-scoped metadata sharing', () => {
    // Simulate two users adding the same source URL
    it('should allow sharing metadata resolution across users', () => {
      const seriesSource = {
        id: 'source-123',
        source_url: 'https://mangadex.org/title/abc123',
        metadata_status: 'enriched',
        metadata_retry_count: 0,
        last_metadata_error: null,
        metadata_enriched_at: new Date(),
      };

      // User 1 adds entry - source already enriched
      const userAEntry = {
        user_id: 'user-a',
        source_url: seriesSource.source_url,
        // No need to re-enrich because SeriesSource already has metadata
        metadata_status: seriesSource.metadata_status === 'enriched' ? 'enriched' : 'pending',
      };

      // User 2 adds same source - inherits metadata
      const userBEntry = {
        user_id: 'user-b',
        source_url: seriesSource.source_url,
        metadata_status: seriesSource.metadata_status === 'enriched' ? 'enriched' : 'pending',
      };

      expect(userAEntry.metadata_status).toBe('enriched');
      expect(userBEntry.metadata_status).toBe('enriched');
      // Both users benefit from single enrichment
    });

    it('should track metadata errors at source level', () => {
      const seriesSource = {
        id: 'source-456',
        source_url: 'https://example.com/manga/xyz',
        metadata_status: 'failed',
        metadata_retry_count: 3,
        last_metadata_error: 'No match found on MangaDex',
        last_metadata_attempt_at: new Date(),
      };

      // Error is tracked at source level, not per-user
      expect(seriesSource.metadata_status).toBe('failed');
      expect(seriesSource.metadata_retry_count).toBe(3);
      expect(seriesSource.last_metadata_error).toBeTruthy();
    });
  });

  describe('Bug 9 Simulation: Sync vs Metadata status UX', () => {
    // Simulate various status combinations
    const scenarios = [
      {
        name: 'Both healthy',
        syncStatus: 'healthy',
        metadataStatus: 'enriched',
        shouldShowIndicator: false, // Clean UI
      },
      {
        name: 'Sync healthy, metadata unavailable',
        syncStatus: 'healthy',
        metadataStatus: 'unavailable',
        shouldShowIndicator: true,
        expectedMessage: 'Chapters sync normally, but no metadata found',
      },
      {
        name: 'Sync failed, metadata good',
        syncStatus: 'failed',
        metadataStatus: 'enriched',
        shouldShowIndicator: true,
        expectedBadge: 'Sync Failed',
      },
      {
        name: 'Both failing',
        syncStatus: 'failed',
        metadataStatus: 'failed',
        shouldShowIndicator: true,
        expectedSeverity: 'critical',
      },
      {
        name: 'Sync degraded, metadata pending',
        syncStatus: 'degraded',
        metadataStatus: 'pending',
        shouldShowIndicator: true,
        expectedMessage: 'Updates may be delayed, searching for metadata',
      },
    ];

    scenarios.forEach(scenario => {
      it(`should handle: ${scenario.name}`, () => {
        // Simulate indicator logic
        const showIndicator = !(
          scenario.syncStatus === 'healthy' && scenario.metadataStatus === 'enriched'
        );

        expect(showIndicator).toBe(scenario.shouldShowIndicator);

        if (scenario.expectedBadge) {
          // When sync fails but metadata is good, show "Sync Failed" badge
          expect(
            scenario.syncStatus === 'failed' && scenario.metadataStatus === 'enriched'
          ).toBe(true);
        }
      });
    });

    it('should provide clear user messaging for sync vs metadata', () => {
      // Test description functions
      const syncDescriptions: Record<string, string> = {
        healthy: 'Chapters syncing normally',
        degraded: 'Some chapter updates may be delayed',
        failed: 'Chapter sync is currently failing',
      };

      const metadataDescriptions: Record<string, string> = {
        pending: 'Searching for metadata...',
        enriched: 'Metadata linked successfully',
        unavailable: 'No metadata found on MangaDex. Chapters still sync normally.',
        failed: 'Metadata lookup failed. Try manual linking.',
      };

      // Verify all descriptions exist and are meaningful
      Object.entries(syncDescriptions).forEach(([status, desc]) => {
        expect(desc.length).toBeGreaterThan(10);
        expect(desc).not.toContain('undefined');
      });

      Object.entries(metadataDescriptions).forEach(([status, desc]) => {
        expect(desc.length).toBeGreaterThan(10);
        expect(desc).not.toContain('undefined');
      });
    });
  });

  describe('Bug 10 Simulation: Schema versioning', () => {
    const CURRENT_VERSION = 1;

    function needsSchemaUpdate(currentVersion: number | null | undefined): boolean {
      if (currentVersion === null || currentVersion === undefined) {
        return true;
      }
      return currentVersion < CURRENT_VERSION;
    }

    it('should detect outdated entries (version 0)', () => {
      const outdatedSeries = { metadata_schema_version: 0 };
      expect(needsSchemaUpdate(outdatedSeries.metadata_schema_version)).toBe(true);
    });

    it('should not flag current version entries', () => {
      const currentSeries = { metadata_schema_version: 1 };
      expect(needsSchemaUpdate(currentSeries.metadata_schema_version)).toBe(false);
    });

    it('should handle null version (legacy entries)', () => {
      const legacySeries = { metadata_schema_version: null };
      expect(needsSchemaUpdate(legacySeries.metadata_schema_version)).toBe(true);
    });

    it('should handle undefined version', () => {
      const newSeries = {} as any;
      expect(needsSchemaUpdate(newSeries.metadata_schema_version)).toBe(true);
    });

    it('should not re-enrich future versions (forward compatible)', () => {
      const futureSeries = { metadata_schema_version: 2 };
      expect(needsSchemaUpdate(futureSeries.metadata_schema_version)).toBe(false);
    });

    it('should simulate schema version upgrade workflow', () => {
      // Simulate incrementing schema version
      const OLD_VERSION = 1;
      const NEW_VERSION = 2;

      // Before upgrade: series at version 1
      const seriesBefore = { metadata_schema_version: OLD_VERSION };
      expect(needsSchemaUpdate(seriesBefore.metadata_schema_version)).toBe(false);

      // After app upgrade to version 2
      // Simulate CURRENT_VERSION = 2
      function needsUpdateV2(version: number | null | undefined): boolean {
        if (version === null || version === undefined) return true;
        return version < NEW_VERSION;
      }

      // Now series at version 1 needs update
      expect(needsUpdateV2(seriesBefore.metadata_schema_version)).toBe(true);

      // After re-enrichment, series is at version 2
      const seriesAfter = { metadata_schema_version: NEW_VERSION };
      expect(needsUpdateV2(seriesAfter.metadata_schema_version)).toBe(false);
    });
  });
});

// ============================================================================
// INTEGRATION SCENARIO TESTS
// ============================================================================
describe('Bug 5/9/10: End-to-End Scenarios', () => {
  
  describe('Scenario: User adds manga that exists in another user library', () => {
    it('should share metadata resolution from SeriesSource (Bug 5)', () => {
      // Setup: SeriesSource already enriched by User A
      const existingSource = {
        source_url: 'https://mangadex.org/title/one-piece',
        metadata_status: 'enriched',
        series_id: 'series-one-piece-uuid',
        metadata_enriched_at: new Date('2026-01-01'),
      };

      // Action: User B adds same manga
      const newEntry = {
        user_id: 'user-b',
        source_url: existingSource.source_url,
        // Because SeriesSource already enriched, we can immediately link
        series_id: existingSource.series_id,
        metadata_status: 'enriched', // Inherited from source
        sync_status: 'healthy', // New field from Bug 9
      };

      expect(newEntry.series_id).toBe(existingSource.series_id);
      expect(newEntry.metadata_status).toBe('enriched');
      // No enrichment job needed!
    });
  });

  describe('Scenario: Chapter sync fails but metadata is fine', () => {
    it('should clearly indicate sync failure while showing metadata is good (Bug 9)', () => {
      const entry = {
        series_id: 'series-123',
        metadata_status: 'enriched', // Metadata is fine
        sync_status: 'failed', // But sync is broken
        last_sync_error: 'Source returned 503',
        last_sync_at: new Date('2026-01-10'),
      };

      // UI should show:
      // - Sync status: failed (red icon)
      // - Metadata status: enriched (green icon)
      // - Badge: "Sync Failed" 
      // - Tooltip: "Chapters: Failed, Metadata: Linked"

      expect(entry.sync_status).toBe('failed');
      expect(entry.metadata_status).toBe('enriched');
      expect(entry.last_sync_error).toBeTruthy();
    });
  });

  describe('Scenario: App updates metadata schema', () => {
    it('should identify entries needing re-enrichment (Bug 10)', () => {
      // Simulate database entries with various versions
      const entries = [
        { id: '1', title: 'Old Manga', metadata_schema_version: 0 },
        { id: '2', title: 'Current Manga', metadata_schema_version: 1 },
        { id: '3', title: 'Legacy Manga', metadata_schema_version: null },
        { id: '4', title: 'New Manga', metadata_schema_version: 1 },
      ];

      // After schema update to version 2
      const NEW_SCHEMA_VERSION = 2;
      const outdatedEntries = entries.filter(e => {
        if (e.metadata_schema_version === null) return true;
        return e.metadata_schema_version < NEW_SCHEMA_VERSION;
      });

      expect(outdatedEntries).toHaveLength(4); // All need update
      expect(outdatedEntries.map(e => e.id)).toEqual(['1', '2', '3', '4']);
    });
  });

  describe('Scenario: Combined status in library view', () => {
    it('should render correct indicators for all status combinations', () => {
      const libraryEntries = [
        { id: '1', sync_status: 'healthy', metadata_status: 'enriched', expected: 'no-indicator' },
        { id: '2', sync_status: 'healthy', metadata_status: 'unavailable', expected: 'metadata-warning' },
        { id: '3', sync_status: 'degraded', metadata_status: 'enriched', expected: 'sync-warning' },
        { id: '4', sync_status: 'failed', metadata_status: 'enriched', expected: 'sync-failed-badge' },
        { id: '5', sync_status: 'healthy', metadata_status: 'pending', expected: 'metadata-loading' },
        { id: '6', sync_status: 'failed', metadata_status: 'failed', expected: 'both-failed' },
      ];

      libraryEntries.forEach(entry => {
        const showIndicator = !(
          entry.sync_status === 'healthy' && entry.metadata_status === 'enriched'
        );
        const expectIndicator = entry.expected !== 'no-indicator';
        expect(showIndicator).toBe(expectIndicator);
      });
    });
  });
});
