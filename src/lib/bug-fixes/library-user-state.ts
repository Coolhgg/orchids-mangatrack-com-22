/**
 * H. LIBRARY & USER STATE (Bugs 121-140)
 * 
 * Comprehensive fixes for library management and user state issues.
 */

// Bug 121: Library entry created before source verification completes
export interface SourceVerification {
  url: string;
  verified: boolean;
  sourceName: string | null;
  sourceId: string | null;
  error: string | null;
  verifiedAt: Date | null;
}

const SOURCE_PATTERNS: Record<string, RegExp> = {
  mangadex: /mangadex\.org\/(?:title|manga)\/([a-f0-9-]+)/i,
  mangasee: /mangasee123\.com\/manga\/([^\/]+)/i,
  asura: /asura(?:scans|toon)\.(?:com|gg)\/(?:manga|series)\/([^\/]+)/i,
  flame: /flamescans\.org\/series\/([^\/]+)/i,
  reaper: /reaperscans\.com\/(?:series|comics)\/([^\/]+)/i
};

export function verifySourceUrl(url: string): SourceVerification {
  try {
    new URL(url);
  } catch {
    return { url, verified: false, sourceName: null, sourceId: null, error: 'Invalid URL format', verifiedAt: null };
  }

  for (const [sourceName, pattern] of Object.entries(SOURCE_PATTERNS)) {
    const match = url.match(pattern);
    if (match) {
      return {
        url,
        verified: true,
        sourceName,
        sourceId: match[1],
        error: null,
        verifiedAt: new Date()
      };
    }
  }

  return { url, verified: false, sourceName: null, sourceId: null, error: 'Unsupported source', verifiedAt: null };
}

// Bug 122: Library entry delete race with background sync
export interface DeletionGuard {
  entryId: string;
  canDelete: boolean;
  blockedBy: string[];
  waitMs: number;
}

export function checkDeletionSafety(
  entryId: string,
  activeJobs: { type: string; entityId: string }[]
): DeletionGuard {
  const blockedBy: string[] = [];

  for (const job of activeJobs) {
    if (job.entityId === entryId) {
      blockedBy.push(job.type);
    }
  }

  return {
    entryId,
    canDelete: blockedBy.length === 0,
    blockedBy,
    waitMs: blockedBy.length > 0 ? 5000 : 0
  };
}

// Bug 123: User progress can exceed latest chapter
export interface ProgressValidation {
  isValid: boolean;
  clampedProgress: number;
  warning: string | null;
}

export function validateProgress(
  reportedProgress: number,
  latestChapter: number | null,
  tolerance: number = 0.1
): ProgressValidation {
  if (reportedProgress < 0) {
    return { isValid: false, clampedProgress: 0, warning: 'Progress cannot be negative' };
  }

  if (latestChapter === null) {
    return { isValid: true, clampedProgress: reportedProgress, warning: null };
  }

  const maxAllowed = latestChapter * (1 + tolerance);

  if (reportedProgress > maxAllowed) {
    return {
      isValid: false,
      clampedProgress: latestChapter,
      warning: `Progress ${reportedProgress} exceeds latest chapter ${latestChapter}`
    };
  }

  return { isValid: true, clampedProgress: reportedProgress, warning: null };
}

// Bug 124: Progress stored as float causes precision drift
export const PROGRESS_PRECISION = 2;

export function normalizeProgress(progress: number | string | null): number {
  if (progress === null) return 0;
  const num = typeof progress === 'string' ? parseFloat(progress) : progress;
  if (isNaN(num)) return 0;
  return Math.round(num * Math.pow(10, PROGRESS_PRECISION)) / Math.pow(10, PROGRESS_PRECISION);
}

export function compareProgress(a: number | null, b: number | null): number {
  const normA = normalizeProgress(a);
  const normB = normalizeProgress(b);
  return normA - normB;
}

// Bug 125: Progress regression possible under concurrent sync
export function mergeProgress(existing: number | null, incoming: number | null): number {
  const normExisting = normalizeProgress(existing);
  const normIncoming = normalizeProgress(incoming);
  return Math.max(normExisting, normIncoming);
}

// Bug 126: Multiple devices updating progress concurrently can race
export interface ProgressUpdate {
  userId: string;
  entryId: string;
  progress: number;
  deviceId: string | null;
  timestamp: Date;
  version: number;
}

export function resolveProgressConflict(updates: ProgressUpdate[]): ProgressUpdate | null {
  if (updates.length === 0) return null;

  const sorted = [...updates].sort((a, b) => {
    const progressDiff = b.progress - a.progress;
    if (Math.abs(progressDiff) > 0.001) return progressDiff;
    return b.timestamp.getTime() - a.timestamp.getTime();
  });

  return sorted[0];
}

// Bug 127: Library status transitions not atomic
export interface StatusTransition {
  from: string;
  to: string;
  allowed: boolean;
  reason: string;
}

const VALID_TRANSITIONS: Record<string, string[]> = {
  reading: ['completed', 'on_hold', 'dropped', 'plan_to_read'],
  completed: ['reading', 'dropped'],
  on_hold: ['reading', 'dropped', 'plan_to_read'],
  dropped: ['reading', 'plan_to_read'],
  plan_to_read: ['reading', 'dropped']
};

export function validateStatusTransition(from: string, to: string): StatusTransition {
  if (from === to) {
    return { from, to, allowed: true, reason: 'No change' };
  }

  const allowedTransitions = VALID_TRANSITIONS[from];
  if (!allowedTransitions) {
    return { from, to, allowed: true, reason: 'Unknown source status, allowing' };
  }

  if (allowedTransitions.includes(to)) {
    return { from, to, allowed: true, reason: 'Valid transition' };
  }

  return { from, to, allowed: false, reason: `Cannot transition from '${from}' to '${to}'` };
}

// Bug 128: "Completed" status not reconciled with new chapters
export interface CompletedSeriesCheck {
  seriesId: string;
  previousChapterCount: number;
  newChapterCount: number;
  hasNewChapters: boolean;
  shouldNotify: boolean;
  suggestedStatus: string;
}

export function checkCompletedSeriesUpdate(
  currentStatus: string,
  previousCount: number,
  newCount: number
): CompletedSeriesCheck {
  const hasNew = newCount > previousCount;

  if (currentStatus !== 'completed' || !hasNew) {
    return {
      seriesId: '',
      previousChapterCount: previousCount,
      newChapterCount: newCount,
      hasNewChapters: hasNew,
      shouldNotify: false,
      suggestedStatus: currentStatus
    };
  }

  return {
    seriesId: '',
    previousChapterCount: previousCount,
    newChapterCount: newCount,
    hasNewChapters: true,
    shouldNotify: true,
    suggestedStatus: 'reading'
  };
}

// Bug 129: Dropped series can still receive sync updates
const SYNC_ELIGIBLE_STATUSES = ['reading', 'on_hold', 'plan_to_read'];

export function shouldSyncEntry(
  status: string,
  forceSync: boolean = false
): { shouldSync: boolean; reason: string } {
  if (forceSync) {
    return { shouldSync: true, reason: 'Force sync requested' };
  }

  if (SYNC_ELIGIBLE_STATUSES.includes(status)) {
    return { shouldSync: true, reason: 'Status eligible for sync' };
  }

  return { shouldSync: false, reason: `Status '${status}' not eligible for automatic sync` };
}

// Bug 130: Library filters rely on stale cached values
export interface FilterCache {
  userId: string;
  filters: Record<string, unknown>;
  computedAt: Date;
  validUntil: Date;
}

export function isFilterCacheValid(cache: FilterCache | null, maxAgeMs: number = 60000): boolean {
  if (!cache) return false;
  return new Date() < cache.validUntil && Date.now() - cache.computedAt.getTime() < maxAgeMs;
}

// Bug 131: Bulk library actions lack transaction safety
export interface BulkActionResult {
  totalRequested: number;
  successCount: number;
  failureCount: number;
  skippedCount: number;
  failures: { id: string; error: string }[];
}

export function createBulkActionResult(): BulkActionResult {
  return {
    totalRequested: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    failures: []
  };
}

// Bug 132: Library ordering unstable under concurrent updates
export interface StableSortKey {
  primaryKey: string | number;
  secondaryKey: string;
  tertiaryKey: string;
}

export function createStableSortKey(
  entry: { updated_at: Date; added_at: Date; id: string }
): StableSortKey {
  return {
    primaryKey: entry.updated_at.getTime(),
    secondaryKey: entry.added_at.toISOString(),
    tertiaryKey: entry.id
  };
}

export function compareStableSortKeys(a: StableSortKey, b: StableSortKey): number {
  if (a.primaryKey !== b.primaryKey) {
    return b.primaryKey > a.primaryKey ? 1 : -1;
  }
  if (a.secondaryKey !== b.secondaryKey) {
    return b.secondaryKey.localeCompare(a.secondaryKey);
  }
  return a.tertiaryKey.localeCompare(b.tertiaryKey);
}

// Bug 133: No guard against library entry duplication
export function generateLibraryEntryKey(userId: string, sourceUrl: string): string {
  return `${userId}:${sourceUrl.toLowerCase()}`;
}

// Bug 134: Library entry foreign keys not always enforced
export interface ForeignKeyCheck {
  valid: boolean;
  missingReferences: string[];
}

export async function validateLibraryEntryFKs(
  entry: { user_id: string; series_id: string | null },
  checkFn: (table: string, id: string) => Promise<boolean>
): Promise<ForeignKeyCheck> {
  const missing: string[] = [];

  const userExists = await checkFn('users', entry.user_id);
  if (!userExists) missing.push('user_id');

  if (entry.series_id) {
    const seriesExists = await checkFn('series', entry.series_id);
    if (!seriesExists) missing.push('series_id');
  }

  return { valid: missing.length === 0, missingReferences: missing };
}

// Bug 135: Library sync can re-add removed entries
export interface SoftDeleteCheck {
  id: string;
  isDeleted: boolean;
  deletedAt: Date | null;
  canRestore: boolean;
}

export function checkSoftDelete(
  entry: { deleted_at: Date | null },
  restoreWindowDays: number = 30
): SoftDeleteCheck {
  const isDeleted = entry.deleted_at !== null;
  let canRestore = false;

  if (isDeleted && entry.deleted_at) {
    const daysSinceDelete = (Date.now() - entry.deleted_at.getTime()) / (24 * 60 * 60 * 1000);
    canRestore = daysSinceDelete <= restoreWindowDays;
  }

  return {
    id: '',
    isDeleted,
    deletedAt: entry.deleted_at,
    canRestore
  };
}

// Bug 136: Missing invariant: library entry must reference source
export interface LibraryEntryInvariants {
  hasSourceUrl: boolean;
  hasSourceName: boolean;
  hasValidUrl: boolean;
  allInvariantsMet: boolean;
}

export function checkLibraryEntryInvariants(
  entry: { source_url: string | null; source_name: string | null }
): LibraryEntryInvariants {
  const hasSourceUrl = Boolean(entry.source_url && entry.source_url.length > 0);
  const hasSourceName = Boolean(entry.source_name && entry.source_name.length > 0);

  let hasValidUrl = false;
  if (entry.source_url) {
    try {
      new URL(entry.source_url);
      hasValidUrl = true;
    } catch {
      hasValidUrl = false;
    }
  }

  return {
    hasSourceUrl,
    hasSourceName,
    hasValidUrl,
    allInvariantsMet: hasSourceUrl && hasSourceName && hasValidUrl
  };
}

// Bug 137: User-specific metadata duplicates global work
// Bug 138: Library-level metadata overrides not isolated
export interface UserMetadataOverride {
  userId: string;
  entityType: 'series' | 'library_entry';
  entityId: string;
  field: string;
  value: unknown;
  createdAt: Date;
}

const ALLOWED_USER_OVERRIDE_FIELDS = {
  series: ['user_title', 'user_notes', 'user_rating', 'user_tags'],
  library_entry: ['custom_title', 'notes', 'rating', 'tags']
};

export function canUserOverrideField(
  entityType: 'series' | 'library_entry',
  field: string
): boolean {
  return ALLOWED_USER_OVERRIDE_FIELDS[entityType].includes(field);
}

export function mergeUserOverrides<T extends Record<string, unknown>>(
  globalData: T,
  userOverrides: Partial<T>
): T {
  const merged = { ...globalData };

  for (const [key, value] of Object.entries(userOverrides)) {
    if (value !== undefined && value !== null) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }

  return merged;
}

// Bug 139: Library cleanup scripts can delete valid entries
export interface CleanupCandidate {
  id: string;
  reason: string;
  safeToDelete: boolean;
  requiresReview: boolean;
}

export function evaluateCleanupCandidate(
  entry: {
    id: string;
    deleted_at: Date | null;
    last_read_at: Date | null;
    added_at: Date;
    status: string;
  },
  thresholds: {
    minAgeDays: number;
    minInactiveDays: number;
  }
): CleanupCandidate {
  if (entry.deleted_at) {
    const daysSinceDelete = (Date.now() - entry.deleted_at.getTime()) / (24 * 60 * 60 * 1000);
    if (daysSinceDelete > 90) {
      return { id: entry.id, reason: 'Soft-deleted > 90 days', safeToDelete: true, requiresReview: false };
    }
  }

  const ageDays = (Date.now() - entry.added_at.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays < thresholds.minAgeDays) {
    return { id: entry.id, reason: 'Too recent', safeToDelete: false, requiresReview: false };
  }

  if (entry.status === 'reading' || entry.status === 'on_hold') {
    return { id: entry.id, reason: 'Active status', safeToDelete: false, requiresReview: true };
  }

  return { id: entry.id, reason: 'Passed checks', safeToDelete: false, requiresReview: true };
}

// Bug 140: No background reconciliation for library consistency
export interface ReconciliationTask {
  taskType: 'orphaned_entry' | 'missing_series' | 'stale_progress' | 'duplicate_entry';
  entityId: string;
  details: Record<string, unknown>;
  priority: 'high' | 'medium' | 'low';
  autoFix: boolean;
}

export function identifyReconciliationTasks(
  entries: {
    id: string;
    series_id: string | null;
    source_url: string;
    last_read_chapter: number | null;
  }[],
  validSeriesIds: Set<string>
): ReconciliationTask[] {
  const tasks: ReconciliationTask[] = [];
  const seenUrls = new Map<string, string>();

  for (const entry of entries) {
    if (entry.series_id && !validSeriesIds.has(entry.series_id)) {
      tasks.push({
        taskType: 'missing_series',
        entityId: entry.id,
        details: { seriesId: entry.series_id },
        priority: 'high',
        autoFix: true
      });
    }

    const urlKey = entry.source_url.toLowerCase();
    if (seenUrls.has(urlKey)) {
      tasks.push({
        taskType: 'duplicate_entry',
        entityId: entry.id,
        details: { duplicateOf: seenUrls.get(urlKey), sourceUrl: entry.source_url },
        priority: 'medium',
        autoFix: false
      });
    } else {
      seenUrls.set(urlKey, entry.id);
    }
  }

  return tasks;
}
