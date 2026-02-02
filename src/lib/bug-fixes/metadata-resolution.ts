/**
 * A. METADATA & RESOLUTION (Bugs 1-20)
 * 
 * Comprehensive fixes for metadata enrichment and resolution issues.
 */

import { createHash } from 'crypto';

// Bug 1: Metadata retry can overwrite manually fixed metadata
// Bug 2: No "manual override wins" precedence rule
export interface ManualOverrideCheck {
  isManuallyOverridden: boolean;
  overrideSource: 'manually_linked' | 'manual_override_at' | 'USER_OVERRIDE' | null;
  canEnrich: boolean;
  reason: string;
}

export function checkManualOverride(entry: {
  manually_linked?: boolean | null;
  manual_override_at?: Date | null;
  series?: { metadata_source?: string } | null;
}): ManualOverrideCheck {
  if (entry.manually_linked === true) {
    return {
      isManuallyOverridden: true,
      overrideSource: 'manually_linked',
      canEnrich: false,
      reason: 'Entry was manually linked by user'
    };
  }

  if (entry.manual_override_at) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    if (new Date(entry.manual_override_at) > thirtyDaysAgo) {
      return {
        isManuallyOverridden: true,
        overrideSource: 'manual_override_at',
        canEnrich: false,
        reason: `Manual override within last 30 days (${entry.manual_override_at})`
      };
    }
  }

  if (entry.series?.metadata_source === 'USER_OVERRIDE') {
    return {
      isManuallyOverridden: true,
      overrideSource: 'USER_OVERRIDE',
      canEnrich: false,
      reason: 'Series has USER_OVERRIDE metadata source'
    };
  }

  return {
    isManuallyOverridden: false,
    overrideSource: null,
    canEnrich: true,
    reason: 'No manual override detected'
  };
}

// Bug 3: Metadata retries don't lock the library entry row
// Bug 4: Two concurrent retries can race and flip status
export function buildSelectForUpdateQuery(tableName: string, idColumn: string, id: string): string {
  return `SELECT * FROM ${tableName} WHERE ${idColumn} = '${id}'::uuid FOR UPDATE SKIP LOCKED`;
}

export function buildSelectForUpdateNoWaitQuery(tableName: string, idColumn: string, id: string): string {
  return `SELECT * FROM ${tableName} WHERE ${idColumn} = '${id}'::uuid FOR UPDATE NOWAIT`;
}

// Bug 5: FAILED metadata is terminal without auto-healing
export interface RecoverySchedule {
  shouldSchedule: boolean;
  delayMs: number;
  nextAttemptAt: Date;
  reason: string;
}

const RECOVERY_DELAYS = [
  1 * 24 * 60 * 60 * 1000,   // 1 day
  3 * 24 * 60 * 60 * 1000,   // 3 days
  7 * 24 * 60 * 60 * 1000,   // 7 days
  14 * 24 * 60 * 60 * 1000,  // 14 days
];

export function calculateRecoverySchedule(
  status: string,
  retryCount: number,
  maxRetries: number = 10
): RecoverySchedule {
  if (status === 'enriched') {
    return {
      shouldSchedule: false,
      delayMs: 0,
      nextAttemptAt: new Date(),
      reason: 'Already enriched'
    };
  }

  if (retryCount >= maxRetries) {
    return {
      shouldSchedule: false,
      delayMs: 0,
      nextAttemptAt: new Date(),
      reason: `Max retries (${maxRetries}) exceeded`
    };
  }

  const delayIndex = Math.min(retryCount, RECOVERY_DELAYS.length - 1);
  const delayMs = RECOVERY_DELAYS[delayIndex];

  return {
    shouldSchedule: true,
    delayMs,
    nextAttemptAt: new Date(Date.now() + delayMs),
    reason: `Scheduling recovery attempt ${retryCount + 1} in ${Math.round(delayMs / (24 * 60 * 60 * 1000))} days`
  };
}

// Bug 6: Metadata failure is library-entry scoped, not series-scoped
export interface SeriesScopedMetadata {
  seriesSourceId: string;
  status: string;
  lastError: string | null;
  canShareResolution: boolean;
}

export function canShareSeriesResolution(
  sourceStatus: string,
  sourceRetryCount: number
): boolean {
  return sourceStatus === 'enriched' || 
         (sourceStatus === 'pending' && sourceRetryCount < 3);
}

// Bug 7: Same series resolved multiple times for different users
export function generateSeriesResolutionKey(
  sourceName: string,
  sourceId: string
): string {
  return `series:${sourceName}:${sourceId}`;
}

// Bug 8: No schema version stored for metadata payload
export const METADATA_SCHEMA_VERSION = 1;

export interface VersionedMetadata {
  schemaVersion: number;
  payload: Record<string, unknown>;
  checksum: string;
  generatedAt: Date;
}

export function createVersionedMetadata(payload: Record<string, unknown>): VersionedMetadata {
  const checksum = generateMetadataChecksum(payload);
  return {
    schemaVersion: METADATA_SCHEMA_VERSION,
    payload,
    checksum,
    generatedAt: new Date()
  };
}

// Bug 9: Enriched metadata not revalidated after schema changes
export function needsSchemaRevalidation(
  currentVersion: number,
  targetVersion: number = METADATA_SCHEMA_VERSION
): boolean {
  return currentVersion < targetVersion;
}

// Bug 10: Partial metadata can mark status as ENRICHED
export interface EnrichmentValidation {
  isValid: boolean;
  missingFields: string[];
  invalidFields: string[];
  canMarkEnriched: boolean;
}

const REQUIRED_ENRICHMENT_FIELDS = ['title', 'id'];
const RECOMMENDED_ENRICHMENT_FIELDS = ['cover_url', 'description', 'status'];

export function validateEnrichmentCompleteness(
  metadata: Record<string, unknown>
): EnrichmentValidation {
  const missingFields: string[] = [];
  const invalidFields: string[] = [];

  for (const field of REQUIRED_ENRICHMENT_FIELDS) {
    if (!metadata[field]) {
      missingFields.push(field);
    }
  }

  if (metadata.title && typeof metadata.title === 'string') {
    if (metadata.title.trim().length === 0) {
      invalidFields.push('title (empty string)');
    }
    if (metadata.title.length > 500) {
      invalidFields.push('title (exceeds max length)');
    }
  }

  if (metadata.cover_url && typeof metadata.cover_url === 'string') {
    try {
      new URL(metadata.cover_url);
    } catch {
      invalidFields.push('cover_url (invalid URL)');
    }
  }

  return {
    isValid: missingFields.length === 0 && invalidFields.length === 0,
    missingFields,
    invalidFields,
    canMarkEnriched: missingFields.length === 0
  };
}

// Bug 11: No invariant check after enrichment (title, cover, ids)
export interface EnrichmentInvariants {
  hasTitle: boolean;
  hasCover: boolean;
  hasExternalId: boolean;
  allInvariantsMet: boolean;
}

export function checkEnrichmentInvariants(
  series: {
    title?: string | null;
    cover_url?: string | null;
    mangadex_id?: string | null;
  }
): EnrichmentInvariants {
  const hasTitle = Boolean(series.title && series.title.trim().length > 0);
  const hasCover = Boolean(series.cover_url);
  const hasExternalId = Boolean(series.mangadex_id);

  return {
    hasTitle,
    hasCover,
    hasExternalId,
    allInvariantsMet: hasTitle && hasExternalId
  };
}

// Bug 12: Metadata error messages may leak internal details
const SENSITIVE_ERROR_PATTERNS = [
  /api[_-]?key[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /password[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /https?:\/\/[^:]+:[^@]+@/gi,
  /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /internal\s+server/gi,
  /stack\s*trace/gi,
  /at\s+\S+\s+\(\S+:\d+:\d+\)/g,
  /PostgreSQL|MySQL|MongoDB|Redis/gi,
  /prisma|supabase|database/gi,
];

export function sanitizeMetadataError(error: unknown): string {
  let message = error instanceof Error ? error.message : String(error);
  
  for (const pattern of SENSITIVE_ERROR_PATTERNS) {
    message = message.replace(pattern, '[REDACTED]');
  }
  
  if (message.length > 200) {
    message = message.substring(0, 200) + '...';
  }

  const errorType = error instanceof Error ? error.name : 'Error';
  if (errorType.includes('RateLimit')) {
    return 'External API rate limited. Will retry automatically.';
  }
  if (errorType.includes('Network') || errorType.includes('ECONNREFUSED')) {
    return 'Network error. Will retry automatically.';
  }
  if (errorType.includes('Timeout')) {
    return 'Request timed out. Will retry automatically.';
  }

  return message;
}

// Bug 13: Retry attempts don't mutate search strategy sufficiently
// Bug 14: Retry count increases without changing search space
export interface SearchStrategy {
  variation: 'exact' | 'fuzzy' | 'aggressive' | 'desperate';
  similarityThreshold: number;
  maxCandidates: number;
  tryAltTitles: boolean;
  simplifyTitle: boolean;
  stripSuffixes: boolean;
}

export function getSearchStrategyForAttempt(attemptCount: number): SearchStrategy {
  if (attemptCount <= 1) {
    return {
      variation: 'exact',
      similarityThreshold: 0.85,
      maxCandidates: 5,
      tryAltTitles: false,
      simplifyTitle: false,
      stripSuffixes: false
    };
  }
  
  if (attemptCount === 2) {
    return {
      variation: 'fuzzy',
      similarityThreshold: 0.75,
      maxCandidates: 10,
      tryAltTitles: true,
      simplifyTitle: false,
      stripSuffixes: true
    };
  }
  
  if (attemptCount === 3) {
    return {
      variation: 'aggressive',
      similarityThreshold: 0.65,
      maxCandidates: 15,
      tryAltTitles: true,
      simplifyTitle: true,
      stripSuffixes: true
    };
  }

  return {
    variation: 'desperate',
    similarityThreshold: 0.55,
    maxCandidates: 25,
    tryAltTitles: true,
    simplifyTitle: true,
    stripSuffixes: true
  };
}

export function generateTitleVariations(
  title: string,
  strategy: SearchStrategy
): string[] {
  const variations = [title];
  
  if (strategy.stripSuffixes) {
    const suffixes = [
      /\s*\(manga\)/i, /\s*\(manhwa\)/i, /\s*\(manhua\)/i,
      /\s*\(webtoon\)/i, /\s*\[.*?\]$/, /\s*-\s*raw$/i
    ];
    let clean = title;
    for (const suffix of suffixes) {
      clean = clean.replace(suffix, '');
    }
    if (clean !== title) variations.push(clean.trim());
  }

  if (strategy.simplifyTitle) {
    const simplified = title
      .replace(/[:\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .split(' ')
      .slice(0, 3)
      .join(' ')
      .trim();
    if (simplified.length > 2 && !variations.includes(simplified)) {
      variations.push(simplified);
    }
  }

  if (strategy.tryAltTitles) {
    if (title.toLowerCase().startsWith('the ')) {
      variations.push(title.substring(4));
    }
    const alphaOnly = title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (alphaOnly.length > 2 && !variations.includes(alphaOnly)) {
      variations.push(alphaOnly);
    }
  }

  return [...new Set(variations)];
}

// Bug 15: No backoff jitter → thundering herd on retry
export function calculateBackoffWithJitter(
  attemptCount: number,
  baseDelayMs: number = 1000,
  maxDelayMs: number = 60000,
  jitterFactor: number = 0.3
): number {
  const exponentialDelay = Math.min(
    baseDelayMs * Math.pow(2, attemptCount),
    maxDelayMs
  );
  
  const jitter = exponentialDelay * jitterFactor * (Math.random() * 2 - 1);
  
  return Math.max(baseDelayMs, Math.round(exponentialDelay + jitter));
}

// Bug 16: Resolution jobs lack idempotency keys
// Bug 17: Duplicate resolution jobs can coexist
export function generateIdempotentJobId(
  jobType: string,
  entityId: string,
  scope?: string
): string {
  const parts = [jobType, entityId];
  if (scope) parts.push(scope);
  return parts.join(':');
}

export async function checkJobExists(
  queue: { getJob: (id: string) => Promise<unknown> },
  jobId: string
): Promise<boolean> {
  try {
    const job = await queue.getJob(jobId);
    return job !== null && job !== undefined;
  } catch {
    return false;
  }
}

// Bug 18: Resolution assumes external API stability
export interface ExternalApiHealth {
  isHealthy: boolean;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  shouldBackoff: boolean;
  backoffUntil: Date | null;
}

const apiHealthCache = new Map<string, ExternalApiHealth>();

export function recordApiSuccess(apiName: string): void {
  apiHealthCache.set(apiName, {
    isHealthy: true,
    lastSuccessAt: new Date(),
    consecutiveFailures: 0,
    shouldBackoff: false,
    backoffUntil: null
  });
}

export function recordApiFailure(apiName: string): ExternalApiHealth {
  const current = apiHealthCache.get(apiName) || {
    isHealthy: true,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    shouldBackoff: false,
    backoffUntil: null
  };

  const failures = current.consecutiveFailures + 1;
  const shouldBackoff = failures >= 3;
  const backoffMs = shouldBackoff ? Math.min(failures * 60000, 600000) : 0;

  const health: ExternalApiHealth = {
    isHealthy: failures < 5,
    lastSuccessAt: current.lastSuccessAt,
    consecutiveFailures: failures,
    shouldBackoff,
    backoffUntil: shouldBackoff ? new Date(Date.now() + backoffMs) : null
  };

  apiHealthCache.set(apiName, health);
  return health;
}

export function getApiHealth(apiName: string): ExternalApiHealth {
  return apiHealthCache.get(apiName) || {
    isHealthy: true,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    shouldBackoff: false,
    backoffUntil: null
  };
}

// Bug 19: Resolution success does not guarantee chapter mapping consistency
export interface ChapterMappingValidation {
  isConsistent: boolean;
  issues: string[];
  suggestedActions: string[];
}

export function validateChapterMapping(
  seriesChapterCount: number | null,
  sourceChapterCount: number | null,
  tolerance: number = 0.2
): ChapterMappingValidation {
  const issues: string[] = [];
  const suggestedActions: string[] = [];

  if (seriesChapterCount === null || sourceChapterCount === null) {
    return {
      isConsistent: true,
      issues: ['Chapter counts not available for comparison'],
      suggestedActions: []
    };
  }

  const diff = Math.abs(seriesChapterCount - sourceChapterCount);
  const maxDiff = Math.max(seriesChapterCount, sourceChapterCount) * tolerance;

  if (diff > maxDiff) {
    issues.push(`Chapter count mismatch: series has ${seriesChapterCount}, source has ${sourceChapterCount}`);
    suggestedActions.push('Verify source is correct series');
    suggestedActions.push('Check for volume vs chapter numbering differences');
  }

  return {
    isConsistent: issues.length === 0,
    issues,
    suggestedActions
  };
}

// Bug 20: Metadata enrichment can downgrade previously richer metadata
export interface MetadataComparison {
  shouldUpdate: boolean;
  fieldsToUpdate: string[];
  fieldsToPreserve: string[];
  reason: string;
}

export function compareMetadataRichness(
  existing: Record<string, unknown>,
  incoming: Record<string, unknown>,
  protectedFields: string[] = ['description', 'cover_url', 'genres']
): MetadataComparison {
  const fieldsToUpdate: string[] = [];
  const fieldsToPreserve: string[] = [];

  for (const [key, value] of Object.entries(incoming)) {
    const existingValue = existing[key];

    if (protectedFields.includes(key)) {
      if (existingValue && !value) {
        fieldsToPreserve.push(key);
        continue;
      }
      
      if (typeof existingValue === 'string' && typeof value === 'string') {
        if (existingValue.length > value.length * 1.5) {
          fieldsToPreserve.push(key);
          continue;
        }
      }
      
      if (Array.isArray(existingValue) && Array.isArray(value)) {
        if (existingValue.length > value.length) {
          fieldsToPreserve.push(key);
          continue;
        }
      }
    }

    if (value !== undefined && value !== null) {
      fieldsToUpdate.push(key);
    }
  }

  return {
    shouldUpdate: fieldsToUpdate.length > 0,
    fieldsToUpdate,
    fieldsToPreserve,
    reason: fieldsToPreserve.length > 0
      ? `Preserving ${fieldsToPreserve.length} richer fields from existing metadata`
      : 'All fields can be updated'
  };
}

// Utility: Generate metadata checksum for change detection
export function generateMetadataChecksum(metadata: Record<string, unknown>): string {
  const sortedKeys = Object.keys(metadata).sort();
  const normalized: Record<string, unknown> = {};
  
  for (const key of sortedKeys) {
    const value = metadata[key];
    if (value !== undefined && value !== null) {
      if (Array.isArray(value)) {
        normalized[key] = [...value].sort();
      } else if (typeof value === 'object') {
        normalized[key] = generateMetadataChecksum(value as Record<string, unknown>);
      } else {
        normalized[key] = value;
      }
    }
  }
  
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .substring(0, 16);
}
