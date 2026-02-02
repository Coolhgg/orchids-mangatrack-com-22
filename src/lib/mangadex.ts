import { getMangaDexHeaders, MANGADEX_API_BASE } from './config/mangadex';
import { mergeRelationships, mergeRelationshipsSingle } from './utils';
import { isMangaDexPlaceholder } from './cover-resolver';

export { getMangaDexHeaders, MANGADEX_API_BASE } from './config/mangadex';

// Re-export stats enrichment functions from the mangadex directory
export { enrichSingleSeriesWithStats, isStatsEnrichmentEnabled } from './mangadex/stats-enrichment';

export const MANGADEX_COVER_BASE = 'https://uploads.mangadex.org/covers';

export class MangaDexError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'MangaDexError';
  }
}

export class MangaDexRateLimitError extends MangaDexError {
  constructor(message = 'MangaDex Rate Limit exceeded') {
    super(message, 429);
    this.name = 'MangaDexRateLimitError';
  }
}

export class MangaDexCloudflareError extends MangaDexError {
  constructor(message = 'MangaDex blocked by Cloudflare') {
    super(message, 403);
    this.name = 'MangaDexCloudflareError';
  }
}

export class MangaDexNetworkError extends MangaDexError {
  constructor(message = 'MangaDex Network Timeout/Connection Error') {
    super(message);
    this.name = 'MangaDexNetworkError';
  }
}

export interface MangaDexCandidate {
  mangadex_id: string;
  title: string;
  alternative_titles: string[];
  description: string;
  status: string;
  type: string;
  genres: string[];
  content_rating?: string;
  cover_url?: string;
  source: 'mangadex';
  anilist_id?: string;
  myanimelist_id?: string;
  tags?: string[];
  publication_demographic?: string;
  year?: number;
  total_follows?: number;
}

export function getMangaDexCoverUrl(mangaId: string, fileName: string): string {
  return `${MANGADEX_COVER_BASE}/${mangaId}/${fileName}`;
}

function selectBestCoverFromRelationships(
  relationships: any[],
  mangaId: string
): string | undefined {
  const coverArts = relationships.filter(
    (r: any) => r.type === 'cover_art' && r.attributes?.fileName
  );

  if (coverArts.length === 0) return undefined;

  const validCovers = coverArts
    .map((rel: any) => {
      const fileName = rel.attributes.fileName;
      const url = getMangaDexCoverUrl(mangaId, fileName);
      const volume = rel.attributes.volume;
      const locale = rel.attributes.locale;
      return { url, fileName, volume, locale, rel };
    })
    .filter((c) => !isMangaDexPlaceholder(c.url));

  if (validCovers.length === 0) return undefined;

  // Try to find volume 1 in English if possible, then any volume 1
  const englishVolumeOne = validCovers.find(
    (c) => (c.volume === '1' || c.volume === '01') && c.locale === 'en'
  );
  if (englishVolumeOne) return englishVolumeOne.url;

  const volumeOneCover = validCovers.find(
    (c) => c.volume === '1' || c.volume === '01'
  );
  if (volumeOneCover) return volumeOneCover.url;

  const sortedByVolume = validCovers.sort((a, b) => {
    const volA = parseFloat(a.volume) || Infinity;
    const volB = parseFloat(b.volume) || Infinity;
    return volA - volB;
  });

  return sortedByVolume[0]?.url;
}

export async function getCoversBatch(mangaIds: string[]): Promise<Map<string, string>> {
  if (mangaIds.length === 0) return new Map();

  const url = new URL(`${MANGADEX_API_BASE}/cover`);
  mangaIds.forEach(id => url.searchParams.append('manga[]', id));
  url.searchParams.set('limit', '100'); // Maximum limit

  const response = await fetch(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (!response.ok) {
    throw new Error(`MangaDex Cover API error: ${response.status}`);
  }

  const data = await response.json();
  const coverMap = new Map<string, string>();

  // Group covers by manga ID to pick the best one
  const mangaCovers = new Map<string, any[]>();
  for (const cover of data.data) {
    const mangaRel = cover.relationships.find((r: any) => r.type === 'manga');
    if (mangaRel) {
      const existing = mangaCovers.get(mangaRel.id) ?? [];
      existing.push(cover);
      mangaCovers.set(mangaRel.id, existing);
    }
  }

  for (const [mangaId, covers] of mangaCovers.entries()) {
    const bestCover = selectBestCoverFromRelationships(covers, mangaId);
    if (bestCover) {
      coverMap.set(mangaId, bestCover);
    }
  }

  return coverMap;
}

async function fetchWithRetry(url: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (response.status === 429) {
        if (i === retries - 1) throw new MangaDexRateLimitError();
        const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
        console.warn(`[MangaDex] Rate limited. Retrying after ${retryAfter}s...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        continue;
      }

      if (response.status === 403 || response.headers.get('server')?.toLowerCase().includes('cloudflare')) {
        throw new MangaDexCloudflareError();
      }
      
      if (!response.ok && response.status >= 500) {
        console.warn(`[MangaDex] Server error ${response.status}. Retrying...`);
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
        continue;
      }
      
      return response;
    } catch (error) {
      if (error instanceof MangaDexError) throw error;
      
      lastError = error instanceof Error ? error : new Error(String(error));
      const isTimeout = lastError.name === 'AbortError' || lastError.message.includes('timeout');
      
      if (isTimeout && i === retries - 1) {
        throw new MangaDexNetworkError(`MangaDex request timed out after ${retries} attempts`);
      }

      console.warn(`[MangaDex] Fetch attempt ${i + 1} failed:`, lastError.message);
      if (i < retries - 1) {
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
      }
    }
  }
  
  throw lastError || new Error(`Failed to fetch after ${retries} retries`);
}

export async function searchMangaDex(searchTerm: string): Promise<MangaDexCandidate[]> {
  const url = new URL(`${MANGADEX_API_BASE}/manga`);
  url.searchParams.set('title', searchTerm);
  url.searchParams.set('limit', '32');

  url.searchParams.append('includes[]', 'cover_art');
  url.searchParams.append('contentRating[]', 'safe');
  url.searchParams.append('contentRating[]', 'suggestive');
  url.searchParams.append('contentRating[]', 'erotica');

  const response = await fetchWithRetry(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (!response.ok) {
    throw new MangaDexError(`MangaDex API error: ${response.status}`, response.status);
  }

  const data = await response.json();
  const mergedResults = mergeRelationships(data.data, data.included || []);
  
  const candidates: MangaDexCandidate[] = [];

  for (const manga of mergedResults) {
    const attrs = manga.attributes;
    const title = attrs.title.en || Object.values(attrs.title)[0] as string;
    const altTitles = attrs.altTitles.map((t: any) => Object.values(t)[0] as string);
    const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
    
    const coverUrl = selectBestCoverFromRelationships(manga.relationships, manga.id);

    const genres = attrs.tags
      .filter((tag: any) => tag.attributes.group === 'genre')
      .map((tag: any) => tag.attributes.name.en);

    const links = attrs.links || {};
    const anilistId = links.al;
    const malId = links.mal;

    candidates.push({
      mangadex_id: manga.id,
      title,
      alternative_titles: Array.from(new Set(altTitles)),
      description,
      status: attrs.status,
      type: attrs.publicationDemographic || 'unknown',
      genres,
      content_rating: attrs.contentRating,
      cover_url: coverUrl,
      source: 'mangadex',
      anilist_id: anilistId,
      myanimelist_id: malId,
      tags: attrs.tags.map((tag: any) => tag.attributes.name.en),
      publication_demographic: attrs.publicationDemographic,
      year: attrs.year,
    });
  }

  return candidates;
}

export async function getPopularManga(limit: number, offset: number): Promise<MangaDexCandidate[]> {
  const url = new URL(`${MANGADEX_API_BASE}/manga`);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());
  url.searchParams.set('order[followedCount]', 'desc');
  url.searchParams.append('includes[]', 'cover_art');

  const response = await fetchWithRetry(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (!response.ok) {
    throw new MangaDexError(`MangaDex API error: ${response.status}`, response.status);
  }

  const data = await response.json();
  const mergedResults = mergeRelationships(data.data, data.included || []);
  
  const candidates: MangaDexCandidate[] = [];

  for (const manga of mergedResults) {
    const attrs = manga.attributes;
    const title = attrs.title.en || Object.values(attrs.title)[0] as string;
    const altTitles = attrs.altTitles.map((t: any) => Object.values(t)[0] as string);
    const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
    
    const coverUrl = selectBestCoverFromRelationships(manga.relationships, manga.id);

    const genres = attrs.tags
      .filter((tag: any) => tag.attributes.group === 'genre')
      .map((tag: any) => tag.attributes.name.en);

    const links = attrs.links || {};

    candidates.push({
      mangadex_id: manga.id,
      title,
      alternative_titles: Array.from(new Set(altTitles)),
      description,
      status: attrs.status,
      type: attrs.publicationDemographic || 'unknown',
      genres,
      content_rating: attrs.contentRating,
      cover_url: coverUrl,
      source: 'mangadex',
      anilist_id: links.al,
      myanimelist_id: links.mal,
      tags: attrs.tags.map((tag: any) => tag.attributes.name.en),
      publication_demographic: attrs.publicationDemographic,
      year: attrs.year,
    });
  }

  return candidates;
}

export async function getMangaById(mangaId: string): Promise<MangaDexCandidate> {
  const url = new URL(`${MANGADEX_API_BASE}/manga/${mangaId}`);
  url.searchParams.append('includes[]', 'cover_art');

  const response = await fetchWithRetry(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (response.status === 429) {
    throw new Error('MangaDex Rate Limit exceeded');
  }
  if (response.status === 404) {
    throw new Error(`MangaDex manga not found: ${mangaId}`);
  }
  if (!response.ok) {
    throw new Error(`MangaDex API error: ${response.status}`);
  }

  const data = await response.json();
  const manga = mergeRelationshipsSingle(data.data, data.included || []);
  
  const attrs = manga.attributes;
  const title = attrs.title.en || Object.values(attrs.title)[0] as string;
  const altTitles = attrs.altTitles.map((t: any) => Object.values(t)[0] as string);
  const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
  
  const coverUrl = selectBestCoverFromRelationships(manga.relationships, manga.id);

  const genres = attrs.tags
    .filter((tag: any) => tag.attributes.group === 'genre')
    .map((tag: any) => tag.attributes.name.en);

  const links = attrs.links || {};

  return {
    mangadex_id: manga.id,
    title,
    alternative_titles: Array.from(new Set(altTitles)),
    description,
    status: attrs.status,
    type: attrs.publicationDemographic || 'unknown',
    genres,
    content_rating: attrs.contentRating,
    cover_url: coverUrl,
    source: 'mangadex',
    anilist_id: links.al,
    myanimelist_id: links.mal,
    tags: attrs.tags.map((tag: any) => tag.attributes.name.en),
    publication_demographic: attrs.publicationDemographic,
    year: attrs.year,
  };
}
