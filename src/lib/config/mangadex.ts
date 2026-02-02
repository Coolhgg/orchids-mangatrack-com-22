/**
 * MangaDex Configuration Utility
 * Securely manages server-side credentials and headers.
 */

const MANGADEX_CLIENT_ID = process.env.MANGADEX_CLIENT_ID;
const MANGADEX_CLIENT_SECRET = process.env.MANGADEX_CLIENT_SECRET;
export const MANGADEX_API_BASE = process.env.MANGADEX_API_BASE || 'https://api.mangadex.org';

/**
 * Generates headers for MangaDex API requests.
 * Attaches Authorization if client credentials are provided.
 */
export function getMangaDexHeaders() {
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Referer': 'https://mangadex.org',
    'Origin': 'https://mangadex.org',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
    'DNT': '1',
  };

  // Only attach Authorization if both credentials exist
  if (MANGADEX_CLIENT_ID && MANGADEX_CLIENT_SECRET) {
    // Basic Auth for client credentials (as per MangaDex Personal Client docs)
    const auth = Buffer.from(`${MANGADEX_CLIENT_ID}:${MANGADEX_CLIENT_SECRET}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  return headers;
}
