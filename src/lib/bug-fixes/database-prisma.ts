/**
 * D. DATABASE / PRISMA / SQL (Bugs 61-75)
 * 
 * Comprehensive fixes for database integrity and Prisma issues.
 */

import { z } from 'zod';

// Bug 61: Missing unique constraints where logic assumes uniqueness
export interface UniqueConstraintCheck {
  table: string;
  columns: string[];
  constraintName: string;
  sql: string;
}

export const REQUIRED_UNIQUE_CONSTRAINTS: UniqueConstraintCheck[] = [
  {
    table: 'series_sources',
    columns: ['source_name', 'source_id'],
    constraintName: 'series_sources_source_name_source_id_key',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS series_sources_source_name_source_id_key ON series_sources(source_name, source_id)'
  },
  {
    table: 'library_entries',
    columns: ['user_id', 'source_url'],
    constraintName: 'library_entries_user_id_source_url_key',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS library_entries_user_id_source_url_key ON library_entries(user_id, source_url)'
  },
  {
    table: 'chapters',
    columns: ['series_id', 'chapter_number'],
    constraintName: 'chapters_series_id_chapter_number_key',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS chapters_series_id_chapter_number_key ON chapters(series_id, chapter_number)'
  },
  {
    table: 'chapter_sources',
    columns: ['series_source_id', 'chapter_id'],
    constraintName: 'chapter_sources_series_source_id_chapter_id_key',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS chapter_sources_series_source_id_chapter_id_key ON chapter_sources(series_source_id, chapter_id)'
  }
];

// Bug 62: Prisma upserts rely on app-level guarantees
export function buildSafeUpsertQuery(
  table: string,
  uniqueColumns: string[],
  insertColumns: string[],
  updateColumns: string[]
): string {
  const conflictClause = uniqueColumns.join(', ');
  const insertPlaceholders = insertColumns.map((_, i) => `$${i + 1}`).join(', ');
  const updateSetClause = updateColumns
    .map(col => `${col} = EXCLUDED.${col}`)
    .join(', ');

  return `
    INSERT INTO ${table} (${insertColumns.join(', ')})
    VALUES (${insertPlaceholders})
    ON CONFLICT (${conflictClause})
    DO UPDATE SET ${updateSetClause}, updated_at = NOW()
    RETURNING *
  `;
}

// Bug 63: No explicit isolation level in some transactions
export type IsolationLevel = 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';

export interface TransactionConfig {
  isolationLevel: IsolationLevel;
  maxWait: number;
  timeout: number;
}

export const DEFAULT_TRANSACTION_CONFIG: TransactionConfig = {
  isolationLevel: 'ReadCommitted',
  maxWait: 5000,
  timeout: 30000
};

export const SERIALIZABLE_TRANSACTION_CONFIG: TransactionConfig = {
  isolationLevel: 'Serializable',
  maxWait: 5000,
  timeout: 30000
};

// Bug 64: Serializable transactions can retry without backoff
export interface SerializationRetryConfig {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  jitterFactor: number;
}

export const DEFAULT_SERIALIZATION_RETRY: SerializationRetryConfig = {
  maxRetries: 3,
  initialDelayMs: 100,
  maxDelayMs: 2000,
  jitterFactor: 0.3
};

export function calculateSerializationBackoff(
  attemptNumber: number,
  config: SerializationRetryConfig = DEFAULT_SERIALIZATION_RETRY
): number {
  const exponentialDelay = Math.min(
    config.initialDelayMs * Math.pow(2, attemptNumber),
    config.maxDelayMs
  );
  const jitter = exponentialDelay * config.jitterFactor * (Math.random() * 2 - 1);
  return Math.round(exponentialDelay + jitter);
}

export function isSerializationError(error: unknown): boolean {
  if (error instanceof Error) {
    const anyError = error as { code?: string };
    if (anyError.code === 'P2034' || anyError.code === '40001') {
      return true;
    }
    if (error.message.includes('serialization') || error.message.includes('could not serialize')) {
      return true;
    }
  }
  return false;
}

// Bug 65: Prisma errors not fully classified
export type PrismaErrorCategory = 
  | 'constraint_violation'
  | 'serialization_failure'
  | 'connection_error'
  | 'timeout'
  | 'not_found'
  | 'validation'
  | 'unknown';

export interface ClassifiedPrismaError {
  category: PrismaErrorCategory;
  code: string | null;
  isRetryable: boolean;
  userMessage: string;
  originalMessage: string;
}

export function classifyPrismaError(error: unknown): ClassifiedPrismaError {
  const anyError = error as { code?: string; message?: string };
  const code = anyError.code || null;
  const message = anyError.message || String(error);

  if (code === 'P2002') {
    return {
      category: 'constraint_violation',
      code,
      isRetryable: false,
      userMessage: 'This record already exists',
      originalMessage: message
    };
  }

  if (code === 'P2034' || code === '40001') {
    return {
      category: 'serialization_failure',
      code,
      isRetryable: true,
      userMessage: 'Please try again',
      originalMessage: message
    };
  }

  if (code === 'P2024' || message.includes('connection') || message.includes('ECONNREFUSED')) {
    return {
      category: 'connection_error',
      code,
      isRetryable: true,
      userMessage: 'Database connection error. Please try again.',
      originalMessage: message
    };
  }

  if (code === 'P2028' || message.includes('timeout')) {
    return {
      category: 'timeout',
      code,
      isRetryable: true,
      userMessage: 'Request timed out. Please try again.',
      originalMessage: message
    };
  }

  if (code === 'P2025' || code === 'P2001') {
    return {
      category: 'not_found',
      code,
      isRetryable: false,
      userMessage: 'Record not found',
      originalMessage: message
    };
  }

  if (code?.startsWith('P2')) {
    return {
      category: 'validation',
      code,
      isRetryable: false,
      userMessage: 'Invalid data provided',
      originalMessage: message
    };
  }

  return {
    category: 'unknown',
    code,
    isRetryable: false,
    userMessage: 'An unexpected error occurred',
    originalMessage: message
  };
}

// Bug 66: Soft-deleted rows can still be referenced
export interface SoftDeleteConfig {
  deletedAtColumn: string;
  excludeDeleted: boolean;
}

export function buildSoftDeleteWhereClause(
  config: SoftDeleteConfig = { deletedAtColumn: 'deleted_at', excludeDeleted: true }
): string {
  if (config.excludeDeleted) {
    return `${config.deletedAtColumn} IS NULL`;
  }
  return '1=1';
}

export function buildSoftDeleteQuery(table: string, idColumn: string, id: string): string {
  return `UPDATE ${table} SET deleted_at = NOW() WHERE ${idColumn} = '${id}'::uuid`;
}

// Bug 67: Foreign key constraints not exhaustive
export interface ForeignKeyCheck {
  table: string;
  column: string;
  referencesTable: string;
  referencesColumn: string;
  onDelete: 'CASCADE' | 'SET NULL' | 'RESTRICT' | 'NO ACTION';
}

export const REQUIRED_FOREIGN_KEYS: ForeignKeyCheck[] = [
  { table: 'library_entries', column: 'user_id', referencesTable: 'users', referencesColumn: 'id', onDelete: 'CASCADE' },
  { table: 'library_entries', column: 'series_id', referencesTable: 'series', referencesColumn: 'id', onDelete: 'SET NULL' },
  { table: 'chapters', column: 'series_id', referencesTable: 'series', referencesColumn: 'id', onDelete: 'SET NULL' },
  { table: 'chapter_sources', column: 'chapter_id', referencesTable: 'chapters', referencesColumn: 'id', onDelete: 'CASCADE' },
  { table: 'chapter_sources', column: 'series_source_id', referencesTable: 'series_sources', referencesColumn: 'id', onDelete: 'CASCADE' },
  { table: 'series_sources', column: 'series_id', referencesTable: 'series', referencesColumn: 'id', onDelete: 'SET NULL' }
];

// Bug 68: Counters stored instead of derived can drift
export interface DerivedCounterConfig {
  table: string;
  counterColumn: string;
  derivedFrom: {
    table: string;
    countColumn: string;
    joinColumn: string;
  };
}

export const DERIVED_COUNTERS: DerivedCounterConfig[] = [
  {
    table: 'series',
    counterColumn: 'chapter_count',
    derivedFrom: { table: 'chapters', countColumn: 'id', joinColumn: 'series_id' }
  },
  {
    table: 'series',
    counterColumn: 'total_follows',
    derivedFrom: { table: 'library_entries', countColumn: 'id', joinColumn: 'series_id' }
  }
];

export function buildCounterReconciliationQuery(config: DerivedCounterConfig): string {
  return `
    UPDATE ${config.table} t
    SET ${config.counterColumn} = (
      SELECT COUNT(${config.derivedFrom.countColumn})
      FROM ${config.derivedFrom.table} d
      WHERE d.${config.derivedFrom.joinColumn} = t.id
    )
    WHERE t.id IN (
      SELECT t2.id FROM ${config.table} t2
      WHERE t2.${config.counterColumn} != (
        SELECT COUNT(${config.derivedFrom.countColumn})
        FROM ${config.derivedFrom.table} d2
        WHERE d2.${config.derivedFrom.joinColumn} = t2.id
      )
    )
  `;
}

// Bug 69: No reconciliation job for derived data
export interface ReconciliationResult {
  table: string;
  column: string;
  recordsChecked: number;
  recordsFixed: number;
  errors: string[];
}

// Bug 70: Missing indexes for frequent metadata queries
export interface IndexRecommendation {
  table: string;
  columns: string[];
  indexType: 'btree' | 'hash' | 'gin' | 'gist';
  condition?: string;
  sql: string;
}

export const RECOMMENDED_INDEXES: IndexRecommendation[] = [
  {
    table: 'library_entries',
    columns: ['metadata_status', 'last_metadata_attempt_at'],
    indexType: 'btree',
    sql: 'CREATE INDEX IF NOT EXISTS idx_library_entries_metadata_resolution ON library_entries(metadata_status, last_metadata_attempt_at) WHERE metadata_status != \'enriched\''
  },
  {
    table: 'series_sources',
    columns: ['sync_priority', 'next_check_at'],
    indexType: 'btree',
    sql: 'CREATE INDEX IF NOT EXISTS idx_series_sources_sync_scheduling ON series_sources(sync_priority, next_check_at)'
  },
  {
    table: 'chapters',
    columns: ['series_id', 'chapter_number'],
    indexType: 'btree',
    sql: 'CREATE INDEX IF NOT EXISTS idx_chapters_series_order ON chapters(series_id, chapter_number DESC)'
  },
  {
    table: 'series',
    columns: ['title'],
    indexType: 'gin',
    sql: 'CREATE INDEX IF NOT EXISTS idx_series_title_trgm ON series USING gin(title gin_trgm_ops)'
  }
];

// Bug 71: JSON fields lack validation before persistence
export const MetadataJsonSchema = z.object({
  title: z.string().max(500).optional(),
  description: z.string().max(10000).optional(),
  cover_url: z.string().url().optional(),
  genres: z.array(z.string().max(50)).max(50).optional(),
  tags: z.array(z.string().max(50)).max(100).optional(),
  external_links: z.record(z.string()).optional(),
  alternative_titles: z.array(z.string().max(500)).max(50).optional()
});

export type MetadataJson = z.infer<typeof MetadataJsonSchema>;

export function validateJsonField(data: unknown, schema: z.ZodType): { valid: boolean; errors: string[] } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { valid: true, errors: [] };
  }
  return {
    valid: false,
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

// Bug 72: Nullable fields used as non-nullable in code
export interface NullabilityCheck {
  field: string;
  isNullableInDb: boolean;
  isNullableInCode: boolean;
  mismatch: boolean;
}

export function createNullSafeGetter<T>(
  value: T | null | undefined,
  defaultValue: T
): T {
  return value ?? defaultValue;
}

export function assertNotNull<T>(value: T | null | undefined, fieldName: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Expected ${fieldName} to be non-null`);
  }
  return value;
}

// Bug 73: Implicit defaults overwrite existing DB values
export interface SafeUpdateConfig {
  preserveExisting: string[];
  allowOverwrite: string[];
}

export function buildSafeUpdateData<T extends Record<string, unknown>>(
  existing: T,
  updates: Partial<T>,
  config: SafeUpdateConfig
): Partial<T> {
  const safeUpdates: Partial<T> = {};

  for (const [key, value] of Object.entries(updates)) {
    if (value === undefined) {
      continue;
    }

    if (config.preserveExisting.includes(key)) {
      const existingValue = existing[key as keyof T];
      if (existingValue !== null && existingValue !== undefined) {
        continue;
      }
    }

    (safeUpdates as Record<string, unknown>)[key] = value;
  }

  return safeUpdates;
}

// Bug 74: No audit trail for critical state transitions
export interface AuditEntry {
  id: string;
  entityType: string;
  entityId: string;
  action: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  userId: string | null;
  timestamp: Date;
  metadata: Record<string, unknown>;
}

export function createAuditEntry(
  entityType: string,
  entityId: string,
  action: string,
  previousState: Record<string, unknown> | null,
  newState: Record<string, unknown> | null,
  userId: string | null = null,
  metadata: Record<string, unknown> = {}
): AuditEntry {
  return {
    id: crypto.randomUUID(),
    entityType,
    entityId,
    action,
    previousState,
    newState,
    userId,
    timestamp: new Date(),
    metadata
  };
}

export const AUDITED_ACTIONS = [
  'library_entry.status_change',
  'library_entry.series_link',
  'library_entry.delete',
  'series.metadata_update',
  'series.merge',
  'user.settings_change'
];

// Bug 75: Cross-user metadata duplication possible
export interface CrossUserCheck {
  table: string;
  userColumn: string;
  uniqueWithinUser: string[];
}

export const CROSS_USER_UNIQUE_CONSTRAINTS: CrossUserCheck[] = [
  {
    table: 'library_entries',
    userColumn: 'user_id',
    uniqueWithinUser: ['source_url']
  },
  {
    table: 'user_chapter_reads_v2',
    userColumn: 'user_id',
    uniqueWithinUser: ['chapter_id']
  }
];

export function buildCrossUserUniqueQuery(check: CrossUserCheck): string {
  const columns = [check.userColumn, ...check.uniqueWithinUser].join(', ');
  return `
    SELECT ${columns}, COUNT(*) as duplicate_count
    FROM ${check.table}
    WHERE deleted_at IS NULL
    GROUP BY ${columns}
    HAVING COUNT(*) > 1
  `;
}
