import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { canonicalizeQueue } from '@/lib/queues';
import { getMangaDexHeaders, MANGADEX_API_BASE, getMangaDexCoverUrl } from '@/lib/mangadex';
import { SearchIntent, normalize } from '../../lib/search-intent';
import { isValidCoverUrl } from '@/lib/cover-resolver';
import { mergeRelationships } from '@/lib/utils';
import { sourceRateLimiter } from '@/lib/rate-limiter';
import { decrementPremiumConcurrency } from '@/lib/search-cache';
import { markQueryResolved } from '@/lib/search-utils';
import { isBlockedContent, ALLOWED_CONTENT_RATINGS } from '@/lib/constants/safe-browsing';

interface CheckSourceJobData {
  query?: string;
  normalizedKey?: string;
  series_id?: string;
  intent?: SearchIntent;
  trigger?: 'user_search' | 'system_sync' | 'deferred_retry';
  userId?: string;
  isPremium?: boolean;
}

interface LanguageAwareTitle {
  title: string;
  lang: string;
}

interface MangaDexCandidate {
  mangadex_id: string;
  title: string;
  title_lang: string;
  alternative_titles: LanguageAwareTitle[];
  original_language: string;
  description: string;
  status: string;
  type: string;
  genres: string[];
  tags: string[];  // Themes/tags from MangaDex
  content_rating?: string;
  cover_url?: string;
  follows?: number;
  rating?: number;
  score?: number;
  confidence?: number;
}

const RATE_LIMIT_TIMEOUT_MS = 30000; // 30s max wait for rate limit per request

/**
 * Processor to search MangaDex for potential canonical matches.
 */
export async function processCheckSource(job: Job<CheckSourceJobData>) {
  try {
    const { query, series_id, trigger, userId, isPremium } = job.data;
    
    console.log(`[CheckSource] Job ${job.id} started processing`);
    
    let searchTerm = query;

  // Resolve search term from series_id if query is missing
  if (!searchTerm && series_id) {
    const series = await prisma.series.findUnique({
      where: { id: series_id },
      select: { title: true },
    });
    searchTerm = series?.title;
  }

  if (!searchTerm) {
    console.error(`[CheckSource] Job ${job.id} failed: No search term provided`);
    throw new Error('No search term provided or found for series_id');
  }

  // Normalize search term to ensure robustness
  const normalizedSearchTerm = normalize(searchTerm);

  console.log(`[CheckSource] Job ${job.id} searching for "${normalizedSearchTerm}" (Original: "${searchTerm}", Trigger: ${trigger || 'unknown'}, Intent: ${job.data.intent || 'unknown'})`);

  const PAGE_LIMIT = 32;
  const MAX_PAGES = 3; 
  
  const candidates: MangaDexCandidate[] = [];

  // Helper to process results
  const processMangaDexResults = (results: any[], statisticsMap: any) => {
    for (const manga of results) {
      const attrs = manga.attributes;
      
      const titleMap = attrs.title || {};
      const titles = Object.entries(titleMap).map(([lang, title]) => ({ title: title as string, lang }));
      const altTitles = (attrs.altTitles || []).flatMap((t: any) => 
        Object.entries(t).map(([lang, title]) => ({ title: title as string, lang }))
      );
      
      const allTitles = [...titles, ...altTitles].filter(t => !!t.title);
      const primaryTitleObj = titles[0] || altTitles[0] || { title: 'Unknown Title', lang: 'unknown' };
      
      const description = attrs.description.en || Object.values(attrs.description)[0] as string || '';
      
      const coverRels = manga.relationships.filter((r: any) => r.type === 'cover_art');
      let coverFileName: string | undefined;
      
      for (const rel of coverRels) {
        if (rel.attributes?.fileName) {
          coverFileName = rel.attributes.fileName;
          break;
        }
      }
      
      const rawCoverUrl = coverFileName 
        ? getMangaDexCoverUrl(manga.id, coverFileName)
        : undefined;

      const coverUrl = isValidCoverUrl(rawCoverUrl) ? rawCoverUrl : undefined;

      const genres = (attrs.tags || [])
        .filter((tag: any) => tag.attributes?.group === 'genre')
        .map((tag: any) => tag.attributes?.name?.en || '')
        .filter(Boolean);

      const tags = (attrs.tags || [])
        .filter((tag: any) => tag.attributes?.group === 'theme')
        .map((tag: any) => tag.attributes?.name?.en || '')
        .filter(Boolean);

      const stats = statisticsMap[manga.id] || manga.statistics || attrs.statistics;
      const follows = stats?.follows;
      const rating = stats?.rating?.average;

      candidates.push({
        mangadex_id: manga.id,
        title: primaryTitleObj.title,
        title_lang: primaryTitleObj.lang,
        alternative_titles: allTitles,
        original_language: attrs.original_language || attrs.originalLanguage,
        description,
        status: attrs.status,
        type: attrs.publicationDemographic || 'unknown',
        genres,
        tags,
        content_rating: attrs.contentRating,
        cover_url: coverUrl,
        follows,
        rating,
      });
    }
  };

  // Helper to perform MangaDex search
  const performSearch = async (term: string, page: number) => {
    const tokenAcquired = await sourceRateLimiter.acquireToken('mangadex', RATE_LIMIT_TIMEOUT_MS);
    if (!tokenAcquired) return null;

    const offset = page * PAGE_LIMIT;
    const url = new URL(`${MANGADEX_API_BASE}/manga`);
    url.searchParams.set('title', term);
    url.searchParams.set('limit', PAGE_LIMIT.toString());
    url.searchParams.set('offset', offset.toString());
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('includes[]', 'statistics');
    // CRITICAL: Only fetch allowed content ratings (exclude pornographic)
    for (const rating of ALLOWED_CONTENT_RATINGS) {
      url.searchParams.append('contentRating[]', rating);
    }

    try {
      const response = await fetch(url.toString(), { headers: getMangaDexHeaders() });
      if (response.status === 429) return 'RATE_LIMIT';
      if (!response.ok) return null;
      return await response.json();
    } catch (e) {
      console.error(`[CheckSource] Search error for "${term}":`, e);
      return null;
    }
  };

  // Strategy 1: Search original normalized term
  for (let page = 0; page < MAX_PAGES; page++) {
    const data = await performSearch(normalizedSearchTerm, page);
    if (data === 'RATE_LIMIT') break;
    if (!data) break;

    const results = mergeRelationships(data.data || [], data.included || []);
    const statisticsMap = data.statistics || {};
    if (results.length === 0) break;

    processMangaDexResults(results, statisticsMap);
    if (results.length < PAGE_LIMIT) break;
  }

  // Strategy 2: Fuzzy/Tokenized Fallback if no results found
  if (candidates.length === 0) {
    const words = normalizedSearchTerm.split(/\s+/).filter(w => w.length >= 3);
    
    if (words.length > 1) {
      const fallbackTerm = words.slice(0, 3).join(' ');
      console.log(`[CheckSource] Trying fallback term: "${fallbackTerm}"`);
      const data = await performSearch(fallbackTerm, 0);
      if (data && data !== 'RATE_LIMIT') {
        const results = mergeRelationships(data.data || [], data.included || []);
        processMangaDexResults(results, data.statistics || {});
      }
    }

    if (candidates.length === 0 && words.length > 0) {
      console.log(`[CheckSource] Trying first word: "${words[0]}"`);
      const data = await performSearch(words[0], 0);
      if (data && data !== 'RATE_LIMIT') {
        const results = mergeRelationships(data.data || [], data.included || []);
        processMangaDexResults(results, data.statistics || {});
      }
    }
  }

  const uniqueCandidates = Array.from(
    new Map(candidates.map(c => [c.mangadex_id, c])).values()
  );

  // CRITICAL: Filter out blocked content (pornographic) before processing
  const allowedCandidates = uniqueCandidates.filter(c => !isBlockedContent(c.content_rating));

  const rankedCandidates = allowedCandidates.map((c, index) => ({
    ...c,
    confidence: 100, 
    score: allowedCandidates.length - index, 
  }));

    for (const candidate of rankedCandidates) {
      const jobId = `canon_mangadex_${candidate.mangadex_id}`;
      
      await canonicalizeQueue.add('canonicalize', {
        title: candidate.title,
        source_name: 'mangadex',
        source_id: candidate.mangadex_id,
        source_url: `https://mangadex.org/title/${candidate.mangadex_id}`,
        mangadex_id: candidate.mangadex_id,
        alternative_titles: candidate.alternative_titles.map(t => t.title),
        description: candidate.description,
        cover_url: candidate.cover_url,
        type: candidate.type,
        status: candidate.status,
        genres: candidate.genres,
        tags: candidate.tags,
        content_rating: candidate.content_rating,
        confidence: candidate.confidence,
      }, {
        jobId,
        priority: trigger === 'user_search' ? 1 : 10,
        removeOnComplete: true,
      });
    }

    // Requirement 7: Mark query as resolved if candidates were found
    if (rankedCandidates.length > 0) {
      const resolvedKey = job.data.normalizedKey || job.id;
      if (resolvedKey && typeof resolvedKey === 'string' && !resolvedKey.includes(':')) {
        await markQueryResolved(resolvedKey);
        console.log(`[CheckSource] Marked query resolved: ${resolvedKey}`);
      }
    }

    console.log(`[CheckSource] Job ${job.id} completed: ${rankedCandidates.length} candidates enqueued`);

    return { found: rankedCandidates.length };
  } catch (error: any) {
    console.error(`[CheckSource] Job ${job.id} failed:`, error.message);
    throw error;
  } finally {
    const { userId, isPremium } = job.data;
    if (isPremium && userId) {
      await decrementPremiumConcurrency(userId);
      console.log(`[CheckSource] Decremented concurrency for premium user=${userId}`);
    }
  }
}

