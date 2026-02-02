/**
 * Metadata Schema Versioning Constants
 * 
 * Bug 10 Fix: Version tracking for metadata schema changes
 * 
 * USAGE:
 * When metadata shape changes (e.g., adding required fields, changing formats):
 * 1. Increment CURRENT_METADATA_SCHEMA_VERSION
 * 2. Add migration notes to VERSION_HISTORY
 * 3. Metadata healing scheduler will automatically re-enrich outdated entries
 */

// Current metadata schema version
// Increment this when metadata structure changes
export const CURRENT_METADATA_SCHEMA_VERSION = 1;

// Version history for documentation
export const VERSION_HISTORY: Record<number, { date: string; changes: string[] }> = {
  1: {
    date: '2026-01-17',
    changes: [
      'Initial version',
      'Core fields: title, description, cover_url, genres, tags, themes',
      'MangaDex integration for canonical metadata',
    ],
  },
  // Future versions:
  // 2: {
  //   date: 'YYYY-MM-DD',
  //   changes: [
  //     'Added AniList integration',
  //     'New field: anilist_id',
  //   ],
  // },
};

// Sync status constants for Bug 9
export const SYNC_STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  FAILED: 'failed',
} as const;

export type SyncStatus = typeof SYNC_STATUS[keyof typeof SYNC_STATUS];

// Metadata status constants
export const METADATA_STATUS = {
  PENDING: 'pending',
  ENRICHED: 'enriched',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
} as const;

export type MetadataStatusType = typeof METADATA_STATUS[keyof typeof METADATA_STATUS];

// Source metadata status (for Bug 5 - SeriesSource level)
export const SOURCE_METADATA_STATUS = {
  PENDING: 'pending',
  ENRICHED: 'enriched',
  UNAVAILABLE: 'unavailable',
  FAILED: 'failed',
} as const;

export type SourceMetadataStatusType = typeof SOURCE_METADATA_STATUS[keyof typeof SOURCE_METADATA_STATUS];

/**
 * Check if a series needs metadata re-enrichment based on schema version
 */
export function needsSchemaUpdate(currentVersion: number | null | undefined): boolean {
  if (currentVersion === null || currentVersion === undefined) {
    return true;
  }
  return currentVersion < CURRENT_METADATA_SCHEMA_VERSION;
}

/**
 * Get human-readable description of sync status
 */
export function getSyncStatusDescription(status: SyncStatus): string {
  switch (status) {
    case SYNC_STATUS.HEALTHY:
      return 'Chapters syncing normally';
    case SYNC_STATUS.DEGRADED:
      return 'Some chapter updates may be delayed';
    case SYNC_STATUS.FAILED:
      return 'Chapter sync is currently failing';
    default:
      return 'Unknown sync status';
  }
}

/**
 * Get human-readable description of metadata status
 */
export function getMetadataStatusDescription(status: MetadataStatusType): string {
  switch (status) {
    case METADATA_STATUS.PENDING:
      return 'Searching for metadata...';
    case METADATA_STATUS.ENRICHED:
      return 'Metadata linked successfully';
    case METADATA_STATUS.UNAVAILABLE:
      return 'No metadata found on MangaDex. Chapters still sync normally.';
    case METADATA_STATUS.FAILED:
      return 'Metadata lookup failed. Try manual linking.';
    default:
      return 'Unknown metadata status';
  }
}
