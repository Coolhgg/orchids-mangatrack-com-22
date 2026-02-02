/**
 * MangaDex API Client - MangaTrack
 *
 * OPERATIONAL CONSTRAINTS:
 * - Respect robots.txt for every external host (mangadex.org, mangaupdates.com).
 * - Do not store or publicly serve copyrighted pages or images. For chapter images,
 *   store only `at-home` server URLs and serve them server-side only after checking
 *   licenses; do not mirror copyrighted content.
 * - Record `sourceAttribution` and `rawHtmlSnapshotPath` for any scraped or
 *   user-submitted link.
 * - Add UI label "Unverified source — user provided" for links from MangaUpdates
 *   or user paste, and require report/flag and trust scoring before automatic promotion.
 * - Add DMCA/terms/privacy pages before public link features are enabled in production.
 *
 * @see https://api.mangadex.org/docs/
 */

// TUNE: Adjust retry/backoff parameters here
const DEFAULT_RETRY_COUNT = 3;
const DEFAULT_TIMEOUT_MS = 20000;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 16000;

export interface MangaDexClientOptions {
  /** TUNE: Swap base URL for testing/staging (default: https://api.mangadex.org) */
  baseUrl?: string;
  /** Inject custom fetch implementation for testing */
  fetch?: typeof globalThis.fetch;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /** Request timeout in milliseconds (default: 20000) */
  timeoutMs?: number;
}

export interface LocalizedString {
  en?: string;
  [key: string]: string | undefined;
}

export interface MangaAttributes {
  title: LocalizedString;
  altTitles: LocalizedString[];
  description: LocalizedString;
  status: 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  year: number | null;
  contentRating: 'safe' | 'suggestive' | 'erotica';
  tags: Array<{
    id: string;
    type: 'tag';
    attributes: {
      name: LocalizedString;
      group: string;
    };
  }>;
  publicationDemographic: 'shounen' | 'shoujo' | 'seinen' | 'josei' | null;
  links: Record<string, string> | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChapterAttributes {
  title: string | null;
  volume: string | null;
  chapter: string | null;
  pages: number;
  translatedLanguage: string;
  uploader: string;
  externalUrl: string | null;
  publishAt: string;
  readableAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface Relationship {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}

export interface MangaEntity {
  id: string;
  type: 'manga';
  attributes: MangaAttributes;
  relationships: Relationship[];
}

export interface ChapterEntity {
  id: string;
  type: 'chapter';
  attributes: ChapterAttributes;
  relationships: Relationship[];
}

export interface CoverEntity {
  id: string;
  type: 'cover_art';
  attributes: {
    volume: string | null;
    fileName: string;
    description: string;
    locale: string;
    createdAt: string;
    updatedAt: string;
  };
  relationships: Relationship[];
}

export interface PaginatedResponse<T> {
  result: 'ok';
  response: 'collection';
  data: T[];
  limit: number;
  offset: number;
  total: number;
}

export interface SingleResponse<T> {
  result: 'ok';
  response: 'entity';
  data: T;
}



export interface FetchLatestChaptersOptions {
  /** Number of chapters to fetch (default: 50, max: 100) */
  limit?: number;
  /** Language codes to filter by (default: ['en']) */
  translatedLanguage?: string[];
  /** Include manga relationship data */
  includeManga?: boolean;
}

export interface MangaMetadata {
  id: string;
  title: string;
  altTitles: string[];
  description: string;
  status: string;
  year: number | null;
  contentRating: string;
  tags: string[];
  publicationDemographic: string | null;
  authors: string[];
  artists: string[];
  coverFileName: string | null;
  coverUrl: string | null;
  anilistId: string | null;
  myanimelistId: string | null;
}

export interface CoverResult {
  mangaId: string;
  coverId: string;
  fileName: string;
  volume: string | null;
  /** Constructed cover URL */
  url: string;
}

export class MangaDexError extends Error {
  constructor(
    message: string,
    public status?: number,
    public retryAfter?: number
  ) {
    super(message);
    this.name = 'MangaDexError';
  }
}

export class MangaDexRateLimitError extends MangaDexError {
  constructor(message = 'MangaDex Rate Limit exceeded', retryAfter?: number) {
    super(message, 429, retryAfter);
    this.name = 'MangaDexRateLimitError';
  }
}

export class MangaDexNetworkError extends MangaDexError {
  constructor(message = 'MangaDex Network Timeout/Connection Error') {
    super(message);
    this.name = 'MangaDexNetworkError';
  }
}

/**
 * MangaDex API Client with automatic retry, exponential backoff, and rate limit handling.
 *
 * @example
 * ```typescript
 * const client = new MangaDexClient({ baseUrl: 'https://api.mangadex.org' });
 * const chapters = await client.fetchLatestChapters({ limit: 30 });
 * ```
 */
export class MangaDexClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly maxRetries: number;
  private readonly timeoutMs: number;

  constructor(options: MangaDexClientOptions = {}) {
    // TUNE: Swap base URL here for testing/staging
    this.baseUrl = options.baseUrl ?? 'https://api.mangadex.org';
    this.fetchFn = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_RETRY_COUNT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Internal fetch wrapper with retry logic, exponential backoff, and rate limit handling.
   */
  private async fetchWithRetry<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await this.fetchFn(url, {
          ...options,
          signal: controller.signal,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'MangaTrack/1.0 (Node.js)',
            ...options.headers,
          },
        });

        clearTimeout(timeoutId);

        // Handle rate limiting with Retry-After header
        if (response.status === 429) {
          const retryAfterHeader = response.headers.get('Retry-After');
          const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 5;

          if (attempt === this.maxRetries - 1) {
            throw new MangaDexRateLimitError(
              `Rate limited after ${this.maxRetries} attempts`,
              retryAfter
            );
          }

          console.warn(
            `[MangaDex] Rate limited. Retry-After: ${retryAfter}s (attempt ${attempt + 1}/${this.maxRetries})`
          );
          await this.sleep(retryAfter * 1000);
          continue;
        }

        // Handle server errors with exponential backoff
        if (response.status >= 500) {
          if (attempt === this.maxRetries - 1) {
            throw new MangaDexError(
              `Server error ${response.status} after ${this.maxRetries} attempts`,
              response.status
            );
          }

          const backoff = this.calculateBackoff(attempt);
          console.warn(
            `[MangaDex] Server error ${response.status}. Retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`
          );
          await this.sleep(backoff);
          continue;
        }

        if (!response.ok) {
          const errorBody = await response.text().catch(() => 'Unknown error');
          throw new MangaDexError(
            `MangaDex API error: ${response.status} - ${errorBody}`,
            response.status
          );
        }

        return (await response.json()) as T;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error instanceof MangaDexError) {
          throw error;
        }

        lastError = error instanceof Error ? error : new Error(String(error));
        const isTimeout =
          lastError.name === 'AbortError' ||
          lastError.message.includes('abort');

        if (attempt === this.maxRetries - 1) {
          if (isTimeout) {
            throw new MangaDexNetworkError(
              `Request timed out after ${this.timeoutMs}ms (${this.maxRetries} attempts)`
            );
          }
          throw new MangaDexNetworkError(
            `Network error after ${this.maxRetries} attempts: ${lastError.message}`
          );
        }

        const backoff = this.calculateBackoff(attempt);
        console.warn(
          `[MangaDex] ${isTimeout ? 'Timeout' : 'Network error'}. Retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`
        );
        await this.sleep(backoff);
      }
    }

    throw lastError ?? new Error('Unexpected retry loop exit');
  }

  /**
   * Calculate exponential backoff with jitter.
   * TUNE: Adjust INITIAL_BACKOFF_MS and MAX_BACKOFF_MS at top of file.
   */
  private calculateBackoff(attempt: number): number {
    const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, MAX_BACKOFF_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Extract localized string value, preferring English.
   */
  private getLocalizedString(obj: LocalizedString | undefined): string {
    if (!obj) return '';
    return obj.en ?? Object.values(obj).find((v) => v) ?? '';
  }

  /**
   * Fetch latest chapters ordered by publishAt (descending).
   *
   * @param options - Fetch options
   * @returns Paginated chapter response with optional manga relationships
   *
   * @example
   * ```typescript
   * const result = await client.fetchLatestChapters({
   *   limit: 30,
   *   translatedLanguage: ['en'],
   *   includeManga: true
   * });
   * ```
   */
  async fetchLatestChapters(
    options: FetchLatestChaptersOptions = {}
  ): Promise<PaginatedResponse<ChapterEntity>> {
    const { limit = 50, translatedLanguage = ['en'], includeManga = true } = options;

    const params = new URLSearchParams();
    params.set('limit', Math.min(limit, 100).toString());
    params.set('order[publishAt]', 'desc');

    for (const lang of translatedLanguage) {
      params.append('translatedLanguage[]', lang);
    }

    if (includeManga) {
      params.append('includes[]', 'manga');
      params.append('includes[]', 'scanlation_group');
    }

    return this.fetchWithRetry<PaginatedResponse<ChapterEntity>>(
      `/chapter?${params.toString()}`
    );
  }

  /**
   * Fetch manga metadata by ID with author, artist, and cover_art relationships.
   *
   * @param mangaId - MangaDex manga UUID
   * @returns Parsed manga metadata with resolved relationships
   *
   * @example
   * ```typescript
   * const metadata = await client.fetchMangaMetadata('a96676e5-8ae2-425e-b549-7f15dd34a6d8');
   * console.log(metadata.title, metadata.authors);
   * ```
   */
  async fetchMangaMetadata(mangaId: string): Promise<MangaMetadata> {
    const params = new URLSearchParams();
    params.append('includes[]', 'author');
    params.append('includes[]', 'artist');
    params.append('includes[]', 'cover_art');

    const response = await this.fetchWithRetry<SingleResponse<MangaEntity>>(
      `/manga/${mangaId}?${params.toString()}`
    );

    const manga = response.data;
    const attrs = manga.attributes;

    const authors: string[] = [];
    const artists: string[] = [];
    let coverFileName: string | null = null;

    for (const rel of manga.relationships) {
      if (rel.type === 'author' && rel.attributes?.name) {
        authors.push(rel.attributes.name as string);
      }
      if (rel.type === 'artist' && rel.attributes?.name) {
        artists.push(rel.attributes.name as string);
      }
      if (rel.type === 'cover_art' && rel.attributes?.fileName) {
        coverFileName = rel.attributes.fileName as string;
      }
    }

    const links = attrs.links ?? {};

    return {
      id: manga.id,
      title: this.getLocalizedString(attrs.title),
      altTitles: attrs.altTitles.map((t) => this.getLocalizedString(t)),
      description: this.getLocalizedString(attrs.description),
      status: attrs.status,
      year: attrs.year,
      contentRating: attrs.contentRating,
      tags: attrs.tags.map((t) => this.getLocalizedString(t.attributes.name)),
      publicationDemographic: attrs.publicationDemographic,
      authors,
      artists,
      coverFileName,
      coverUrl: coverFileName
        ? `https://uploads.mangadex.org/covers/${manga.id}/${coverFileName}`
        : null,
      anilistId: links.al ?? null,
      myanimelistId: links.mal ?? null,
    };
  }

  /**
   * Fetch cover art for multiple manga IDs in a single batch request.
   *
   * @param mangaIds - Array of MangaDex manga UUIDs (max 100 per request)
   * @returns Array of cover results with constructed URLs
   *
   * @example
   * ```typescript
   * const covers = await client.fetchCovers(['uuid1', 'uuid2']);
   * for (const cover of covers) {
   *   console.log(cover.mangaId, cover.url);
   * }
   * ```
   */
  async fetchCovers(mangaIds: string[]): Promise<CoverResult[]> {
    if (mangaIds.length === 0) return [];

    const params = new URLSearchParams();
    params.set('limit', '100');

    for (const id of mangaIds.slice(0, 100)) {
      params.append('manga[]', id);
    }

    const response = await this.fetchWithRetry<PaginatedResponse<CoverEntity>>(
      `/cover?${params.toString()}`
    );

    const results: CoverResult[] = [];

    for (const cover of response.data) {
      const mangaRel = cover.relationships.find((r) => r.type === 'manga');
      if (!mangaRel) continue;

      results.push({
        mangaId: mangaRel.id,
        coverId: cover.id,
        fileName: cover.attributes.fileName,
        volume: cover.attributes.volume,
        url: `https://uploads.mangadex.org/covers/${mangaRel.id}/${cover.attributes.fileName}`,
      });
    }

    return results;
  }

}
