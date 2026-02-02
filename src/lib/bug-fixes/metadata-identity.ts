/**
 * G. METADATA, IDENTITY & MERGING (Bugs 101-120)
 * 
 * Comprehensive fixes for metadata identity and series merging issues.
 */

import { createHash } from 'crypto';

// Bug 101: Same series imported twice via different sources creates duplicate canonical rows
export interface CanonicalSeriesMatch {
  matchType: 'exact_id' | 'title_match' | 'fuzzy_match' | 'no_match';
  existingSeriesId: string | null;
  confidence: number;
  matchedOn: string[];
}

export function findCanonicalSeries(
  incoming: {
    mangadex_id?: string | null;
    title: string;
    alternative_titles?: string[];
  },
  existingSeries: {
    id: string;
    mangadex_id?: string | null;
    title: string;
    alternative_titles?: string[] | unknown;
  }[]
): CanonicalSeriesMatch {
  if (incoming.mangadex_id) {
    const exactMatch = existingSeries.find(s => s.mangadex_id === incoming.mangadex_id);
    if (exactMatch) {
      return {
        matchType: 'exact_id',
        existingSeriesId: exactMatch.id,
        confidence: 1.0,
        matchedOn: ['mangadex_id']
      };
    }
  }

  const normalizedIncoming = normalizeTitle(incoming.title);
  
  for (const existing of existingSeries) {
    if (normalizeTitle(existing.title) === normalizedIncoming) {
      return {
        matchType: 'title_match',
        existingSeriesId: existing.id,
        confidence: 0.95,
        matchedOn: ['title']
      };
    }

    const altTitles = Array.isArray(existing.alternative_titles) 
      ? existing.alternative_titles as string[]
      : [];
    
    for (const alt of altTitles) {
      if (normalizeTitle(alt) === normalizedIncoming) {
        return {
          matchType: 'title_match',
          existingSeriesId: existing.id,
          confidence: 0.9,
          matchedOn: ['alternative_title']
        };
      }
    }
  }

  return {
    matchType: 'no_match',
    existingSeriesId: null,
    confidence: 0,
    matchedOn: []
  };
}

// Bug 102: No deterministic canonical series merge rule
export interface MergeDecision {
  shouldMerge: boolean;
  primarySeriesId: string;
  secondarySeriesId: string;
  reason: string;
  preserveFrom: {
    primary: string[];
    secondary: string[];
  };
}

export function decideMerge(
  seriesA: { id: string; created_at: Date; metadata_source: string; total_follows: number },
  seriesB: { id: string; created_at: Date; metadata_source: string; total_follows: number }
): MergeDecision {
  const sourceRank = { 'CANONICAL': 3, 'USER_OVERRIDE': 2, 'INFERRED': 1 };
  const rankA = sourceRank[seriesA.metadata_source as keyof typeof sourceRank] || 0;
  const rankB = sourceRank[seriesB.metadata_source as keyof typeof sourceRank] || 0;

  let primary = seriesA;
  let secondary = seriesB;
  let reason = '';

  if (rankA !== rankB) {
    if (rankB > rankA) {
      primary = seriesB;
      secondary = seriesA;
    }
    reason = `Higher metadata source rank: ${primary.metadata_source}`;
  } else if (seriesA.total_follows !== seriesB.total_follows) {
    if (seriesB.total_follows > seriesA.total_follows) {
      primary = seriesB;
      secondary = seriesA;
    }
    reason = `More followers: ${primary.total_follows}`;
  } else {
    if (seriesB.created_at < seriesA.created_at) {
      primary = seriesB;
      secondary = seriesA;
    }
    reason = `Older creation date: ${primary.created_at.toISOString()}`;
  }

  return {
    shouldMerge: true,
    primarySeriesId: primary.id,
    secondarySeriesId: secondary.id,
    reason,
    preserveFrom: {
      primary: ['title', 'description', 'cover_url', 'mangadex_id'],
      secondary: ['alternative_titles']
    }
  };
}

// Bug 103: Alt-title normalization not locale-safe
// Bug 104: Unicode normalization not applied before similarity scoring
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Bug 105: Similarity scoring sensitive to punctuation ordering
export function calculateTitleSimilarity(titleA: string, titleB: string): number {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  const wordsA = new Set(normA.split(' '));
  const wordsB = new Set(normB.split(' '));
  
  let intersection = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) intersection++;
  }
  
  const union = new Set([...wordsA, ...wordsB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  const maxLen = Math.max(normA.length, normB.length);
  const minLen = Math.min(normA.length, normB.length);
  const lengthRatio = maxLen > 0 ? minLen / maxLen : 1;

  return (jaccard * 0.7) + (lengthRatio * 0.3);
}

// Bug 106: Resolution ignores author/artist metadata when matching
export interface CreatorInfo {
  name: string;
  role: 'author' | 'artist' | 'both';
}

export function normalizeCreatorName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .trim();
}

export function calculateCreatorSimilarity(
  creatorsA: CreatorInfo[],
  creatorsB: CreatorInfo[]
): number {
  if (creatorsA.length === 0 || creatorsB.length === 0) {
    return 0.5;
  }

  const normalizedA = new Set(creatorsA.map(c => normalizeCreatorName(c.name)));
  const normalizedB = new Set(creatorsB.map(c => normalizeCreatorName(c.name)));

  let matches = 0;
  for (const name of normalizedA) {
    if (normalizedB.has(name)) matches++;
  }

  const union = new Set([...normalizedA, ...normalizedB]).size;
  return union > 0 ? matches / union : 0.5;
}

// Bug 107: Metadata enrichment does not verify language consistency
export const LANGUAGE_FAMILIES: Record<string, string[]> = {
  'japanese': ['ja', 'jp', 'japanese'],
  'korean': ['ko', 'kr', 'korean'],
  'chinese': ['zh', 'cn', 'zh-cn', 'zh-tw', 'chinese', 'mandarin'],
  'english': ['en', 'english']
};

export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return 'unknown';
  const normalized = lang.toLowerCase().trim();
  
  for (const [family, codes] of Object.entries(LANGUAGE_FAMILIES)) {
    if (codes.includes(normalized)) return family;
  }
  return normalized;
}

export function areLanguagesCompatible(
  langA: string | null | undefined,
  langB: string | null | undefined
): boolean {
  const normA = normalizeLanguage(langA);
  const normB = normalizeLanguage(langB);
  
  if (normA === 'unknown' || normB === 'unknown') return true;
  return normA === normB;
}

// Bug 108: Series renamed upstream causes duplicate enrichment
export interface RenameDetection {
  isRenamed: boolean;
  previousTitle: string | null;
  newTitle: string;
  similarity: number;
}

export function detectSeriesRename(
  existingTitle: string,
  newTitle: string,
  alternativeTitles: string[]
): RenameDetection {
  const similarity = calculateTitleSimilarity(existingTitle, newTitle);
  
  if (similarity > 0.9) {
    return { isRenamed: false, previousTitle: null, newTitle, similarity };
  }

  for (const alt of alternativeTitles) {
    if (calculateTitleSimilarity(alt, newTitle) > 0.9) {
      return { isRenamed: false, previousTitle: null, newTitle, similarity };
    }
  }

  if (similarity > 0.6) {
    return { isRenamed: true, previousTitle: existingTitle, newTitle, similarity };
  }

  return { isRenamed: false, previousTitle: null, newTitle, similarity };
}

// Bug 109: Manual metadata override not versioned
// Bug 110: Manual override not protected from background overwrite
export interface ManualOverrideRecord {
  id: string;
  entityType: 'series' | 'library_entry';
  entityId: string;
  userId: string;
  previousData: Record<string, unknown>;
  overrideData: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date | null;
  version: number;
}

export function createManualOverride(
  entityType: 'series' | 'library_entry',
  entityId: string,
  userId: string,
  previousData: Record<string, unknown>,
  overrideData: Record<string, unknown>,
  expiresInDays: number = 30
): ManualOverrideRecord {
  return {
    id: crypto.randomUUID(),
    entityType,
    entityId,
    userId,
    previousData,
    overrideData,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000),
    version: 1
  };
}

export function isManualOverrideActive(override: ManualOverrideRecord): boolean {
  if (override.expiresAt === null) return true;
  return new Date() < override.expiresAt;
}

// Bug 111: Series cover URL not validated for availability
// Bug 112: Broken cover URLs cached permanently
export interface CoverUrlValidation {
  url: string;
  isValid: boolean;
  isAccessible: boolean | null;
  lastCheckedAt: Date | null;
  failureCount: number;
  nextCheckAt: Date;
}

export function validateCoverUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    
    const knownCdns = ['mangadex.org', 'uploads.mangadex.org', 'cover.mangadex.org'];
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    
    const isKnownCdn = knownCdns.some(cdn => parsed.hostname.includes(cdn));
    const hasImageExt = imageExtensions.some(ext => 
      parsed.pathname.toLowerCase().endsWith(ext)
    );
    
    return isKnownCdn || hasImageExt;
  } catch {
    return false;
  }
}

// Bug 113: Metadata timestamps not updated consistently
export interface MetadataTimestamps {
  createdAt: Date;
  updatedAt: Date;
  enrichedAt: Date | null;
  lastVerifiedAt: Date | null;
}

export function updateMetadataTimestamp(
  timestamps: MetadataTimestamps,
  action: 'update' | 'enrich' | 'verify'
): MetadataTimestamps {
  const now = new Date();
  
  switch (action) {
    case 'update':
      return { ...timestamps, updatedAt: now };
    case 'enrich':
      return { ...timestamps, updatedAt: now, enrichedAt: now };
    case 'verify':
      return { ...timestamps, lastVerifiedAt: now };
    default:
      return timestamps;
  }
}

// Bug 114: Metadata enrichment can partially succeed without rollback
export interface EnrichmentTransaction {
  id: string;
  status: 'pending' | 'committed' | 'rolled_back';
  operations: { table: string; operation: string; data: unknown }[];
  startedAt: Date;
  completedAt: Date | null;
}

// Bug 115: Multiple metadata sources not reconciled deterministically
export interface MetadataSourcePriority {
  source: string;
  priority: number;
  trustLevel: number;
}

export const METADATA_SOURCE_PRIORITIES: MetadataSourcePriority[] = [
  { source: 'USER_OVERRIDE', priority: 1, trustLevel: 1.0 },
  { source: 'CANONICAL', priority: 2, trustLevel: 0.95 },
  { source: 'mangadex', priority: 3, trustLevel: 0.9 },
  { source: 'INFERRED', priority: 4, trustLevel: 0.5 }
];

export function selectPreferredMetadataSource(
  sources: { source: string; data: Record<string, unknown> }[]
): { source: string; data: Record<string, unknown> } | null {
  if (sources.length === 0) return null;

  const sorted = [...sources].sort((a, b) => {
    const priorityA = METADATA_SOURCE_PRIORITIES.find(p => p.source === a.source)?.priority || 999;
    const priorityB = METADATA_SOURCE_PRIORITIES.find(p => p.source === b.source)?.priority || 999;
    return priorityA - priorityB;
  });

  return sorted[0];
}

// Bug 116: Metadata conflict resolution not defined
export interface MetadataConflict {
  field: string;
  values: { source: string; value: unknown }[];
  resolution: 'use_highest_priority' | 'merge' | 'manual_required';
  resolvedValue: unknown;
}

export function resolveMetadataConflict(
  field: string,
  values: { source: string; value: unknown }[]
): MetadataConflict {
  if (values.length <= 1) {
    return {
      field,
      values,
      resolution: 'use_highest_priority',
      resolvedValue: values[0]?.value
    };
  }

  const sorted = [...values].sort((a, b) => {
    const priorityA = METADATA_SOURCE_PRIORITIES.find(p => p.source === a.source)?.priority || 999;
    const priorityB = METADATA_SOURCE_PRIORITIES.find(p => p.source === b.source)?.priority || 999;
    return priorityA - priorityB;
  });

  if (field === 'alternative_titles' || field === 'genres' || field === 'tags') {
    const merged = new Set<string>();
    for (const { value } of values) {
      if (Array.isArray(value)) {
        for (const item of value) {
          merged.add(String(item));
        }
      }
    }
    return {
      field,
      values,
      resolution: 'merge',
      resolvedValue: [...merged]
    };
  }

  return {
    field,
    values,
    resolution: 'use_highest_priority',
    resolvedValue: sorted[0].value
  };
}

// Bug 117: Series status (ongoing/completed) can regress
export const STATUS_HIERARCHY = ['cancelled', 'hiatus', 'ongoing', 'completed'];

export function validateStatusTransition(
  currentStatus: string,
  newStatus: string
): { allowed: boolean; reason: string } {
  const currentIndex = STATUS_HIERARCHY.indexOf(currentStatus);
  const newIndex = STATUS_HIERARCHY.indexOf(newStatus);

  if (currentIndex === -1 || newIndex === -1) {
    return { allowed: true, reason: 'Unknown status, allowing transition' };
  }

  if (newIndex < currentIndex && currentStatus === 'completed') {
    return {
      allowed: false,
      reason: `Cannot regress from '${currentStatus}' to '${newStatus}'`
    };
  }

  return { allowed: true, reason: 'Valid status transition' };
}

// Bug 118: Metadata resolution ignores publication year drift
export function checkYearCompatibility(
  yearA: number | null | undefined,
  yearB: number | null | undefined
): { compatible: boolean; drift: number; needsReview: boolean } {
  if (!yearA || !yearB) {
    return { compatible: true, drift: 0, needsReview: false };
  }

  const drift = Math.abs(yearA - yearB);

  if (drift <= 1) {
    return { compatible: true, drift, needsReview: false };
  }

  if (drift <= 3) {
    return { compatible: true, drift, needsReview: true };
  }

  return { compatible: false, drift, needsReview: true };
}

// Bug 119: No checksum/hash on metadata payload
export function generateMetadataChecksum(metadata: Record<string, unknown>): string {
  const sortedKeys = Object.keys(metadata).sort();
  const normalized: Record<string, unknown> = {};
  
  for (const key of sortedKeys) {
    const value = metadata[key];
    if (value !== undefined && value !== null) {
      normalized[key] = value;
    }
  }
  
  return createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex')
    .substring(0, 16);
}

export function hasMetadataChanged(
  oldChecksum: string | null,
  newMetadata: Record<string, unknown>
): boolean {
  if (!oldChecksum) return true;
  return oldChecksum !== generateMetadataChecksum(newMetadata);
}

// Bug 120: Metadata fields lack max-length guards
export const METADATA_FIELD_LIMITS: Record<string, number> = {
  title: 500,
  description: 10000,
  cover_url: 2000,
  alternative_title: 500,
  genre: 50,
  tag: 50,
  external_link_key: 50,
  external_link_value: 500
};

export function validateMetadataFieldLength(
  field: string,
  value: string
): { valid: boolean; truncated: string } {
  const limit = METADATA_FIELD_LIMITS[field] || 1000;
  
  if (value.length <= limit) {
    return { valid: true, truncated: value };
  }
  
  return {
    valid: false,
    truncated: value.substring(0, limit)
  };
}

export function sanitizeMetadataFields(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(metadata)) {
    if (typeof value === 'string') {
      const limit = METADATA_FIELD_LIMITS[key] || 1000;
      sanitized[key] = value.substring(0, limit);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => {
        if (typeof item === 'string') {
          const limit = METADATA_FIELD_LIMITS[key] || 100;
          return item.substring(0, limit);
        }
        return item;
      });
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}
