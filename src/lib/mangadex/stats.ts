/**
 * MangaDex Statistics Client - MangaTrack
 *
 * Batch-fetches manga statistics (follows, ratings) from MangaDex API with
 * rate limiting, retry logic, and exponential backoff.
 *
 * @see https://api.mangadex.org/docs/swagger.html#/Statistics/get-statistics-manga
 *
 * @example
 * ```typescript
 * import { MangaDexStatsClient, type MangaStats } from '@/lib/mangadex/stats';
 *
 * const statsClient = new MangaDexStatsClient();
 *
 * // Fetch stats for multiple manga (handles batching automatically)
 * const ids = ['manga-uuid-1', 'manga-uuid-2', 'manga-uuid-3'];
 * const statsMap = await statsClient.getStatisticsBatch(ids);
 *
 * for (const [id, stats] of statsMap) {
 *   console.log(`${id}: ${stats.follows} follows, rating: ${stats.rating}`);
 * }
 * ```
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import PQueue from 'p-queue';

const DEFAULT_BASE_URL = 'https://api.mangadex.org';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_REQUESTS_PER_SECOND = 1;

const MAX_RETRY_ATTEMPTS = 4;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 32000;
const REQUEST_TIMEOUT_MS = 10000;
const MAX_CONSECUTIVE_429S = 3;

export type MangaStats = {
  id: string;
  follows: number;
  rating: number | null;
};

export interface MangaDexStatsClientOptions {
  baseUrl?: string;
  batchSize?: number;
  rps?: number;
}

export class RateLimitError extends Error {
  public readonly retryAfter?: number;
  public readonly consecutive429s: number;

  constructor(message: string, retryAfter?: number, consecutive429s: number = 0) {
    super(message);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.consecutive429s = consecutive429s;
  }
}

export class StatsClientError extends Error {
  public readonly statusCode?: number;
  public readonly attempts: number;

  constructor(message: string, statusCode?: number, attempts: number = 0) {
    super(message);
    this.name = 'StatsClientError';
    this.statusCode = statusCode;
    this.attempts = attempts;
  }
}

/**
 * Split an array into chunks of specified size.
 */
export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error('Chunk size must be positive');
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

function calculateBackoff(attempt: number): number {
  const exponential = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = Math.random() * 500;
  return Math.min(exponential + jitter, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface MangaDexStatsResponse {
  result: 'ok';
  statistics: Record<
    string,
    {
      follows: number;
      rating: {
        average: number | null;
        bayesian: number | null;
        distribution: Record<string, number>;
      } | null;
      comments?: {
        thread: string;
        repliesCount: number;
      };
    }
  >;
}

/**
 * MangaDex Statistics Client with batch support, rate limiting, and retry logic.
 *
 * @example
 * ```typescript
 * const client = new MangaDexStatsClient();
 * const stats = await client.getStatisticsBatch(['uuid1', 'uuid2']);
 *
 * for (const [id, stat] of stats) {
 *   console.log(`Manga ${id}: ${stat.follows} follows`);
 * }
 * ```
 */
export class MangaDexStatsClient {
  private readonly baseUrl: string;
  private readonly batchSize: number;
  private readonly axios: AxiosInstance;
  private readonly queue: PQueue;

  constructor(options: MangaDexStatsClientOptions = {}) {
    this.baseUrl =
      options.baseUrl ??
      process.env.MANGADEX_API_BASE ??
      DEFAULT_BASE_URL;

    this.batchSize =
      options.batchSize ??
      (process.env.MANGADEX_STATS_BATCH
        ? parseInt(process.env.MANGADEX_STATS_BATCH, 10)
        : DEFAULT_BATCH_SIZE);

    const rps =
      options.rps ??
      (process.env.MANGADEX_REQUESTS_PER_SECOND
        ? parseInt(process.env.MANGADEX_REQUESTS_PER_SECOND, 10)
        : DEFAULT_REQUESTS_PER_SECOND);

    this.queue = new PQueue({
      interval: Math.ceil(1000 / rps),
      intervalCap: 1,
      concurrency: 1,
    });

    this.axios = axios.create({
      baseURL: this.baseUrl,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'MangaTrack/1.0 (statistics-client)',
      },
    });
  }

  /**
   * Fetch statistics for multiple manga IDs with automatic batching and rate limiting.
   */
  async getStatisticsBatch(ids: string[]): Promise<Map<string, MangaStats>> {
    if (ids.length === 0) {
      return new Map();
    }

    const uniqueIds = Array.from(new Set(ids));
    const batches = chunkArray(uniqueIds, this.batchSize);
    const results = new Map<string, MangaStats>();

    const batchPromises = batches.map((batch, index) =>
      this.queue.add(async () => {
        console.log(
          `[MangaDexStats] Processing batch ${index + 1}/${batches.length} (${batch.length} IDs)`
        );
        return this.fetchBatchWithRetry(batch);
      })
    );

    const batchResults = await Promise.all(batchPromises);

    for (const batchResult of batchResults) {
      if (batchResult) {
        batchResult.forEach((stats, id) => {
          results.set(id, stats);
        });
      }
    }

    console.log(
      `[MangaDexStats] Fetched stats for ${results.size}/${uniqueIds.length} manga`
    );

    return results;
  }

  private async fetchBatchWithRetry(
    ids: string[]
  ): Promise<Map<string, MangaStats>> {
    let consecutive429s = 0;

    for (let attempt = 0; attempt < MAX_RETRY_ATTEMPTS; attempt++) {
      try {
        return await this.fetchBatch(ids);
      } catch (error) {
        const isAxiosError = axios.isAxiosError(error);
        const status = isAxiosError ? error.response?.status : undefined;

        if (status === 429) {
          consecutive429s++;

          if (consecutive429s >= MAX_CONSECUTIVE_429S) {
            const retryAfter = this.parseRetryAfter(error as AxiosError);
            throw new RateLimitError(
              `Rate limit exceeded after ${consecutive429s} consecutive 429 responses`,
              retryAfter,
              consecutive429s
            );
          }

          const retryAfter = this.parseRetryAfter(error as AxiosError);
          const waitTime = retryAfter ? retryAfter * 1000 : calculateBackoff(attempt);

          console.warn(
            `[MangaDexStats] Rate limited (429). Waiting ${Math.round(waitTime / 1000)}s before retry ` +
              `(attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS}, consecutive: ${consecutive429s})`
          );

          await sleep(waitTime);
          continue;
        }

        consecutive429s = 0;

        if (status && status >= 500) {
          if (attempt === MAX_RETRY_ATTEMPTS - 1) {
            throw new StatsClientError(
              `Server error ${status} after ${MAX_RETRY_ATTEMPTS} attempts`,
              status,
              attempt + 1
            );
          }

          const backoff = calculateBackoff(attempt);
          console.warn(
            `[MangaDexStats] Server error ${status}. Retrying in ${Math.round(backoff / 1000)}s ` +
              `(attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`
          );

          await sleep(backoff);
          continue;
        }

        if (isAxiosError && !error.response) {
          if (attempt === MAX_RETRY_ATTEMPTS - 1) {
            throw new StatsClientError(
              `Network error after ${MAX_RETRY_ATTEMPTS} attempts: ${error.message}`,
              undefined,
              attempt + 1
            );
          }

          const backoff = calculateBackoff(attempt);
          console.warn(
            `[MangaDexStats] Network error. Retrying in ${Math.round(backoff / 1000)}s ` +
              `(attempt ${attempt + 1}/${MAX_RETRY_ATTEMPTS})`
          );

          await sleep(backoff);
          continue;
        }

        throw new StatsClientError(
          `MangaDex API error: ${status ?? 'unknown'} - ${error instanceof Error ? error.message : String(error)}`,
          status,
          attempt + 1
        );
      }
    }

    throw new StatsClientError(
      'Unexpected retry loop exit',
      undefined,
      MAX_RETRY_ATTEMPTS
    );
  }

  private async fetchBatch(ids: string[]): Promise<Map<string, MangaStats>> {
    const params = new URLSearchParams();
    for (const id of ids) {
      params.append('manga[]', id);
    }

    const response = await this.axios.get<MangaDexStatsResponse>(
      `/statistics/manga?${params.toString()}`
    );

    const results = new Map<string, MangaStats>();

    if (response.data.result === 'ok' && response.data.statistics) {
      for (const [id, stats] of Object.entries(response.data.statistics)) {
        results.set(id, {
          id,
          follows: stats.follows ?? 0,
          rating: stats.rating?.bayesian ?? null,
        });
      }
    }

    return results;
  }

  private parseRetryAfter(error: AxiosError): number | undefined {
    const retryAfterHeader = error.response?.headers?.['retry-after'];
    if (typeof retryAfterHeader === 'string') {
      const parsed = parseInt(retryAfterHeader, 10);
      if (!isNaN(parsed) && parsed > 0) {
        return parsed;
      }
    }
    return undefined;
  }
}

export const mangadexStatsClient = new MangaDexStatsClient();
