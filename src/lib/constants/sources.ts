// Currently supported reading sources (only MangaDex has a working scraper)
export const READING_SOURCE_HOSTS = [
  'mangadex.org',
];

// Planned sources for future implementation (not shown in UI)
export const PLANNED_SOURCE_HOSTS = [
  'mangapark.net',
  'mangapark.me', 
  'mangapark.com',
  'mangasee123.com',
  'manga4life.com',
  'comick.io',
  'comick.app',
];

export const CANONICAL_HOSTS = [
  'mangadex.org',
  'anilist.co',
  'myanimelist.net',
];

export function getSourceFromUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace('www.', '');
    if (host.includes('mangadex.org')) return 'MangaDex';
    if (host.includes('anilist.co')) return 'AniList';
    if (host.includes('myanimelist.net')) return 'MyAnimeList';
    // Return null for unsupported sources (no working scraper)
    return null;
  } catch {
    return null;
  }
}

export function isSourceUrlSupported(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    return READING_SOURCE_HOSTS.some(host => hostname.includes(host));
  } catch {
    return false;
  }
}
