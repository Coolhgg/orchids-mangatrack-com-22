/**
 * MangaUpdates API V1 Client - MangaTrack
 *
 * Use official API V1 — do not scrape.
 * @see https://api.mangaupdates.com/v1
 *
 * OPERATIONAL CONSTRAINTS:
 * - Use only official MangaUpdates API endpoints (no HTML scraping).
 * - Rate limit: ~1 req/sec by default (configurable via requestsPerSecond).
 * - Respect Retry-After on 429 and implement exponential backoff for 5xx.
 * - Cache results for 24h by default (use Redis or DB cache).
 * - Credit MangaUpdates in your application per their terms.
 *
 * API KEY NOTE:
 * - Currently, reads are public and do not require authentication.
 * - If MangaUpdates introduces API keys in the future, add:
 *   `Authorization: Bearer <token>` header to all requests.
 * - Token obtained via PUT /account/login with username/password.
 *
 * CACHING RECOMMENDATIONS:
 * - Series metadata: Cache for 24h (rarely changes).
 * - Latest releases: Cache for 15-30 minutes (changes frequently).
 * - Search results: Cache for 1h with query as key.
 * - Use Redis TTL or Prisma with expiresAt field.
 */

import axios, {
  AxiosInstance,
  AxiosError,
  InternalAxiosRequestConfig,
} from 'axios';
import PQueue from 'p-queue';

// ============================================================================
// Configuration Constants - TUNE these as needed
// ============================================================================

const DEFAULT_BASE_URL = 'https://api.mangaupdates.com/v1';
const DEFAULT_REQUESTS_PER_SECOND = 1;
const DEFAULT_TIMEOUT_MS = 20000;
const DEFAULT_MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 32000;

// ============================================================================
// Type Definitions
// ============================================================================

export interface MangaUpdatesClientOptions {
  /** Base URL for API (default: https://api.mangaupdates.com/v1) */
  baseUrl?: string;
  /** Requests per second rate limit (default: 1) */
  requestsPerSecond?: number;
  /** Request timeout in milliseconds (default: 20000) */
  timeoutMs?: number;
  /** Maximum retry attempts (default: 3) */
  maxRetries?: number;
  /**
   * API Bearer token (optional).
   * Currently reads are public; add token here if/when required.
   */
  apiToken?: string;
}

/** Genre object from MangaUpdates */
export interface Genre {
  genre: string;
}

/** Category/tag object from MangaUpdates */
export interface Category {
  series_id: number;
  category: string;
  votes: number;
  votes_plus: number;
  votes_minus: number;
  added_by: number;
}

/** Author/artist reference */
export interface Author {
  name: string;
  author_id: number;
  type: string;
}

/** Publisher reference */
export interface Publisher {
  publisher_name: string;
  publisher_id: number;
  type: string;
  notes: string;
}

/** Rank information */
export interface RankInfo {
  position: {
    week: number | null;
    month: number | null;
    three_months: number | null;
    six_months: number | null;
    year: number | null;
  };
  old_position: {
    week: number | null;
    month: number | null;
    three_months: number | null;
    six_months: number | null;
    year: number | null;
  };
  lists: {
    reading: number;
    wish: number;
    complete: number;
    unfinished: number;
    custom: number;
  };
}

/** Release group information */
export interface ReleaseGroup {
  name: string;
  group_id: number;
  url?: string;
}

/** Image URL structure */
export interface ImageInfo {
  url: {
    original: string | null;
    thumb: string | null;
  };
  height?: number | null;
  width?: number | null;
}

/** Last updated timestamp info */
export interface LastUpdatedInfo {
  timestamp: number;
  as_rfc3339: string;
  as_string: string;
}

/**
 * Raw release record from the API (nested in `record` field).
 */
export interface RawReleaseRecord {
  id: number;
  title: string;
  volume: string | null;
  chapter: string | null;
  groups: ReleaseGroup[];
  release_date: string;
}

/**
 * Raw release result item from GET /releases/days.
 * The actual release data is nested in the `record` field.
 */
export interface RawReleaseResultItem {
  record: RawReleaseRecord;
  metadata: {
    series: {
      series_id: number;
      title: string;
      url: string;
      last_updated: LastUpdatedInfo;
      admin: {
        approved: boolean;
      };
    };
    user_list: {
      list_type: string | null;
      list_icon: string | null;
      status: {
        volume: number | null;
        chapter: number | null;
      };
    };
    user_genre_highlights: string[];
    user_genre_filters: string[];
    user_group_filters: string[];
    type_filter: string | null;
  };
}

/**
 * Flattened release entry for easier consumption.
 * Represents a single chapter/volume release.
 */
export interface ReleaseEntry {
  id: number;
  title: string;
  volume: string | null;
  chapter: string | null;
  groups: ReleaseGroup[];
  release_date: string;
  /** Series metadata included with the release */
  series: {
    series_id: number;
    title: string;
    url: string;
  };
}

/**
 * Full series metadata from GET /series/{id}.
 */
export interface SeriesData {
  series_id: number;
  title: string;
  url: string;
  associated: Array<{ title: string }>;
  description: string;
  image: ImageInfo;
  type: string;
  year: string | null;
  bayesian_rating: number | null;
  rating_votes: number;
  genres: Genre[];
  categories: Category[];
  latest_chapter: number | null;
  forum_id: number | null;
  status: string;
  licensed: boolean;
  completed: boolean;
  anime: {
    start: string | null;
    end: string | null;
  };
  related_series: Array<{
    relation_id: number;
    relation_type: string;
    related_series_id: number;
    related_series_name: string;
  }>;
  authors: Author[];
  publishers: Publisher[];
  publications: Array<{
    publication_name: string;
    publisher_name: string;
    publisher_id: number;
  }>;
  recommendations: Array<{
    series_name: string;
    series_id: number;
    weight: number;
  }>;
  category_recommendations: Array<{
    series_name: string;
    series_id: number;
    weight: number;
  }>;
  rank: RankInfo;
  last_updated: LastUpdatedInfo;
}

/**
 * Series record data within search results.
 * Contains the full series data nested in the `record` field.
 */
export interface SeriesRecord {
  series_id: number;
  title: string;
  url: string;
  description: string;
  image: ImageInfo;
  type: string;
  year: string | null;
  bayesian_rating: number | null;
  rating_votes: number;
  genres: Genre[];
  last_updated: LastUpdatedInfo;
}

/**
 * Raw search result item from POST /series/search.
 * The actual series data is nested in the `record` field.
 */
export interface RawSearchResultItem {
  record: SeriesRecord;
  hit_title: string;
  metadata: {
    user_list: {
      list_type: string | null;
      list_icon: string | null;
      status: {
        volume: number | null;
        chapter: number | null;
      };
    };
    user_genre_highlights: string[];
  };
}

/**
 * Flattened search result for easier consumption.
 * Fields extracted from the nested `record` structure.
 */
export interface SearchResult {
  series_id: number;
  title: string;
  url: string;
  description: string;
  image: ImageInfo;
  type: string;
  year: string | null;
  bayesian_rating: number | null;
  rating_votes: number;
  genres: Genre[];
  last_updated: LastUpdatedInfo;
  /** The matched title (may differ from main title due to aliases) */
  hit_title: string;
}

/** Raw paginated response for releases/days */
export interface RawReleasesResponse {
  total_hits: number;
  page: number;
  per_page: number;
  results: RawReleaseResultItem[];
}

/** Raw paginated response for series search */
export interface RawSearchResponse {
  total_hits: number;
  page: number;
  per_page: number;
  results: RawSearchResultItem[];
}

/** Rate limit status information */
export interface RateLimitStatus {
  requestsPerSecond: number;
  queueSize: number;
  isPaused: boolean;
}

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Base error class for MangaUpdates API errors.
 */
export class MangaUpdatesError extends Error {
  constructor(
    message: string,
    public status?: number,
    public reason?: string
  ) {
    super(message);
    this.name = 'MangaUpdatesError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Thrown when API rate limit (429) is exceeded.
 * Check retryAfter for seconds to wait.
 */
export class RateLimitError extends MangaUpdatesError {
  constructor(
    message = 'MangaUpdates rate limit exceeded',
    public retryAfter: number = 5
  ) {
    super(message, 429);
    this.name = 'RateLimitError';
  }
}

/**
 * Thrown for network/connection errors.
 */
export class NetworkError extends MangaUpdatesError {
  constructor(message = 'Network error connecting to MangaUpdates') {
    super(message);
    this.name = 'NetworkError';
  }
}

/**
 * Thrown when a resource is not found (404).
 */
export class NotFoundError extends MangaUpdatesError {
  constructor(message = 'Resource not found') {
    super(message, 404);
    this.name = 'NotFoundError';
  }
}

// ============================================================================
// MangaUpdates Client
// ============================================================================

/**
 * MangaUpdates API V1 Client with rate limiting, retry logic, and typed responses.
 *
 * Features:
 * - Automatic rate limiting via p-queue (configurable req/sec)
 * - Exponential backoff with jitter for 5xx errors
 * - Retry-After header handling for 429 responses
 * - Typed TypeScript interfaces for all responses
 * - Queuing mechanism for batch operations
 *
 * @example
 * ```typescript
 * const client = new MangaUpdatesClient({ requestsPerSecond: 1 });
 *
 * // Fetch latest releases
 * const releases = await client.pollLatestReleases({ days: 7, page: 1 });
 *
 * // Queue multiple metadata fetches (executed sequentially)
 * const seriesIds = [123, 456, 789];
 * const metadata = await Promise.all(
 *   seriesIds.map(id => client.fetchSeriesMetadata(id))
 * );
 * ```
 */
export class MangaUpdatesClient {
  private readonly axios: AxiosInstance;
  private readonly queue: PQueue;
  private readonly maxRetries: number;
  private readonly requestsPerSecond: number;

  constructor(options: MangaUpdatesClientOptions = {}) {
    const {
      baseUrl = DEFAULT_BASE_URL,
      requestsPerSecond = DEFAULT_REQUESTS_PER_SECOND,
      timeoutMs = DEFAULT_TIMEOUT_MS,
      maxRetries = DEFAULT_MAX_RETRIES,
      apiToken,
    } = options;

    this.requestsPerSecond = requestsPerSecond;
    this.maxRetries = maxRetries;

    // Initialize rate-limiting queue using p-queue
    // intervalCap: number of requests per interval
    // interval: time window in ms (1000ms = 1 second)
    this.queue = new PQueue({
      intervalCap: requestsPerSecond,
      interval: 1000,
      carryoverConcurrencyCount: true,
    });

    // Initialize axios instance
    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: timeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'MangaTrack/1.0 (Node.js)',
        // API KEY: Add Authorization header here when required
        ...(apiToken && { Authorization: `Bearer ${apiToken}` }),
      },
    });

    // Add request interceptor for logging (optional, can be removed in production)
    this.axios.interceptors.request.use(
      (config: InternalAxiosRequestConfig) => {
        // DEBUG: Uncomment to log requests
        // console.log(`[MangaUpdates] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      }
    );
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Calculate exponential backoff with jitter.
   */
  private calculateBackoff(attempt: number): number {
    const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
    const jitter = Math.random() * 1000;
    return Math.min(exponential + jitter, MAX_BACKOFF_MS);
  }

  /**
   * Sleep for specified milliseconds.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Execute a request with retry logic, rate limiting, and error handling.
   * All requests go through the p-queue for rate limiting.
   */
  private async executeWithRetry<T>(
    requestFn: () => Promise<T>
  ): Promise<T> {
    return this.queue.add(async () => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt < this.maxRetries; attempt++) {
        try {
          return await requestFn();
        } catch (error) {
          if (axios.isAxiosError(error)) {
            const axiosError = error as AxiosError<{ reason?: string }>;
            const status = axiosError.response?.status;
            const reason = axiosError.response?.data?.reason;

            // Handle 404 - Not Found (don't retry)
            if (status === 404) {
              throw new NotFoundError(
                reason ?? `Resource not found: ${axiosError.config?.url}`
              );
            }

            // Handle 429 - Rate Limit
            if (status === 429 || status === 412) {
              const retryAfter = parseInt(
                axiosError.response?.headers?.['retry-after'] ?? '5',
                10
              );

              if (attempt === this.maxRetries - 1) {
                throw new RateLimitError(
                  `Rate limited after ${this.maxRetries} attempts`,
                  retryAfter
                );
              }

              console.warn(
                `[MangaUpdates] Rate limited (${status}). Waiting ${retryAfter}s (attempt ${attempt + 1}/${this.maxRetries})`
              );
              await this.sleep(retryAfter * 1000);
              continue;
            }

            // Handle 5xx - Server Errors (retry with backoff)
            if (status && status >= 500) {
              if (attempt === this.maxRetries - 1) {
                throw new MangaUpdatesError(
                  `Server error ${status} after ${this.maxRetries} attempts`,
                  status,
                  reason
                );
              }

              const backoff = this.calculateBackoff(attempt);
              console.warn(
                `[MangaUpdates] Server error ${status}. Retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`
              );
              await this.sleep(backoff);
              continue;
            }

            // Handle 4xx - Client Errors (don't retry except rate limits)
            if (status && status >= 400 && status < 500) {
              throw new MangaUpdatesError(
                `API error: ${status} - ${reason ?? axiosError.message}`,
                status,
                reason
              );
            }

            // Handle network/timeout errors
            if (axiosError.code === 'ECONNABORTED' || axiosError.code === 'ETIMEDOUT') {
              lastError = new NetworkError(
                `Request timeout after ${this.axios.defaults.timeout}ms`
              );
            } else if (!axiosError.response) {
              lastError = new NetworkError(
                `Network error: ${axiosError.message}`
              );
            } else {
              lastError = new MangaUpdatesError(
                axiosError.message,
                status
              );
            }
          } else {
            lastError = error instanceof Error ? error : new Error(String(error));
          }

          // Retry with backoff for network errors
          if (attempt < this.maxRetries - 1) {
            const backoff = this.calculateBackoff(attempt);
            console.warn(
              `[MangaUpdates] ${lastError.message}. Retrying in ${backoff}ms (attempt ${attempt + 1}/${this.maxRetries})`
            );
            await this.sleep(backoff);
          }
        }
      }

      throw lastError ?? new Error('Unexpected retry loop exit');
    }) as Promise<T>;
  }

  /**
   * Flatten raw release result item to a more usable format.
   */
  private flattenReleaseResult(item: RawReleaseResultItem): ReleaseEntry {
    return {
      id: item.record.id,
      title: item.record.title,
      volume: item.record.volume,
      chapter: item.record.chapter,
      groups: item.record.groups,
      release_date: item.record.release_date,
      series: {
        series_id: item.metadata.series.series_id,
        title: item.metadata.series.title,
        url: item.metadata.series.url,
      },
    };
  }

  /**
   * Flatten raw search result item to a more usable format.
   */
  private flattenSearchResult(item: RawSearchResultItem): SearchResult {
    return {
      series_id: item.record.series_id,
      title: item.record.title,
      url: item.record.url,
      description: item.record.description,
      image: item.record.image,
      type: item.record.type,
      year: item.record.year,
      bayesian_rating: item.record.bayesian_rating,
      rating_votes: item.record.rating_votes,
      genres: item.record.genres,
      last_updated: item.record.last_updated,
      hit_title: item.hit_title,
    };
  }

  // ==========================================================================
  // Public API Methods
  // ==========================================================================

  /**
   * Poll latest releases from the past N days.
   *
   * CACHING: Cache results for 15-30 minutes (releases update frequently).
   * Use Redis: `SET mu:releases:days:${days}:page:${page} ${JSON.stringify(result)} EX 900`
   *
   * @param options - Polling options
   * @param options.days - Number of days to look back (default: 7)
   * @param options.page - Page number for pagination (default: 1)
   * @returns Array of release entries
   *
   * @example
   * ```typescript
   * const releases = await client.pollLatestReleases({ days: 7, page: 1 });
   * for (const release of releases) {
   *   console.log(`${release.title} - Ch.${release.chapter}`);
   * }
   * ```
   */
  async pollLatestReleases(
    options: { days?: number; page?: number } = {}
  ): Promise<ReleaseEntry[]> {
    const { days = 7, page = 1 } = options;

    const response = await this.executeWithRetry(() =>
      this.axios.get<RawReleasesResponse>('/releases/days', {
        params: {
          page,
          include_metadata: true,
        },
      })
    );

    // Flatten the nested record structure
    const releases = response.data.results.map((item) =>
      this.flattenReleaseResult(item)
    );

    // Filter to releases within the specified days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return releases.filter((release) => {
      const releaseDate = new Date(release.release_date);
      return releaseDate >= cutoffDate;
    });
  }

  /**
   * Fetch full series metadata by ID.
   *
   * CACHING: Cache results for 24 hours (series metadata changes rarely).
   * Use Redis: `SET mu:series:${seriesId} ${JSON.stringify(result)} EX 86400`
   * Or Prisma: Store with `cachedAt` field, query where `cachedAt > NOW() - 24h`.
   *
   * @param seriesId - MangaUpdates series ID (numeric)
   * @returns Full series metadata
   * @throws {NotFoundError} If series does not exist
   *
   * @example
   * ```typescript
   * const series = await client.fetchSeriesMetadata(123456);
   * console.log(series.title, series.bayesian_rating);
   * ```
   */
  async fetchSeriesMetadata(seriesId: number): Promise<SeriesData> {
    const response = await this.executeWithRetry(() =>
      this.axios.get<SeriesData>(`/series/${seriesId}`)
    );

    return response.data;
  }

  /**
   * Search for series by title.
   *
   * CACHING: Cache results for 1 hour with query as key.
   * Use Redis: `SET mu:search:${encodeURIComponent(title)}:page:${page} ${JSON.stringify(result)} EX 3600`
   *
   * Note: MangaUpdates uses POST for search (not GET with query params).
   * The API returns results in a nested `record` structure which this method flattens.
   *
   * @param title - Search query string
   * @param page - Page number (default: 1)
   * @returns Array of flattened search results
   *
   * @example
   * ```typescript
   * const results = await client.searchSeries('One Piece');
   * for (const series of results) {
   *   console.log(`${series.title} (ID: ${series.series_id})`);
   * }
   * ```
   */
  async searchSeries(
    title: string,
    page: number = 1
  ): Promise<SearchResult[]> {
    const response = await this.executeWithRetry(() =>
      this.axios.post<RawSearchResponse>('/series/search', {
        search: title,
        page,
        perpage: 50,
      })
    );

    // Flatten the nested record structure for easier consumption
    return response.data.results.map((item) => this.flattenSearchResult(item));
  }

  /**
   * Get current rate limit status and queue information.
   *
   * @returns Rate limit status object
   *
   * @example
   * ```typescript
   * const status = client.getRateLimitStatus();
   * console.log(`Queue size: ${status.queueSize}, Rate: ${status.requestsPerSecond}/sec`);
   * ```
   */
  getRateLimitStatus(): RateLimitStatus {
    return {
      requestsPerSecond: this.requestsPerSecond,
      queueSize: this.queue.size,
      isPaused: this.queue.isPaused,
    };
  }

  /**
   * Pause the request queue (useful for backpressure handling).
   */
  pauseQueue(): void {
    this.queue.pause();
  }

  /**
   * Resume the request queue.
   */
  resumeQueue(): void {
    this.queue.start();
  }

  /**
   * Clear pending requests from the queue.
   */
  clearQueue(): void {
    this.queue.clear();
  }

  /**
   * Wait for all queued requests to complete.
   */
  async waitForIdle(): Promise<void> {
    await this.queue.onIdle();
  }
}
