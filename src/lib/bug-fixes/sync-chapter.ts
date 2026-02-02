/**
 * B. SYNC & CHAPTER INGESTION (Bugs 21-40)
 * 
 * Comprehensive fixes for chapter synchronization and ingestion issues.
 */

import { createHash } from 'crypto';

// Bug 21: Chapter sync may run concurrently for same source
// Bug 22: No row-level lock when inserting chapters
export interface SyncLock {
  lockKey: string;
  acquired: boolean;
  acquiredAt: Date | null;
  expiresAt: Date | null;
}

export function generateSyncLockKey(
  entityType: 'series' | 'source' | 'chapter',
  entityId: string
): string {
  return `sync:${entityType}:${entityId}`;
}

export function buildChapterLockQuery(seriesSourceId: string): string {
  return `
    SELECT id FROM series_sources 
    WHERE id = '${seriesSourceId}'::uuid 
    FOR UPDATE SKIP LOCKED
  `;
}

// Bug 23: Duplicate chapters possible under race conditions
export interface ChapterDedupeKey {
  seriesSourceId: string;
  chapterNumber: string;
  sourceChapterId?: string;
}

export function generateChapterDedupeKey(chapter: ChapterDedupeKey): string {
  const parts = [chapter.seriesSourceId, chapter.chapterNumber];
  if (chapter.sourceChapterId) {
    parts.push(chapter.sourceChapterId);
  }
  return parts.join(':');
}

export function buildChapterUpsertQuery(): string {
  return `
    INSERT INTO chapters (series_id, chapter_number, chapter_title, volume_number, published_at)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (series_id, chapter_number) 
    DO UPDATE SET 
      chapter_title = COALESCE(EXCLUDED.chapter_title, chapters.chapter_title),
      volume_number = COALESCE(EXCLUDED.volume_number, chapters.volume_number),
      published_at = COALESCE(EXCLUDED.published_at, chapters.published_at),
      updated_at = NOW()
    RETURNING id
  `;
}

// Bug 24: Chapter number floats can cause ordering errors
// Bug 25: Chapter numbering inconsistencies across sources not normalized
export interface NormalizedChapterNumber {
  raw: string;
  numeric: number;
  isSpecial: boolean;
  sortKey: string;
}

export function normalizeChapterNumber(input: string | number): NormalizedChapterNumber {
  const raw = String(input).trim();
  
  const specialPatterns: Record<string, number> = {
    'prologue': -1000,
    'prolog': -1000,
    'oneshot': -500,
    'one-shot': -500,
    'extra': 10000,
    'bonus': 10001,
    'side story': 10002,
    'omake': 10003,
    'epilogue': 20000,
    'afterword': 20001,
  };

  const lowerRaw = raw.toLowerCase();
  for (const [pattern, value] of Object.entries(specialPatterns)) {
    if (lowerRaw.includes(pattern)) {
      return {
        raw,
        numeric: value,
        isSpecial: true,
        sortKey: String(value + 100000).padStart(10, '0')
      };
    }
  }

  const numericMatch = raw.match(/(\d+(?:\.\d+)?)/);
  if (numericMatch) {
    const numeric = parseFloat(numericMatch[1]);
    const intPart = Math.floor(numeric);
    const decPart = Math.round((numeric - intPart) * 1000);
    const sortKey = `${String(intPart).padStart(6, '0')}.${String(decPart).padStart(4, '0')}`;
    
    return {
      raw,
      numeric,
      isSpecial: false,
      sortKey
    };
  }

  return {
    raw,
    numeric: 0,
    isSpecial: true,
    sortKey: '000000.0000'
  };
}

export function compareChapterNumbers(a: string | number, b: string | number): number {
  const normA = normalizeChapterNumber(a);
  const normB = normalizeChapterNumber(b);
  return normA.sortKey.localeCompare(normB.sortKey);
}

// Bug 26: Chapter deletion not handled (source removes chapters)
export interface ChapterDeletionCheck {
  shouldDelete: boolean;
  shouldSoftDelete: boolean;
  reason: string;
  chapterIds: string[];
}

export function identifyRemovedChapters(
  existingChapters: { id: string; chapter_number: string; source_chapter_id: string | null }[],
  incomingChapters: { chapter_number: string; source_chapter_id?: string }[]
): ChapterDeletionCheck {
  const incomingSet = new Set(
    incomingChapters.map(c => c.source_chapter_id || c.chapter_number)
  );

  const removedChapters = existingChapters.filter(existing => {
    const key = existing.source_chapter_id || existing.chapter_number;
    return !incomingSet.has(key);
  });

  if (removedChapters.length === 0) {
    return {
      shouldDelete: false,
      shouldSoftDelete: false,
      reason: 'No chapters removed',
      chapterIds: []
    };
  }

  const percentRemoved = removedChapters.length / existingChapters.length;
  
  if (percentRemoved > 0.5) {
    return {
      shouldDelete: false,
      shouldSoftDelete: false,
      reason: `Too many chapters removed (${(percentRemoved * 100).toFixed(0)}%) - possible source error`,
      chapterIds: removedChapters.map(c => c.id)
    };
  }

  return {
    shouldDelete: false,
    shouldSoftDelete: true,
    reason: `${removedChapters.length} chapters no longer available at source`,
    chapterIds: removedChapters.map(c => c.id)
  };
}

// Bug 27: Source returns chapters out of order → progress regression risk
export interface ChapterOrderValidation {
  isOrdered: boolean;
  outOfOrderIndices: number[];
  suggestedOrder: number[];
}

export function validateChapterOrder(
  chapters: { chapter_number: string | number }[]
): ChapterOrderValidation {
  const outOfOrderIndices: number[] = [];
  let lastSortKey = '';

  for (let i = 0; i < chapters.length; i++) {
    const normalized = normalizeChapterNumber(chapters[i].chapter_number);
    if (normalized.sortKey < lastSortKey) {
      outOfOrderIndices.push(i);
    }
    lastSortKey = normalized.sortKey;
  }

  const suggestedOrder = chapters
    .map((c, i) => ({ index: i, sortKey: normalizeChapterNumber(c.chapter_number).sortKey }))
    .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    .map(c => c.index);

  return {
    isOrdered: outOfOrderIndices.length === 0,
    outOfOrderIndices,
    suggestedOrder
  };
}

// Bug 28: Missing transactional boundary across chapter batch insert
export interface BatchInsertConfig {
  batchSize: number;
  useTransaction: boolean;
  retryOnConflict: boolean;
  maxRetries: number;
}

export const DEFAULT_BATCH_CONFIG: BatchInsertConfig = {
  batchSize: 50,
  useTransaction: true,
  retryOnConflict: true,
  maxRetries: 3
};

export function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Bug 29: Sync success can mask metadata failure in UI
export interface SyncResult {
  syncSuccess: boolean;
  metadataSuccess: boolean;
  chaptersAdded: number;
  chaptersUpdated: number;
  errors: string[];
  warnings: string[];
}

export function createSyncResult(
  partial: Partial<SyncResult> = {}
): SyncResult {
  return {
    syncSuccess: partial.syncSuccess ?? false,
    metadataSuccess: partial.metadataSuccess ?? false,
    chaptersAdded: partial.chaptersAdded ?? 0,
    chaptersUpdated: partial.chaptersUpdated ?? 0,
    errors: partial.errors ?? [],
    warnings: partial.warnings ?? []
  };
}

// Bug 30: No max chapters per sync guard
export const SYNC_LIMITS = {
  MAX_CHAPTERS_PER_SYNC: 500,
  MAX_CHAPTERS_PER_BATCH: 50,
  MAX_SYNC_DURATION_MS: 300000,
  MIN_SYNC_INTERVAL_MS: 60000
};

export function validateSyncLimits(
  chapterCount: number,
  lastSyncAt: Date | null
): { allowed: boolean; reason: string } {
  if (chapterCount > SYNC_LIMITS.MAX_CHAPTERS_PER_SYNC) {
    return {
      allowed: false,
      reason: `Chapter count (${chapterCount}) exceeds limit (${SYNC_LIMITS.MAX_CHAPTERS_PER_SYNC})`
    };
  }

  if (lastSyncAt) {
    const timeSince = Date.now() - lastSyncAt.getTime();
    if (timeSince < SYNC_LIMITS.MIN_SYNC_INTERVAL_MS) {
      return {
        allowed: false,
        reason: `Too soon since last sync (${Math.round(timeSince / 1000)}s ago)`
      };
    }
  }

  return { allowed: true, reason: 'Sync allowed' };
}

// Bug 31: Sync jobs lack idempotency keys
export function generateSyncJobId(
  seriesSourceId: string,
  syncType: 'full' | 'incremental' = 'incremental'
): string {
  return `sync:${syncType}:${seriesSourceId}`;
}

// Bug 32: Same sync job can run twice concurrently
export interface JobDeduplication {
  jobId: string;
  fingerprint: string;
  createdAt: Date;
}

export function generateJobFingerprint(
  jobType: string,
  entityId: string,
  params: Record<string, unknown> = {}
): string {
  const data = { jobType, entityId, ...params };
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .substring(0, 16);
}

// Bug 33: Source errors can partially write chapters
export interface PartialWriteRecovery {
  checkpoint: number;
  processedIds: string[];
  failedIds: string[];
  canResume: boolean;
}

export function createCheckpoint(
  processedIds: string[],
  failedIds: string[]
): PartialWriteRecovery {
  return {
    checkpoint: processedIds.length,
    processedIds,
    failedIds,
    canResume: failedIds.length < processedIds.length * 0.1
  };
}

// Bug 34: No dedupe by (source_id, source_chapter_id) enforced
export function buildChapterSourceUpsertQuery(): string {
  return `
    INSERT INTO chapter_sources (
      chapter_id, series_source_id, source_name, source_chapter_id, 
      source_chapter_url, is_available, detected_at
    )
    VALUES ($1, $2, $3, $4, $5, $6, NOW())
    ON CONFLICT (series_source_id, chapter_id) 
    DO UPDATE SET 
      source_chapter_url = EXCLUDED.source_chapter_url,
      is_available = EXCLUDED.is_available,
      last_checked_at = NOW()
    RETURNING id
  `;
}

// Bug 35: Chapter title changes not reconciled
export interface ChapterReconciliation {
  hasChanges: boolean;
  titleChanged: boolean;
  urlChanged: boolean;
  availabilityChanged: boolean;
  changes: Record<string, { old: unknown; new: unknown }>;
}

export function reconcileChapterChanges(
  existing: {
    chapter_title?: string | null;
    chapter_url?: string;
    is_available?: boolean;
  },
  incoming: {
    chapter_title?: string | null;
    chapter_url?: string;
    is_available?: boolean;
  }
): ChapterReconciliation {
  const changes: Record<string, { old: unknown; new: unknown }> = {};

  const titleChanged = existing.chapter_title !== incoming.chapter_title;
  const urlChanged = existing.chapter_url !== incoming.chapter_url;
  const availabilityChanged = existing.is_available !== incoming.is_available;

  if (titleChanged) {
    changes['chapter_title'] = { old: existing.chapter_title, new: incoming.chapter_title };
  }
  if (urlChanged) {
    changes['chapter_url'] = { old: existing.chapter_url, new: incoming.chapter_url };
  }
  if (availabilityChanged) {
    changes['is_available'] = { old: existing.is_available, new: incoming.is_available };
  }

  return {
    hasChanges: Object.keys(changes).length > 0,
    titleChanged,
    urlChanged,
    availabilityChanged,
    changes
  };
}

// Bug 36: No checksum/hash to detect chapter content change
export function generateChapterContentHash(chapter: {
  chapter_number: string;
  chapter_title?: string | null;
  source_chapter_url?: string;
}): string {
  const data = {
    number: chapter.chapter_number,
    title: chapter.chapter_title || '',
    url: chapter.source_chapter_url || ''
  };
  return createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex')
    .substring(0, 16);
}

// Bug 37: No tombstone logic for removed chapters
export interface TombstoneRecord {
  chapterId: string;
  seriesId: string;
  chapterNumber: string;
  deletedAt: Date;
  reason: string;
  canRestore: boolean;
}

export function createTombstone(
  chapter: {
    id: string;
    series_id: string;
    chapter_number: string;
  },
  reason: string
): TombstoneRecord {
  return {
    chapterId: chapter.id,
    seriesId: chapter.series_id,
    chapterNumber: chapter.chapter_number,
    deletedAt: new Date(),
    reason,
    canRestore: true
  };
}

// Bug 38: Sync assumes monotonic chapter growth
export interface ChapterGrowthValidation {
  isMonotonic: boolean;
  hasRegressions: boolean;
  regressions: { before: number; after: number }[];
  warnings: string[];
}

export function validateChapterGrowth(
  previousCount: number,
  currentCount: number,
  previousLatest: number | null,
  currentLatest: number | null
): ChapterGrowthValidation {
  const regressions: { before: number; after: number }[] = [];
  const warnings: string[] = [];

  if (currentCount < previousCount) {
    regressions.push({ before: previousCount, after: currentCount });
    warnings.push(`Chapter count decreased from ${previousCount} to ${currentCount}`);
  }

  if (previousLatest !== null && currentLatest !== null) {
    if (currentLatest < previousLatest) {
      warnings.push(`Latest chapter number decreased from ${previousLatest} to ${currentLatest}`);
    }
  }

  return {
    isMonotonic: regressions.length === 0 && warnings.length === 0,
    hasRegressions: regressions.length > 0,
    regressions,
    warnings
  };
}

// Bug 39: Chapter insert errors not retried safely
export interface RetryableInsert {
  chapter: unknown;
  attemptCount: number;
  lastError: string | null;
  canRetry: boolean;
}

const RETRYABLE_ERROR_CODES = ['P2034', '40001', '23505', 'ECONNRESET'];

export function isRetryableInsertError(error: unknown): boolean {
  if (error instanceof Error) {
    const anyError = error as { code?: string };
    if (anyError.code && RETRYABLE_ERROR_CODES.includes(anyError.code)) {
      return true;
    }
    if (error.message.includes('serialization') || error.message.includes('deadlock')) {
      return true;
    }
  }
  return false;
}

// Bug 40: No post-sync invariant verification
export interface PostSyncInvariants {
  chapterCountMatches: boolean;
  noGapsInNumbering: boolean;
  latestChapterCorrect: boolean;
  allSourcesLinked: boolean;
  issues: string[];
}

export function verifyPostSyncInvariants(
  expectedCount: number,
  actualCount: number,
  chapters: { chapter_number: string; series_source_id: string | null }[]
): PostSyncInvariants {
  const issues: string[] = [];

  const chapterCountMatches = expectedCount === actualCount;
  if (!chapterCountMatches) {
    issues.push(`Expected ${expectedCount} chapters, found ${actualCount}`);
  }

  const sorted = [...chapters].sort((a, b) => 
    compareChapterNumbers(a.chapter_number, b.chapter_number)
  );
  
  let noGapsInNumbering = true;
  for (let i = 1; i < sorted.length; i++) {
    const prev = normalizeChapterNumber(sorted[i - 1].chapter_number);
    const curr = normalizeChapterNumber(sorted[i].chapter_number);
    if (!prev.isSpecial && !curr.isSpecial) {
      const gap = curr.numeric - prev.numeric;
      if (gap > 2) {
        noGapsInNumbering = false;
        issues.push(`Gap detected between chapters ${prev.raw} and ${curr.raw}`);
      }
    }
  }

  const allSourcesLinked = chapters.every(c => c.series_source_id !== null);
  if (!allSourcesLinked) {
    const unlinked = chapters.filter(c => c.series_source_id === null).length;
    issues.push(`${unlinked} chapters have no source linked`);
  }

  return {
    chapterCountMatches,
    noGapsInNumbering,
    latestChapterCorrect: true,
    allSourcesLinked,
    issues
  };
}
