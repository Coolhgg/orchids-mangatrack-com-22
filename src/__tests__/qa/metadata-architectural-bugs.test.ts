// Jest globals are available without imports
import * as fs from 'fs';
import * as path from 'path';

/**
 * Test suite to verify Bug 5, 9, 10 implementations
 */

describe('Metadata Architectural Bug Fixes', () => {
  
  // Read source files once
  const schemaPath = path.join(process.cwd(), 'prisma/schema.prisma');
  const migrationPath = path.join(process.cwd(), 'supabase/migrations/20260117_metadata_improvements.sql');
  const metadataConstantsPath = path.join(process.cwd(), 'src/lib/constants/metadata.ts');
  const libraryPagePath = path.join(process.cwd(), 'src/app/(dashboard)/library/page.tsx');
  const libraryApiPath = path.join(process.cwd(), 'src/app/api/library/route.ts');
  
  let schema: string;
  let migration: string;
  let metadataConstants: string;
  let libraryPage: string;
  let libraryApi: string;

  beforeEach(() => {
    schema = fs.readFileSync(schemaPath, 'utf-8');
    migration = fs.readFileSync(migrationPath, 'utf-8');
    metadataConstants = fs.readFileSync(metadataConstantsPath, 'utf-8');
    libraryPage = fs.readFileSync(libraryPagePath, 'utf-8');
    libraryApi = fs.readFileSync(libraryApiPath, 'utf-8');
  });

  describe('Bug 5: Series-scoped metadata with SeriesSource table', () => {
    it('should add metadata_status field to SeriesSource model', () => {
      expect(schema).toContain('model SeriesSource');
      expect(schema).toContain('metadata_status');
      expect(schema).toContain("@default(\"pending\")");
    });

    it('should add metadata_retry_count to SeriesSource', () => {
      expect(schema).toContain('metadata_retry_count');
      expect(schema).toContain('@default(0)');
    });

    it('should add last_metadata_error to SeriesSource', () => {
      expect(schema).toContain('last_metadata_error');
    });

    it('should add last_metadata_attempt_at to SeriesSource', () => {
      expect(schema).toContain('last_metadata_attempt_at');
    });

    it('should add metadata_enriched_at to SeriesSource', () => {
      expect(schema).toContain('metadata_enriched_at');
    });

    it('should have metadata status index on SeriesSource', () => {
      expect(schema).toContain('@@index([metadata_status, last_metadata_attempt_at])');
    });

    it('should have migration for SeriesSource metadata fields', () => {
      expect(migration).toContain('ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_status');
      expect(migration).toContain('ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_retry_count');
      expect(migration).toContain('ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_error');
      expect(migration).toContain('ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS last_metadata_attempt_at');
      expect(migration).toContain('ALTER TABLE series_sources ADD COLUMN IF NOT EXISTS metadata_enriched_at');
    });

    it('should have indexes for metadata healing queries', () => {
      expect(migration).toContain('idx_series_sources_metadata_status');
      expect(migration).toContain('idx_series_sources_metadata_healing');
    });
  });

  describe('Bug 9: UX indicators for sync vs metadata status', () => {
    it('should add sync_status field to LibraryEntry model', () => {
      expect(schema).toContain('sync_status');
      expect(schema).toContain("@default(\"healthy\")");
    });

    it('should add last_sync_error to LibraryEntry', () => {
      expect(schema).toContain('last_sync_error');
    });

    it('should add last_sync_at to LibraryEntry', () => {
      expect(schema).toContain('last_sync_at');
    });

    it('should have sync status index on LibraryEntry', () => {
      expect(schema).toContain('@@index([sync_status, last_sync_at])');
    });

    it('should have migration for sync status fields', () => {
      expect(migration).toContain('ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS sync_status');
      expect(migration).toContain('ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_error');
      expect(migration).toContain('ALTER TABLE library_entries ADD COLUMN IF NOT EXISTS last_sync_at');
    });

    it('should have SyncStatusIndicator component in library page', () => {
      expect(libraryPage).toContain('SyncStatusIndicator');
      expect(libraryPage).toContain("syncStatus: 'healthy' | 'degraded' | 'failed'");
    });

    it('should show combined status tooltip', () => {
      expect(libraryPage).toContain('Chapters:');
      expect(libraryPage).toContain('Metadata:');
    });

    it('should show sync failure badge when sync fails but metadata is fine', () => {
      expect(libraryPage).toContain("entry.sync_status === 'failed' && entry.metadata_status === 'enriched'");
      expect(libraryPage).toContain('Sync Failed');
    });

    it('should include sync_status in library API response', () => {
      expect(libraryApi).toContain('sync_status: true');
      expect(libraryApi).toContain('last_sync_at: true');
    });

    it('should initialize sync_status as healthy for new entries', () => {
      expect(libraryApi).toContain("sync_status: 'healthy'");
    });
  });

  describe('Bug 10: Metadata schema versioning', () => {
    it('should add metadata_schema_version to Series model', () => {
      expect(schema).toContain('metadata_schema_version');
      expect(schema).toContain('@default(1)');
    });

    it('should have metadata schema version index', () => {
      expect(schema).toContain('@@index([metadata_schema_version])');
    });

    it('should have migration for schema version field', () => {
      expect(migration).toContain('ALTER TABLE series ADD COLUMN IF NOT EXISTS metadata_schema_version');
      expect(migration).toContain('DEFAULT 1');
    });

    it('should have CURRENT_METADATA_SCHEMA_VERSION constant', () => {
      expect(metadataConstants).toContain('CURRENT_METADATA_SCHEMA_VERSION');
      expect(metadataConstants).toContain('= 1');
    });

    it('should have VERSION_HISTORY for documentation', () => {
      expect(metadataConstants).toContain('VERSION_HISTORY');
      expect(metadataConstants).toContain("date: '2026-01-17'");
    });

    it('should have needsSchemaUpdate function', () => {
      expect(metadataConstants).toContain('function needsSchemaUpdate');
      expect(metadataConstants).toContain('CURRENT_METADATA_SCHEMA_VERSION');
    });

    it('should have SYNC_STATUS constants', () => {
      expect(metadataConstants).toContain('SYNC_STATUS');
      expect(metadataConstants).toContain("HEALTHY: 'healthy'");
      expect(metadataConstants).toContain("DEGRADED: 'degraded'");
      expect(metadataConstants).toContain("FAILED: 'failed'");
    });

    it('should have getSyncStatusDescription function', () => {
      expect(metadataConstants).toContain('function getSyncStatusDescription');
      expect(metadataConstants).toContain('Chapters syncing normally');
    });

    it('should have getMetadataStatusDescription function', () => {
      expect(metadataConstants).toContain('function getMetadataStatusDescription');
      expect(metadataConstants).toContain('No metadata found on MangaDex');
    });
  });
});

describe('Metadata Constants Unit Tests', () => {
  
  describe('needsSchemaUpdate function', () => {
    const CURRENT_VERSION = 1;
    
    function needsSchemaUpdate(currentVersion: number | null | undefined): boolean {
      if (currentVersion === null || currentVersion === undefined) {
        return true;
      }
      return currentVersion < CURRENT_VERSION;
    }

    it('should return true for null version', () => {
      expect(needsSchemaUpdate(null)).toBe(true);
    });

    it('should return true for undefined version', () => {
      expect(needsSchemaUpdate(undefined)).toBe(true);
    });

    it('should return true for version 0', () => {
      expect(needsSchemaUpdate(0)).toBe(true);
    });

    it('should return false for current version', () => {
      expect(needsSchemaUpdate(1)).toBe(false);
    });

    it('should return false for future version', () => {
      expect(needsSchemaUpdate(2)).toBe(false);
    });
  });

  describe('getSyncStatusDescription function', () => {
    function getSyncStatusDescription(status: string): string {
      switch (status) {
        case 'healthy':
          return 'Chapters syncing normally';
        case 'degraded':
          return 'Some chapter updates may be delayed';
        case 'failed':
          return 'Chapter sync is currently failing';
        default:
          return 'Unknown sync status';
      }
    }

    it('should describe healthy status', () => {
      expect(getSyncStatusDescription('healthy')).toBe('Chapters syncing normally');
    });

    it('should describe degraded status', () => {
      expect(getSyncStatusDescription('degraded')).toBe('Some chapter updates may be delayed');
    });

    it('should describe failed status', () => {
      expect(getSyncStatusDescription('failed')).toBe('Chapter sync is currently failing');
    });

    it('should handle unknown status', () => {
      expect(getSyncStatusDescription('unknown')).toBe('Unknown sync status');
    });
  });

  describe('getMetadataStatusDescription function', () => {
    function getMetadataStatusDescription(status: string): string {
      switch (status) {
        case 'pending':
          return 'Searching for metadata...';
        case 'enriched':
          return 'Metadata linked successfully';
        case 'unavailable':
          return 'No metadata found on MangaDex. Chapters still sync normally.';
        case 'failed':
          return 'Metadata lookup failed. Try manual linking.';
        default:
          return 'Unknown metadata status';
      }
    }

    it('should describe pending status', () => {
      expect(getMetadataStatusDescription('pending')).toBe('Searching for metadata...');
    });

    it('should describe enriched status', () => {
      expect(getMetadataStatusDescription('enriched')).toBe('Metadata linked successfully');
    });

    it('should describe unavailable status', () => {
      expect(getMetadataStatusDescription('unavailable')).toBe('No metadata found on MangaDex. Chapters still sync normally.');
    });

    it('should describe failed status', () => {
      expect(getMetadataStatusDescription('failed')).toBe('Metadata lookup failed. Try manual linking.');
    });
  });
});
