/**
 * Normalizes a title to prevent duplicates due to unicode differences (BUG 36)
 */
export function normalizeTitle(title: string): string {
  if (!title) return '';
  
  return title
    .normalize('NFKC') // Normalize unicode characters
    .toLowerCase()
    .replace(/[^\w\s]/gi, '') // Remove non-word characters for comparison
    .trim();
}

/**
 * Compares two titles for equality after normalization
 */
export function isSameTitle(titleA: string, titleB: string): boolean {
  return normalizeTitle(titleA) === normalizeTitle(titleB);
}
