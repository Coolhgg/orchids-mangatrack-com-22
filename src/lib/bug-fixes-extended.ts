import { z } from 'zod';
import { TransactionClient } from '@/lib/prisma';
import { logger } from '@/lib/logger';

export const MetadataStatusSchema = z.enum(['pending', 'enriched', 'unavailable', 'failed']);
export type MetadataStatus = z.infer<typeof MetadataStatusSchema>;

export const SyncStatusSchema = z.enum(['healthy', 'degraded', 'failed']);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export function isMetadataComplete(entry: {
  metadata_status: MetadataStatus;
  series?: { cover_url?: string | null; title?: string | null } | null;
}): boolean {
  if (entry.metadata_status !== 'enriched') return false;
  if (!entry.series) return false;
  if (!entry.series.title || entry.series.title.trim().length === 0) return false;
  return true;
}

export function hasCoverImage(entry: {
  metadata_status: MetadataStatus;
  series?: { cover_url?: string | null } | null;
}): boolean {
  if (!entry.series?.cover_url) return false;
  try {
    new URL(entry.series.cover_url);
    return true;
  } catch {
    return false;
  }
}

export function getMetadataDisplayState(entry: {
  metadata_status: MetadataStatus;
  sync_status?: SyncStatus;
  needs_review?: boolean;
}): {
  showCover: boolean;
  showPlaceholder: boolean;
  showEnrichingBadge: boolean;
  showUnavailableBadge: boolean;
  showFailedBadge: boolean;
  showSyncWarning: boolean;
  tooltipMessage: string;
} {
  const { metadata_status, sync_status = 'healthy', needs_review = false } = entry;

  switch (metadata_status) {
    case 'enriched':
      return {
        showCover: true,
        showPlaceholder: false,
        showEnrichingBadge: false,
        showUnavailableBadge: false,
        showFailedBadge: false,
        showSyncWarning: sync_status !== 'healthy',
        tooltipMessage: sync_status === 'healthy' 
          ? 'Metadata linked successfully' 
          : `Metadata OK, but sync is ${sync_status}`,
      };

    case 'pending':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: true,
        showUnavailableBadge: false,
        showFailedBadge: false,
        showSyncWarning: false,
        tooltipMessage: 'Searching for metadata...',
      };

    case 'unavailable':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: false,
        showUnavailableBadge: true,
        showFailedBadge: false,
        showSyncWarning: false,
        tooltipMessage: needs_review 
          ? 'Metadata not found. Click to manually link.'
          : 'No metadata available on MangaDex. Chapters still sync normally.',
      };

    case 'failed':
      return {
        showCover: false,
        showPlaceholder: true,
        showEnrichingBadge: false,
        showUnavailableBadge: false,
        showFailedBadge: true,
        showSyncWarning: false,
        tooltipMessage: 'Metadata enrichment failed. Click to manually fix.',
      };

    default:
      assertNever(metadata_status);
  }
}

function assertNever(x: never): never {
  throw new Error(`Unexpected metadata status: ${x}`);
}

export function exhaustiveMetadataCheck(status: MetadataStatus): string {
  switch (status) {
    case 'pending': return 'pending';
    case 'enriched': return 'enriched';
    case 'unavailable': return 'unavailable';
    case 'failed': return 'failed';
    default:
      return assertNever(status);
  }
}

export function exhaustiveSyncCheck(status: SyncStatus): string {
  switch (status) {
    case 'healthy': return 'healthy';
    case 'degraded': return 'degraded';
    case 'failed': return 'failed';
    default:
      return assertNever(status as never);
  }
}

export interface ReviewDecision {
  needsReview: boolean;
  confidence: number;
  factors: string[];
}

export function calculateReviewDecision(params: {
  similarity: number;
  isExactIdMatch: boolean;
  creatorMatch?: boolean;
  languageMatch?: boolean;
  yearDrift?: number;
}): ReviewDecision {
  const factors: string[] = [];
  let confidence = params.similarity;

  if (params.isExactIdMatch) {
    return { needsReview: false, confidence: 1.0, factors: ['exact_id_match'] };
  }

  if (params.similarity < 0.70) {
    factors.push('low_similarity');
  }

  if (params.creatorMatch === false) {
    confidence -= 0.15;
    factors.push('creator_mismatch');
  }

  if (params.languageMatch === false) {
    confidence -= 0.10;
    factors.push('language_mismatch');
  }

  if (params.yearDrift !== undefined && params.yearDrift > 2) {
    confidence -= 0.10;
    factors.push('year_drift');
  }

  const needsReview = confidence < 0.75 || factors.length >= 2;

  return { needsReview, confidence, factors };
}

export function normalizeProgress(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  if (isNaN(value)) return 0;
  return Math.max(0, Math.floor(value * 100) / 100);
}

export function compareProgress(a: number | null, b: number | null): number {
  const normA = normalizeProgress(a);
  const normB = normalizeProgress(b);
  return normA - normB;
}

export function mergeProgress(existing: number | null, incoming: number | null): number {
  const normalized1 = normalizeProgress(existing);
  const normalized2 = normalizeProgress(incoming);
  return Math.max(normalized1, normalized2);
}

export async function safeSeriesSourceUpdate(
  tx: TransactionClient,
  sourceUrl: string,
  targetSeriesId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const existing = await tx.seriesSource.findFirst({
      where: { source_url: sourceUrl },
      select: { id: true, series_id: true },
    });

    if (!existing) {
      return { success: true };
    }

    if (existing.series_id === targetSeriesId) {
      return { success: true };
    }

    const targetSource = await tx.seriesSource.findFirst({
      where: { series_id: targetSeriesId, source_url: sourceUrl },
    });

    if (targetSource) {
      return { success: true };
    }

    await tx.seriesSource.update({
      where: { id: existing.id },
      data: { series_id: targetSeriesId },
    });

    return { success: true };
  } catch (error) {
    logger.error('Safe series source update failed', { error: error instanceof Error ? error.message : String(error) });
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

export function areLanguagesCompatible(lang1: string | null, lang2: string | null): boolean {
  if (!lang1 || !lang2) return true;
  
  const normalize = (l: string) => l.toLowerCase().replace(/[^a-z]/g, '');
  const n1 = normalize(lang1);
  const n2 = normalize(lang2);
  
  if (n1 === n2) return true;
  
  const aliases: Record<string, string[]> = {
    'en': ['english', 'eng'],
    'ja': ['japanese', 'jpn', 'jp'],
    'ko': ['korean', 'kor', 'kr'],
    'zh': ['chinese', 'chi', 'cn', 'zhtw', 'zhhk', 'zhhans', 'zhhant'],
  };
  
  for (const [code, synonyms] of Object.entries(aliases)) {
    const all = [code, ...synonyms];
    if (all.includes(n1) && all.includes(n2)) return true;
  }
  
  return false;
}

export function checkYearCompatibility(year1: number | null, year2: number | null, maxDrift: number = 3): {
  compatible: boolean;
  drift: number;
} {
  if (!year1 || !year2) return { compatible: true, drift: 0 };
  const drift = Math.abs(year1 - year2);
  return { compatible: drift <= maxDrift, drift };
}

export function generateMetadataChecksum(metadata: {
  title?: string;
  description?: string;
  cover_url?: string;
  status?: string;
}): string {
  const content = JSON.stringify({
    title: metadata.title?.toLowerCase().trim(),
    description: metadata.description?.slice(0, 100).toLowerCase(),
    cover_url: metadata.cover_url,
    status: metadata.status,
  });
  
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(16);
}

export function hasMetadataChanged(oldChecksum: string | null, newChecksum: string): boolean {
  if (!oldChecksum) return true;
  return oldChecksum !== newChecksum;
}

export interface CreatorInfo {
  authors?: string[];
  artists?: string[];
}

export function calculateEnhancedMatchScore(
  titleSimilarity: number,
  creators1: CreatorInfo | null,
  creators2: CreatorInfo | null
): number {
  let score = titleSimilarity * 0.7;
  
  if (creators1 && creators2) {
    const authors1 = new Set((creators1.authors || []).map(a => a.toLowerCase()));
    const authors2 = new Set((creators2.authors || []).map(a => a.toLowerCase()));
    
    let authorOverlap = 0;
    for (const a of authors1) {
      if (authors2.has(a)) authorOverlap++;
    }
    
    const maxAuthors = Math.max(authors1.size, authors2.size, 1);
    score += (authorOverlap / maxAuthors) * 0.3;
  } else {
    score += 0.15;
  }
  
  return Math.min(1, score);
}

export function createResponseValidator<T>(schema: z.ZodType<T>) {
  return {
    validateOrThrow(data: unknown): T {
      return schema.parse(data);
    },
    validateOrDefault(data: unknown, defaultValue: T): T {
      const result = schema.safeParse(data);
      return result.success ? result.data : defaultValue;
    },
  };
}

export function checkMemoryBounds(): { allowed: boolean; stats: { heapUsed: number; heapTotal: number; percentage: number } } {
  if (typeof process === 'undefined' || !process.memoryUsage) {
    return { allowed: true, stats: { heapUsed: 0, heapTotal: 0, percentage: 0 } };
  }

  const { heapUsed, heapTotal } = process.memoryUsage();
  const percentage = (heapUsed / heapTotal) * 100;
  
  const THRESHOLD = 85;
  
  return {
    allowed: percentage < THRESHOLD,
    stats: { heapUsed, heapTotal, percentage },
  };
}

export function getMemoryStats(): { heapUsed: number; heapTotal: number; rss: number; external: number } {
  if (typeof process === 'undefined' || !process.memoryUsage) {
    return { heapUsed: 0, heapTotal: 0, rss: 0, external: 0 };
  }
  const { heapUsed, heapTotal, rss, external } = process.memoryUsage();
  return { heapUsed, heapTotal, rss, external };
}

export { isFeatureEnabled } from '@/lib/config/feature-flags';

// Import from worker-scheduling
import {
  getMonotonicTimestamp as _getMonotonicTimestamp,
  getSchedulerConfig as _getSchedulerConfig,
  updateSchedulerConfig as _updateSchedulerConfig,
  recordJobStart as _recordJobStart,
  recordJobEnd as _recordJobEnd,
  canStartNewJob as _canStartNewJob,
} from '@/lib/bug-fixes/worker-scheduling';

import {
  calculateSafeDelay as _calculateSafeDelay,
} from '@/lib/bug-fixes/workers-concurrency';

// Re-export with explicit function signatures for better compatibility
export function getMonotonicTimestamp(): number {
  return _getMonotonicTimestamp();
}

export function getSchedulerConfig(schedulerName: string) {
  return _getSchedulerConfig(schedulerName);
}

export function updateSchedulerConfig(schedulerName: string, updates: any) {
  return _updateSchedulerConfig(schedulerName, updates);
}

export function recordJobStart(queueName: string, sourceName?: string): void {
  return _recordJobStart(queueName, sourceName);
}

export function recordJobEnd(queueName: string, sourceName?: string): void {
  return _recordJobEnd(queueName, sourceName);
}

/**
 * Bug 170-171: Check if a new job can start based on global concurrency limits
 * @param queueName - The name of the queue
 * @param sourceName - Optional source name for per-source limits
 * @returns boolean - true if job can start, false if limits reached
 */
export function canStartJob(queueName: string, sourceName?: string): boolean {
  return _canStartNewJob(queueName, sourceName);
}

export function calculateSafeDelay(baseDelay: number, attempt: number): number {
  const targetTime = new Date(Date.now() + baseDelay * Math.pow(2, attempt));
  return _calculateSafeDelay(targetTime, 0);
}

export function getConcurrencyStats(): { globalActive: number; utilization: number } {
  return {
    globalActive: 0,
    utilization: 0,
  };
}
