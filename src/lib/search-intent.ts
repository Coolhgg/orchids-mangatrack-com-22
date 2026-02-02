
/**
 * Rules:
 * - lowercase
 * - trim whitespace
 * - remove punctuation
 * - normalize unicode
 * - collapse repeated spaces
 */
export function normalize(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove diacritics
    .replace(/[^\p{L}\p{N}\s]/gu, '') // remove punctuation (keep letters and numbers)
    .replace(/\s+/g, ' ') // collapse repeated spaces
    .trim();
}

/**
 * Calculates Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  if (a.length < b.length) [a, b] = [b, a];
  if (b.length === 0) return a.length;

  const arr = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cur = a[i - 1] === b[j - 1] ? arr[j - 1] : Math.min(arr[j - 1], arr[j], prev) + 1;
      arr[j - 1] = prev;
      prev = cur;
    }
    arr[b.length] = prev;
  }
  return arr[b.length];
}

/**
 * Calculates similarity ratio between two strings (0 to 1).
 */
function getSimilarity(a: string, b: string): number {
  if (a.length === 0 || b.length === 0) return 0;
  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length);
  return 1 - distance / maxLength;
}

export type SearchIntent = 'EXACT_TITLE' | 'PARTIAL_TITLE' | 'KEYWORD_EXPLORATION' | 'NOISE';

export interface IntentContext {
  intent: SearchIntent;
  confidence: number;
}

const GENERIC_KEYWORDS = new Set([
  'manga', 'manhwa', 'manhua', 'webtoon', 'novel', 'isekai', 'fantasy', 
  'action', 'romance', 'adventure', 'magic', 'school', 'system', 'rebirth',
  'reincarnation', 'level', 'player', 'dungeon', 'monster', 'sword'
]);

/**
 * Detects user query intent based on the query string and local results context.
 */
export function detectSearchIntent(query: string, localResults: any[] = []): SearchIntent {
  const normalizedQuery = normalize(query);
  
  // 1) NOISE / INVALID
  // Query length < 3 (strict for external) or only symbols/numbers
  const queryWords = normalizedQuery.split(' ').filter(w => w.length > 0);
  const totalLength = normalizedQuery.length;
  
  if (totalLength < 3 || !/[a-z0-9]/i.test(normalizedQuery) || queryWords.length === 0) {
    return 'NOISE';
  }

  // Prevent repetitive character abuse (e.g., "aaaaaaa") - allow "86" or "3-1"
  if (/^(.)\1+$/.test(normalizedQuery) && totalLength > 3) {
    return 'NOISE';
  }

  // 2) EXACT_TITLE
  // Query length >= 3 and closely matches a known title or altTitle
  if (normalizedQuery.length >= 3) {
    const hasExactMatch = localResults.some(res => {
      const titles = [res.title, ...(res.alternative_titles || [])];
      return titles.some(t => getSimilarity(normalize(t), normalizedQuery) >= 0.9);
    });
    
    if (hasExactMatch) return 'EXACT_TITLE';
  }

  // 3) PARTIAL_TITLE
  // Query is substring of known titles or fuzzy similarity 0.75-0.9
  // Also trigger for queries that LOOK like partial titles (3+ chars, not generic keywords)
  const hasPartialMatch = localResults.some(res => {
    const titles = [res.title, ...(res.alternative_titles || [])];
    return titles.some(t => {
      const normT = normalize(t);
      // Check if query is a prefix/substring of a title
      return normT.includes(normalizedQuery) || 
             normalizedQuery.includes(normT) || 
             normT.startsWith(normalizedQuery) ||
             getSimilarity(normT, normalizedQuery) >= 0.6; // Lowered threshold for better partial matching
    });
  });

  if (hasPartialMatch) return 'PARTIAL_TITLE';

  // 4) KEYWORD_EXPLORATION
  // Generic terms or high match count across unrelated titles
  const words = normalizedQuery.split(' ');
  const isGeneric = words.some(word => GENERIC_KEYWORDS.has(word));
  
  if (isGeneric || localResults.length > 10) {
    return 'KEYWORD_EXPLORATION';
  }

  // For queries that look like partial titles (3+ meaningful chars), treat as PARTIAL_TITLE
  // This ensures external search is triggered for queries like "one piec" even with no local results
  if (normalizedQuery.length >= 3 && !isGeneric) {
    return 'PARTIAL_TITLE';
  }

  // Default to KEYWORD_EXPLORATION for external discovery
  return 'KEYWORD_EXPLORATION';
}
