import { initDNS } from '../dns-init';
import { extractMangaDexId } from '../mangadex-utils';

// Initialize DNS servers (Google DNS fallback) to fix ENOTFOUND issues
initDNS();

export interface ScrapedChapter {
  chapterNumber: number;
  chapterLabel?: string;
  chapterTitle?: string;
  chapterUrl: string;
  sourceChapterId?: string;
  publishedAt?: Date;
}

export interface ScrapedSeries {
  sourceId: string;
  title: string;
  chapters: ScrapedChapter[];
  metadataSource?: 'CANONICAL' | 'USER_OVERRIDE' | 'INFERRED';
  metadataConfidence?: number;
}

export interface ScrapedLatestUpdate {
  sourceId: string;
  title: string;
  chapterNumber: number;
  chapterUrl: string;
}

export interface Scraper {
  scrapeSeries(sourceId: string, targetChapters?: number[]): Promise<ScrapedSeries>;
  scrapeLatestUpdates?(): Promise<ScrapedLatestUpdate[]>;
}

// Allowed hostnames for supported sources (MangaDex only)
export const ALLOWED_HOSTS = new Set([
  'mangadex.org',
  'api.mangadex.org',
]);

// Planned hosts for future implementation
export const PLANNED_HOSTS = new Set([
  'mangapark.net',
  'mangapark.me',
  'mangapark.com',
  'mangasee123.com',
  'manga4life.com',
  'manganato.com',
  'hiperdex.com',
  'bato.to',
  'mangakakalot.com',
]);

// SECURITY: Validate source ID format to prevent injection
const SOURCE_ID_REGEX = /^[a-zA-Z0-9._-]{1,500}$/;

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.2; rv:121.0) Gecko/20100101 Firefox/121.0',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export class PlaceholderScraper implements Scraper {
  constructor(private readonly sourceName: string) {}

  async scrapeSeries(sourceId: string, targetChapters?: number[]): Promise<ScrapedSeries> {
    console.warn(`[${this.sourceName}] Using placeholder scraper for ${sourceId}`);
    
    // Throw a specific error for placeholders so the pipeline can handle it
    throw new ScraperError(
      `${this.sourceName} integration is currently in development (Placeholder).`,
      this.sourceName.toLowerCase(),
      false,
      'PROVIDER_NOT_IMPLEMENTED'
    );
  }
}

export function validateSourceId(sourceId: string): boolean {
  return SOURCE_ID_REGEX.test(sourceId);
}

export function validateSourceUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return ALLOWED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export class ScraperError extends Error {
  constructor(
    public readonly message: string,
    public readonly source: string,
    public readonly isRetryable: boolean = true,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}

export class SelectorNotFoundError extends ScraperError {
  constructor(source: string, selector: string) {
    super(`Selector not found: ${selector}`, source, false, 'SELECTOR_NOT_FOUND');
    this.name = 'SelectorNotFoundError';
  }
}

export class ProxyBlockedError extends ScraperError {
  constructor(source: string) {
    super('Request blocked by proxy/WAF', source, true, 'PROXY_BLOCKED');
    this.name = 'ProxyBlockedError';
  }
}

export class RateLimitError extends ScraperError {
  constructor(source: string) {
    super('Rate limit exceeded', source, true, 'RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

// P1-8 FIX: DNS Error class for network issues that should trigger retry
export class DnsError extends ScraperError {
  constructor(source: string, hostname: string) {
    super(`DNS resolution failed for ${hostname}`, source, true, 'DNS_ERROR');
    this.name = 'DnsError';
  }
}

export class CircuitBreakerOpenError extends ScraperError {
  constructor(source: string) {
    super(`Circuit breaker is open for source: ${source}`, source, false, 'CIRCUIT_OPEN');
    this.name = 'CircuitBreakerOpenError';
  }
}

// P1-8 FIX: Check if error is a DNS/network error that should be retried
function isDnsOrNetworkError(error: unknown): boolean {
  if (!error) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    message.includes('enotfound') ||
    message.includes('getaddrinfo') ||
    message.includes('dns') ||
    message.includes('econnrefused') ||
    message.includes('econnreset') ||
    message.includes('etimedout') ||
    message.includes('network') ||
    message.includes('socket hang up')
  );
}

class CircuitBreaker {
  private failures = 0;
  private lastFailureAt: number | null = null;
  private readonly threshold = 5;
  private readonly resetTimeout = 60000; // 1 minute

  isOpen(): boolean {
    if (this.failures >= this.threshold) {
      if (this.lastFailureAt && Date.now() - this.lastFailureAt > this.resetTimeout) {
        this.failures = 0;
        return false;
      }
      return true;
    }
    return false;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailureAt = Date.now();
  }

  recordSuccess(): void {
    this.failures = 0;
    this.lastFailureAt = null;
  }

  reset(): void {
    this.failures = 0;
    this.lastFailureAt = null;
  }
}

const breakers: Record<string, CircuitBreaker> = {};

export function resetAllScraperBreakers(): void {
  Object.values(breakers).forEach(breaker => breaker.reset());
}

function getBreaker(source: string): CircuitBreaker {
  if (!breakers[source]) {
    breakers[source] = new CircuitBreaker();
  }
  return breakers[source];
}

// CONTENT POLICY: Only allowed content ratings (pornographic is BLOCKED platform-wide)
const ALLOWED_CONTENT_RATINGS_PARAM = 'contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica';

export class MangaDexScraper implements Scraper {
  private readonly BASE_URL = 'https://api.mangadex.org';
  // P2-12 FIX: Configurable timeout with reasonable default
  private readonly TIMEOUT_MS = parseInt(process.env.MANGADEX_TIMEOUT_MS || '30000', 10);
  private readonly UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  private async resolveSlugToUuid(slug: string): Promise<string | null> {
    try {
      console.log(`[MangaDex] Attempting to resolve slug: ${slug}`);
      
      const slugParts = slug.split('-');
      const titlesToTry: string[] = [slugParts.join(' ')];
      
      const suffixMatch = slug.match(/-[a-z0-9]{5}$/);
      if (suffixMatch) {
        titlesToTry.push(slug.replace(/-[a-z0-9]{5}$/, '').split('-').join(' '));
      }

      if (slugParts.length > 4) {
        titlesToTry.push(slugParts.slice(0, 4).join(' '));
      }
      if (slugParts.length > 6) {
        titlesToTry.push(slugParts.slice(0, 6).join(' '));
      }

      const uniqueTitles = [...new Set(titlesToTry)];

      for (const title of uniqueTitles) {
        console.log(`[MangaDex] Searching for title: "${title}"`);
        // CONTENT POLICY: Only fetch allowed content ratings (exclude pornographic)
        const response = await fetch(
          `${this.BASE_URL}/manga?title=${encodeURIComponent(title)}&limit=10&${ALLOWED_CONTENT_RATINGS_PARAM}`,
          { signal: AbortSignal.timeout(this.TIMEOUT_MS) }
        );

        if (!response.ok) continue;
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
          const bestMatch = data.data[0];
          console.log(`[MangaDex] Found match for "${title}": ${bestMatch.id}`);
          return bestMatch.id;
        }
      }
      
      return null;
    } catch (error) {
      console.error(`[MangaDex] Slug resolution failed for ${slug}:`, error);
      return null;
    }
  }

  async scrapeSeries(sourceId: string, targetChapters?: number[]): Promise<ScrapedSeries> {
    const breaker = getBreaker('mangadex');
    if (breaker.isOpen()) {
      throw new CircuitBreakerOpenError('mangadex');
    }

    let cleanSourceId = sourceId.trim();

    // v2.2.0 - Improved UUID extraction for MangaDex URLs
    const extractedId = extractMangaDexId(cleanSourceId);
    if (extractedId) {
      cleanSourceId = extractedId;
    }

    if (!cleanSourceId) {
      throw new ScraperError('Empty MangaDex ID', 'mangadex', false);
    }

    const isUuid = this.UUID_REGEX.test(cleanSourceId);
    const isLegacy = /^\d+$/.test(cleanSourceId);
    const isPrefixed = /^md-[a-zA-Z0-9._-]+$/i.test(cleanSourceId);
    const isLocalSlug = /^local-[a-zA-Z0-9._-]+$/i.test(cleanSourceId);
    
    // Check if it's a raw slug
    const isRawSlug = !isUuid && !isLegacy && !isPrefixed && !isLocalSlug && cleanSourceId.length > 2;
    
    console.log(`[MangaDex] Processing: ${cleanSourceId} (isUuid: ${isUuid}, isRawSlug: ${isRawSlug})`);
    
    // CENTRALIZED RATE LIMITING: Stay within 5 req/s across all worker threads
    const { sourceRateLimiter } = await import('../rate-limiter');
    const acquired = await sourceRateLimiter.acquireToken('mangadex', 60000);
    if (!acquired) {
      throw new RateLimitError('mangadex');
    }
    
    let targetId = cleanSourceId;

    // P1-8 FIX: Enhanced fetchWithRetry that properly handles DNS errors
    const fetchWithRetry = async (url: string, options: any = {}, retries = 3): Promise<Response> => {
      let lastError: any;
      for (let i = 0; i < retries; i++) {
        try {
          const response = await fetch(url, {
            ...options,
            signal: AbortSignal.timeout(this.TIMEOUT_MS)
          });
          
          if (response.status === 429) {
            if (i === retries - 1) {
              throw new RateLimitError('mangadex');
            }
            const retryAfter = parseInt(response.headers.get('Retry-After') || '5');
            console.warn(`[MangaDex] Rate limited. Retrying after ${retryAfter}s...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            continue;
          }
          
          if (!response.ok && response.status >= 500) {
            console.warn(`[MangaDex] Server error ${response.status}. Retrying...`);
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
            continue;
          }
          
          return response;
        } catch (error) {
          lastError = error;
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // P1-8 FIX: Check if this is a DNS/network error that should trigger retry
          if (isDnsOrNetworkError(error)) {
            console.warn(`[MangaDex] DNS/Network error on attempt ${i + 1}: ${errorMessage}. Retrying...`);
            // Longer delay for DNS errors to allow resolution
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 2000 + Math.random() * 1000));
            continue;
          }
          
          console.warn(`[MangaDex] Fetch attempt ${i + 1} failed:`, errorMessage);
          if (i < retries - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000 + Math.random() * 1000));
          }
        }
      }
      
      // P1-8 FIX: If final error was DNS-related, throw DnsError instead of generic error
      if (isDnsOrNetworkError(lastError)) {
        throw new DnsError('mangadex', 'api.mangadex.org');
      }
      
      throw lastError || new Error(`Failed to fetch after ${retries} retries`);
    };

    try {
      if (!isUuid && (isLocalSlug || isRawSlug)) {
        console.log(`[MangaDex] Resolving slug to UUID: ${cleanSourceId}`);
        const slug = isLocalSlug ? cleanSourceId.replace('local-', '') : cleanSourceId;
        const resolvedId = await this.resolveSlugToUuid(slug);
        if (!resolvedId) {
          throw new ScraperError(`Could not resolve MangaDex slug to UUID: ${cleanSourceId}`, 'mangadex', false);
        }
        console.log(`[MangaDex] Resolved ${cleanSourceId} to ${resolvedId}`);
        targetId = resolvedId;
      }

      const mangaResponse = await fetchWithRetry(`${this.BASE_URL}/manga/${targetId}`);

      if (mangaResponse.status === 404) {
        throw new ScraperError(`MangaDex manga not found: ${cleanSourceId}`, 'mangadex', false);
      }

      if (!mangaResponse.ok) {
        if (mangaResponse.status === 403 || mangaResponse.status === 401) {
          throw new ProxyBlockedError('mangadex');
        }
        throw new Error(`Failed to fetch manga details: ${mangaResponse.statusText}`);
      }

      const mangaData = await mangaResponse.json();
      const title = mangaData.data.attributes.title.en || 
                    Object.values(mangaData.data.attributes.title)[0] as string;

      const chapters: ScrapedChapter[] = [];
      let offset = 0;
      const limit = 500;
      let total = 0;

      const targetSet = targetChapters ? new Set(targetChapters) : null;
      let foundTargetsCount = 0;

      do {
        console.log(`[MangaDex] Fetching chapters for ${targetId} (offset: ${offset}, total: ${total}, found: ${foundTargetsCount}/${targetChapters?.length ?? 'all'})`);
        // CONTENT POLICY: Only fetch allowed content ratings (exclude pornographic)
        const chaptersResponse = await fetchWithRetry(
          `${this.BASE_URL}/manga/${targetId}/feed?limit=${limit}&offset=${offset}&translatedLanguage[]=en&order[chapter]=asc&${ALLOWED_CONTENT_RATINGS_PARAM}`
        );

        if (!chaptersResponse.ok) {
          throw new Error(`Failed to fetch chapters batch: ${chaptersResponse.statusText}`);
        }

        const chaptersData = await chaptersResponse.json();
        total = chaptersData.total || 0;
        
        const batch: ScrapedChapter[] = chaptersData.data.map((item: any) => {
          const num = parseFloat(item.attributes.chapter) || 0;
          if (targetSet?.has(num)) {
            foundTargetsCount++;
          }
          return {
            chapterNumber: num,
            chapterLabel: item.attributes.chapter ? `Chapter ${item.attributes.chapter}` : 'Special',
            chapterTitle: item.attributes.title || `Chapter ${item.attributes.chapter}`,
            chapterUrl: `https://mangadex.org/chapter/${item.id}`,
            sourceChapterId: item.id,
            publishedAt: new Date(item.attributes.publishAt),
          };
        });

        chapters.push(...batch);
        
        if (targetSet && foundTargetsCount >= targetSet.size) {
          console.log(`[MangaDex] Found all ${targetSet.size} targeted chapters, stopping early.`);
          break;
        }

        offset += limit;
        if (offset > 10000) break; 
        
      } while (offset < total);

      breaker.recordSuccess();

      const filteredChapters = targetSet 
        ? chapters.filter(c => targetSet.has(c.chapterNumber))
        : chapters;

      return {
        sourceId,
        title,
        chapters: filteredChapters
      };
    } catch (error) {
      // P1-8 FIX: DNS errors should trigger retry, not circuit breaker
      const isDns = error instanceof DnsError || isDnsOrNetworkError(error);
      const isRetryable = error instanceof ScraperError ? error.isRetryable : true;
      const isRateLimit = error instanceof RateLimitError;
      
      // Don't trip circuit breaker for DNS errors - they're transient
      if (!isRateLimit && !isDns && isRetryable) {
        breaker.recordFailure();
      }
      
      if (error instanceof ScraperError) throw error;

      console.error(`[MangaDex] Scraping failed for ${sourceId}:`, error);
      throw new ScraperError(
        `MangaDex fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'mangadex',
        true
      );
    }
  }

  async scrapeLatestUpdates(): Promise<ScrapedLatestUpdate[]> {
    const { sourceRateLimiter } = await import('../rate-limiter');
    const acquired = await sourceRateLimiter.acquireToken('mangadex', 30000);
    if (!acquired) {
      throw new RateLimitError('mangadex');
    }

    try {
      // CONTENT POLICY: Only fetch allowed content ratings (exclude pornographic)
      const response = await fetch(
        `${this.BASE_URL}/chapter?limit=100&translatedLanguage[]=en&order[publishAt]=desc&${ALLOWED_CONTENT_RATINGS_PARAM}&includes[]=manga`,
        { signal: AbortSignal.timeout(this.TIMEOUT_MS) }
      );

      if (!response.ok) {
        throw new Error(`MangaDex latest updates failed: ${response.statusText}`);
      }

      const data = await response.json();
      const updates: ScrapedLatestUpdate[] = [];

      for (const item of data.data) {
        const mangaRel = item.relationships.find((r: any) => r.type === 'manga');
        if (!mangaRel) continue;

        updates.push({
          sourceId: mangaRel.id,
          title: mangaRel.attributes?.title?.en || 'Unknown Title',
          chapterNumber: parseFloat(item.attributes.chapter) || 0,
          chapterUrl: `https://mangadex.org/chapter/${item.id}`,
        });
      }

      return updates;
    } catch (error) {
      console.error('[MangaDex] Failed to scrape latest updates:', error);
      throw new ScraperError(
        `MangaDex latest updates failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'mangadex',
        true
      );
    }
  }
}

export const scrapers: Record<string, Scraper> = {
  'mangadex': new MangaDexScraper(),
};

// Sources that are currently supported (have working scrapers)
export const SUPPORTED_SOURCES = ['mangadex'] as const;
export type SupportedSource = typeof SUPPORTED_SOURCES[number];

// Sources that are planned but not yet implemented (hidden from UI)
export const PLANNED_SOURCES = [
  'mangapark',
  'mangasee', 
  'manga4life',
  'manganato',
  'hiperdex',
  'bato',
  'mangakakalot',
] as const;

export const getSupportedSources = () => [...SUPPORTED_SOURCES];

export function isSourceSupported(source: string): source is SupportedSource {
  return SUPPORTED_SOURCES.includes(source as SupportedSource);
}
