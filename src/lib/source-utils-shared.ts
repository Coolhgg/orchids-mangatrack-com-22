export interface Source {
  id: string;
  source_name: string;
  trust_score: number;
  [key: string]: any;
}

export interface ChapterSource {
  id: string;
  source_name: string;
  source_id: string;
  chapter_url: string;
  published_at: string | null;
  discovered_at: string;
  is_available?: boolean;
  trust_score?: number;
}

export interface SeriesSourcePreference {
  id: string;
  source_name: string;
  source_url?: string;
  chapter_count?: number;
  trust_score: number;
  source_status?: string;
}

export interface UserSourcePreferences {
  seriesPreference?: { source_name: string } | null;
  globalPriorities: Map<string, number>;
}

export interface SourceSelectionPreferences {
  preferredSourceSeries?: string | null;
  preferredSourcePriorities?: string[];
  preferredSourceGlobal?: string | null;
}

/**
 * Sorts sources based on the priority hierarchy:
 * 1. User Series Preference (highest)
 * 2. User Global Source Priority
 * 3. Source Trust Score (fallback)
 */
export function sortSourcesWithPreferences(
  sources: Source[],
  preferences: UserSourcePreferences
): Source[] {
  if (sources.length <= 1) return sources;

  const { seriesPreference, globalPriorities } = preferences;

  return [...sources].sort((a, b) => {
    // 1. Check Series Override
    if (seriesPreference) {
      if (a.source_name === seriesPreference.source_name) return -1;
      if (b.source_name === seriesPreference.source_name) return 1;
    }

    // 2. Check Global Priority (lower number = higher priority)
    const prioA = globalPriorities.get(a.source_name);
    const prioB = globalPriorities.get(b.source_name);

    if (prioA !== undefined && prioB !== undefined) {
      if (prioA !== prioB) return prioA - prioB;
    } else if (prioA !== undefined) {
      return -1;
    } else if (prioB !== undefined) {
      return 1;
    }

    // 3. Fallback to Trust Score
    return b.trust_score - a.trust_score;
  });
}

/**
 * Sorts sources based on the priority hierarchy:
 * 1. User Series Preference (highest)
 * 2. User Global Source Priority
 * 3. User Global Source Preference (legacy/specific)
 * 4. Source Trust Score (fallback)
 */
export function sortSourcesByPriority(
  sources: any[],
  preferences: SourceSelectionPreferences
): any[] {
  const { 
    preferredSourceSeries, 
    preferredSourcePriorities = [],
    preferredSourceGlobal 
  } = preferences;

  return [...sources].sort((a, b) => {
    // 1. Check Series Override
    if (preferredSourceSeries) {
      if (a.source_name === preferredSourceSeries) return -1;
      if (b.source_name === preferredSourceSeries) return 1;
    }

    // 2. Check Global Priorities (lower index = higher priority)
    const indexA = preferredSourcePriorities.indexOf(a.source_name);
    const indexB = preferredSourcePriorities.indexOf(b.source_name);

    if (indexA !== -1 && indexB !== -1) {
      if (indexA !== indexB) return indexA - indexB;
    } else if (indexA !== -1) {
      return -1;
    } else if (indexB !== -1) {
      return 1;
    }

    // 3. Check Global Override
    if (preferredSourceGlobal) {
      if (a.source_name === preferredSourceGlobal) return -1;
      if (b.source_name === preferredSourceGlobal) return 1;
    }

    // 4. Fallback to Trust Score
    return (b.trust_score || 0) - (a.trust_score || 0);
  });
}

export function isPreferredSource(
  sourceName: string,
  preferences: SourceSelectionPreferences
) {
  if (preferences.preferredSourceSeries === sourceName) {
    return { type: 'series', rank: 1 };
  }

  const rank = preferences.preferredSourcePriorities?.indexOf(sourceName);
  if (rank !== undefined && rank !== -1) {
    return { type: 'global', rank: rank + 1 };
  }

  if (preferences.preferredSourceGlobal === sourceName) {
    return { type: 'global_legacy', rank: 99 };
  }

  return { type: null, rank: null };
}

export function selectBestSource(
  sources: any[],
  seriesSources: any[],
  preferences: SourceSelectionPreferences
): { source: any | null; reason: 'none' | 'preferred_series' | 'priority_list' | 'preferred_global' | 'trust_score'; isFallback?: boolean } {
  // Guard: empty sources array
  if (!sources || sources.length === 0) {
    return { source: null, reason: 'none' };
  }

  // Filter out unavailable sources first
  const availableSources = sources.filter(s => s.is_available !== false);
  const sourcesToUse = availableSources.length > 0 ? availableSources : sources;

  // Guard: if filtering resulted in empty array (shouldn't happen but be safe)
  if (sourcesToUse.length === 0) {
    return { source: null, reason: 'none' };
  }

  // Reuse the robust sorting logic
  const sorted = sortSourcesByPriority(sourcesToUse, preferences);
  const best = sorted[0];

  // Guard: null safety check after sort
  if (!best) {
    return { source: null, reason: 'none' };
  }

  let reason: 'preferred_series' | 'priority_list' | 'preferred_global' | 'trust_score' = 'trust_score';
  let isFallback = false;
  
  if (preferences.preferredSourceSeries === best.source_name) {
    reason = 'preferred_series';
  } else if (preferences.preferredSourcePriorities?.includes(best.source_name)) {
    reason = 'priority_list';
  } else if (preferences.preferredSourceGlobal === best.source_name) {
    reason = 'preferred_global';
  } else {
    // Check if we fell back due to preference not matching
    if (preferences.preferredSourceSeries || 
        preferences.preferredSourceGlobal || 
        (preferences.preferredSourcePriorities && preferences.preferredSourcePriorities.length > 0)) {
      isFallback = true;
    }
  }

  return { source: best, reason, isFallback };
}
