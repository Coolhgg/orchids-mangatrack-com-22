export const MANGADEX_UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Extracts a MangaDex UUID from a string (ID or URL)
 * @param input The string to extract from
 * @returns The UUID if found, or null
 */
export function extractMangaDexId(input: string): string | null {
  if (!input) return null;
  const cleanInput = input.trim();

  // If it's already a UUID, return it
  if (MANGADEX_UUID_REGEX.test(cleanInput)) {
    return cleanInput;
  }

  // Try to parse as URL
  try {
    const urlString = cleanInput.startsWith('http') ? cleanInput : `https://${cleanInput}`;
    const url = new URL(urlString);
    
    if (url.hostname.includes('mangadex.org')) {
      const pathParts = url.pathname.split('/').filter(Boolean);
      
      // Strategy 1: Find UUID directly in any path part
      const uuidPart = pathParts.find(p => MANGADEX_UUID_REGEX.test(p));
      if (uuidPart) return uuidPart;

      // Strategy 2: Look for title/manga followed by a potential ID (which might be a slug)
      const targetIndex = pathParts.findIndex(p => p === 'title' || p === 'manga');
      if (targetIndex !== -1 && pathParts[targetIndex + 1]) {
        return pathParts[targetIndex + 1];
      }
    }
  } catch (e) {
    // Not a valid URL, or other parsing error
  }

  return null;
}

/**
 * Validates if a string is a valid MangaDex ID format
 * Accepts:
 * - Standard UUIDs (e.g., 12345678-1234-1234-1234-123456789012)
 * - Legacy numeric IDs (e.g., 12345)
 * - Internal prefixed IDs (e.g., md-some-slug)
 * 
 * @param id The ID to validate
 * @returns true if valid, false otherwise
 */
export function isValidMangaDexId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  
  const cleanId = id.trim();
  if (cleanId.length === 0 || cleanId.length > 255) return false;

  // Standard UUID format (most common)
  if (MANGADEX_UUID_REGEX.test(cleanId)) return true;

  // Legacy numeric IDs
  if (/^\d+$/.test(cleanId)) return true;

  // Internal prefixed IDs (md-slug-format)
  if (/^md-[a-zA-Z0-9_-]+$/i.test(cleanId)) return true;

  return false;
}

/**
 * Calculates exponential backoff delay with random jitter
 * @param attempt Current attempt number (0-indexed)
 * @param baseDelay Base delay in milliseconds (default 30s)
 * @param maxDelay Maximum delay in milliseconds (default 1h)
 * @returns Delay in milliseconds
 */
export function calculateBackoffWithJitter(
  attempt: number,
  baseDelay = 30000,
  maxDelay = 3600000
): number {
  // Exponential: 30s, 60s, 120s, 240s...
  const exponentialDelay = Math.pow(2, attempt) * baseDelay;
  
  // Jitter: adds 0-100% of baseDelay as randomness to prevent "thundering herd"
  const jitter = Math.random() * baseDelay;
  
  return Math.min(exponentialDelay + jitter, maxDelay);
}
