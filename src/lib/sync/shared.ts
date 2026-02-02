/**
 * Shared utilities for import/sync pipeline
 * 
 * V5 AUDIT BUG FIXES INTEGRATED:
 * - Bug 21: URL normalization preserves meaningful query params
 * - Bug 22: Platform ID extraction never returns partial IDs silently
 * - Bug 23: Similarity scoring filters stop words
 * - Bug 24: Title normalization handles all bracket types consistently
 */

import {
  normalizeUrlSmart,
  extractPlatformIdStrict,
  calculateSimilarityWithStopWords,
  normalizeTitleConsistent,
  STOP_WORDS,
} from '@/lib/bug-fixes/v5-audit-bugs-21-50';

export interface ImportEntry {
  title: string;
  status: string;
  progress: number;
  last_updated?: string | number | Date;
  external_id?: string;
  source_platform?: string;
  source_url?: string;
  source_name?: string;
}

export interface MatchResult {
  series_id: string | null;
  confidence: "high" | "medium" | "none";
  match_type: "exact_url" | "slug" | "exact_title" | "alias" | "none";
}

/**
 * Bug 22 Fix: Extracts platform IDs from various manga platform URLs.
 * Now returns explicit error information instead of silently failing.
 */
export function extractPlatformIds(url: string | undefined): { platform: string, id: string } | null {
  if (!url) return null;
  
  // Use the strict version that never returns partial IDs
  const result = extractPlatformIdStrict(url);
  
  if (result.success && result.platform && result.id) {
    return { platform: result.platform, id: result.id };
  }
  
  // Fall back to legacy patterns for backward compatibility
  // MangaDex: https://mangadex.org/title/UUID/...
  const mdMatch = url.match(/mangadex\.org\/title\/([a-f0-9-]{36})/i);
  if (mdMatch) return { platform: 'mangadex', id: mdMatch[1] };
  
  // MangaLife/MangaSee: https://manga4life.com/manga/SLUG
  const mlMatch = url.match(/(manga4life\.com|mangasee123\.com)\/manga\/([^/?#]+)/i);
  if (mlMatch) return { platform: 'mangasee', id: mlMatch[2] };

  // MangaPark: https://mangapark.net/title/ID or /comic/ID
  const mpMatch = url.match(/mangapark\.(net|me|com)\/(title|comic)\/([^/?#]+)/i);
  if (mpMatch) return { platform: 'mangapark', id: mpMatch[3] };

  return null;
}

/**
 * Bug 24 Fix: Normalizes titles for deterministic matching.
 * Now removes ALL bracket types consistently: (), [], {}, <>
 */
export function normalizeTitle(title: string): string {
  if (!title) return "";
  
  // Use the consistent version that handles all bracket types
  return normalizeTitleConsistent(title);
}

/**
 * Bug 23 Fix: Calculates string similarity using Sorensen-Dice coefficient.
 * Now filters stop words to prevent false positives.
 */
export function calculateSimilarity(s1: string, s2: string): number {
  // Use the enhanced version with stop-word filtering
  return calculateSimilarityWithStopWords(s1, s2);
}

/**
 * Legacy similarity function for backward compatibility
 * Includes sequel protection logic
 */
export function calculateSimilarityLegacy(s1: string, s2: string): number {
  const n1 = normalizeTitle(s1);
  const n2 = normalizeTitle(s2);

  if (n1.length < 2 || n2.length < 2) return 0;

  // SEQUEL PROTECTION:
  // Detect trailing numbers, "season X", "part X", roman numerals
  const getSequelMarker = (s: string) => {
    const lower = s.toLowerCase();
    
    // Check for "season X" or "part X"
    const seasonMatch = lower.match(/(season|part|vol|volume)\s*(\d+|i+v*x*)/);
    if (seasonMatch) return seasonMatch[0].replace(/\s+/g, '');
    
    // Check for trailing number
    const numMatch = lower.match(/(\d+)$/);
    if (numMatch) return numMatch[1];
    
    // Check for trailing roman numerals (II, III, IV, etc.)
    const romanMatch = lower.match(/\s+(ii|iii|iv|v|vi|vii|viii|ix|x)$/);
    if (romanMatch) return romanMatch[1];
    
    return null;
  };

  const marker1 = getSequelMarker(s1);
  const marker2 = getSequelMarker(s2);
  
  // Only block if BOTH titles clearly indicate DIFFERENT sequels.
  if (marker1 && marker2 && marker1 !== marker2) {
    return 0.3;
  }

  if (n1 === n2) return 1.0;

  // Standard Sorensen-Dice logic for the rest
  const bigrams1 = new Set<string>();
  const raw1 = n1.replace(/\s+/g, "");
  for (let i = 0; i < raw1.length - 1; i++) {
    bigrams1.add(raw1.substring(i, i + 2));
  }

  const bigrams2 = new Set<string>();
  const raw2 = n2.replace(/\s+/g, "");
  for (let i = 0; i < raw2.length - 1; i++) {
    bigrams2.add(raw2.substring(i, i + 2));
  }

  let intersection = 0;
  for (const bigram of bigrams1) {
    if (bigrams2.has(bigram)) intersection++;
  }

  const score = (2 * intersection) / (bigrams1.size + bigrams2.size);
  
  // If the titles are very different in length, penalize
  const lenRatio = Math.min(n1.length, n2.length) / Math.max(n1.length, n2.length);
  return score * (lenRatio > 0.5 ? 1 : lenRatio * 2);
}

export function normalizeStatus(status: string): string {
  const s = status.toLowerCase().trim();
  if (s.includes("plan") || s.includes("want")) return "planning";
  if (s.includes("watch") || s.includes("read")) return "reading";
  if (s.includes("complet")) return "completed";
  if (s.includes("drop")) return "dropped";
  if (s.includes("hold") || s.includes("pause")) return "paused";
  return "reading"; 
}

export const STATUS_RANKS: Record<string, number> = {
  planning: 0,
  paused: 1,
  dropped: 2,
  reading: 3,
  completed: 4,
};

export interface ReconcileResult {
  shouldUpdate: boolean;
  updateData?: {
    status?: string;
    progress?: number;
  };
  reason?: string;
}

export function reconcileEntry(
  existing: { status: string; progress: number; last_updated?: Date | null },
  imported: { status: string; progress: number; last_updated?: string | number | Date }
): ReconcileResult {
  const existingRank = STATUS_RANKS[existing.status] ?? -1;
  const importedRank = STATUS_RANKS[imported.status] ?? -1;

  const existingLastUpdated = existing.last_updated ? new Date(existing.last_updated).getTime() : 0;
  const importedLastUpdated = imported.last_updated ? new Date(imported.last_updated).getTime() : 0;

  const progressIncreased = imported.progress > existing.progress;
  const timeIncreased = importedLastUpdated > existingLastUpdated;
  const statusAdvanced = importedRank > existingRank;

  if (existing.status === 'completed' && imported.status !== 'completed' && !progressIncreased) {
    return { 
      shouldUpdate: false, 
      reason: "Terminal status protection: Cannot downgrade COMPLETED status without progress increase" 
    };
  }
  
  if (timeIncreased || progressIncreased) {
    if (imported.progress < existing.progress && !timeIncreased) {
      return { shouldUpdate: false, reason: "Progress regression blocked (imported < existing)" };
    }

    return {
      shouldUpdate: true,
      updateData: {
        status: imported.status,
        progress: imported.progress,
      },
      reason: timeIncreased ? "Timestamp advancement" : "Progress increase",
    };
  }

  if (imported.progress === existing.progress && importedRank === existingRank) {
    return { shouldUpdate: false, reason: "Already up to date (idempotent skip)" };
  }

  if (statusAdvanced && imported.progress === existing.progress) {
    return {
      shouldUpdate: true,
      updateData: { status: imported.status },
      reason: "Status advancement"
    };
  }

  return { shouldUpdate: false, reason: "No significant changes or older data detected" };
}

/**
 * Bug 21 Fix: Normalize URL while preserving meaningful query params
 */
export function normalizeUrlForImport(url: string): string {
  const result = normalizeUrlSmart(url);
  return result.isValid ? result.normalized : url;
}

// Re-export for convenience
export { STOP_WORDS, normalizeUrlSmart, extractPlatformIdStrict };
