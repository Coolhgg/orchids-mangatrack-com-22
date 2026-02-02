// scripts/import-mangadex-popular.ts
import { MangaDexCandidate, MangaDexRateLimitError, MangaDexError, getMangaDexHeaders, MANGADEX_API_BASE, getMangaDexCoverUrl, getPopularManga } from '../src/lib/mangadex';
import { mergeRelationships } from '../src/lib/utils';
import { isMangaDexPlaceholder } from '../src/lib/cover-resolver';
import { getOfficialLinks, getOfficialLinksBySearch, AniListExternalLink } from '../src/lib/anilist';
import { prisma } from '../src/lib/prisma';

const BATCH_SIZE = 100;
const MAX_OFFSET = 9900; // MangaDex API limit is 10,000 total (offset + limit)
const BASE_DELAY_MS = 1000;
const ANILIST_DELAY_MS = 2000;

// Different sorting strategies to get more than 10k manga
type SortStrategy = {
  name: string;
  orderParam: string;
  orderValue: string;
};

const SORT_STRATEGIES: SortStrategy[] = [
  { name: 'followedCount', orderParam: 'order[followedCount]', orderValue: 'desc' },
  { name: 'rating', orderParam: 'order[rating]', orderValue: 'desc' },
  { name: 'createdAt', orderParam: 'order[createdAt]', orderValue: 'desc' },
  { name: 'updatedAt', orderParam: 'order[updatedAt]', orderValue: 'desc' },
  { name: 'latestChapter', orderParam: 'order[latestUploadedChapter]', orderValue: 'desc' },
];

function selectBestCoverFromRelationships(relationships: any[], mangaId: string): string | undefined {
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

async function getMangaWithStrategy(limit: number, offset: number, strategy: SortStrategy): Promise<MangaDexCandidate[]> {
  const url = new URL(`${MANGADEX_API_BASE}/manga`);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('offset', offset.toString());
  url.searchParams.set(strategy.orderParam, strategy.orderValue);
  url.searchParams.append('includes[]', 'cover_art');

  const response = await fetch(url.toString(), {
    headers: getMangaDexHeaders(),
  });

  if (response.status === 429) {
    throw new MangaDexRateLimitError();
  }

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

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function importBatch(offset: number, strategy: SortStrategy): Promise<{ hasMore: boolean; newCount: number }> {
  console.log(`\n[Import] Fetching batch at offset ${offset} using ${strategy.name}...`);
  
  let candidates: MangaDexCandidate[] = [];
  try {
    candidates = await getMangaWithStrategy(BATCH_SIZE, offset, strategy);
  } catch (error) {
    if (error instanceof MangaDexRateLimitError) {
      console.warn(`[Import] Hit MangaDex rate limit during fetch. Waiting 30s...`);
      await delay(30000);
      return importBatch(offset, strategy);
    }
    if (error instanceof MangaDexError && (error as any).status === 400) {
      console.log(`[Import] Offset ${offset} exceeds MangaDex limit for ${strategy.name}.`);
      return { hasMore: false, newCount: 0 };
    }
    console.error(`[Import] Failed to fetch candidates at offset ${offset}:`, error);
    throw error;
  }
  
  if (candidates.length === 0) {
    console.log(`[Import] No more candidates found at offset ${offset}.`);
    return { hasMore: false, newCount: 0 };
  }

  let newCount = 0;

  for (const candidate of candidates) {
    try {
      // Check if series already exists
      const existing = await prisma.series.findUnique({
        where: { mangadex_id: candidate.mangadex_id },
        select: { id: true }
      });

      if (existing) {
        // Skip completely if already exists (don't re-process)
        continue;
      }

      // Create new series
      const series = await prisma.series.create({
        data: {
          mangadex_id: candidate.mangadex_id,
          title: candidate.title,
          alternative_titles: candidate.alternative_titles,
          description: candidate.description,
          status: candidate.status,
          type: candidate.type,
          genres: candidate.genres,
          content_rating: candidate.content_rating,
          cover_url: candidate.cover_url,
          tags: candidate.tags,
          demographic: candidate.publication_demographic,
          year: candidate.year,
          catalog_tier: 'C',
        },
      });

      newCount++;
      console.log(`[Import] NEW: ${candidate.title}`);

      // Import Official Links (only for new series)
      let officialLinks: AniListExternalLink[] = [];
      
      if (candidate.anilist_id) {
        await delay(ANILIST_DELAY_MS);
        officialLinks = await getOfficialLinks(candidate.anilist_id);
      }
      
      if (officialLinks.length === 0) {
        await delay(ANILIST_DELAY_MS);
        officialLinks = await getOfficialLinksBySearch(candidate.title);
      }
      
      if (officialLinks.length > 0) {
        for (const link of officialLinks) {
          const sourceId = `${link.site.toLowerCase()}:${candidate.anilist_id || 'search'}`;
          
          await prisma.seriesSource.create({
            data: {
              series_id: series.id,
              source_name: link.site,
              source_url: link.url,
              source_id: sourceId,
              trust_score: 1.0,
              last_checked_at: new Date(),
              sync_priority: 'COLD',
            },
          }).catch(() => {}); // Ignore duplicate errors

          console.log(`[Import]   Added: ${link.site}`);
        }
      }
    } catch (error) {
      console.error(`[Import] Error processing ${candidate.title}:`, error);
    }
  }

  return { hasMore: true, newCount };
}

async function main() {
  const targetCount = 15000;
  let totalNewImported = 0;
  
  // Parse command line arguments for starting offset and strategy index
  const args = process.argv.slice(2);
  const startOffset = args[0] ? parseInt(args[0], 10) : 0;
  const startStrategyIndex = args[1] ? parseInt(args[1], 10) : 0;
  
  console.log(`[Import] Starting multi-strategy import. Target: ${targetCount} total series.`);
  console.log(`[Import] Resume from offset: ${startOffset}, strategy index: ${startStrategyIndex}`);
  
  // Get current count
  const startCount = await prisma.series.count();
  console.log(`[Import] Current database count: ${startCount}`);
  
  if (startCount >= targetCount) {
    console.log(`[Import] Already have ${startCount} series. Target met!`);
    return;
  }

  // Run through each strategy (starting from specified index)
  for (let stratIdx = startStrategyIndex; stratIdx < SORT_STRATEGIES.length; stratIdx++) {
    const strategy = SORT_STRATEGIES[stratIdx];
    const currentCount = await prisma.series.count();
    if (currentCount >= targetCount) {
      console.log(`[Import] Target of ${targetCount} reached!`);
      break;
    }

    console.log(`\n[Import] === Starting strategy: ${strategy.name} (index ${stratIdx}) ===`);
    let strategyNewCount = 0;
    
    // Use startOffset only for the first strategy we're resuming
    const initialOffset = (stratIdx === startStrategyIndex) ? startOffset : 0;
    
    for (let offset = initialOffset; offset < MAX_OFFSET; offset += BATCH_SIZE) {
      try {
        const { hasMore, newCount } = await importBatch(offset, strategy);
        strategyNewCount += newCount;
        totalNewImported += newCount;
        
        const currentTotal = await prisma.series.count();
        console.log(`[Import] ${strategy.name} offset ${offset}: +${newCount} new (total: ${currentTotal})`);
        
        if (!hasMore) {
          console.log(`[Import] ${strategy.name}: No more results at offset ${offset}`);
          break;
        }
        
        if (currentTotal >= targetCount) {
          console.log(`[Import] Target of ${targetCount} reached!`);
          break;
        }
        
        await delay(BASE_DELAY_MS);
      } catch (error) {
        console.error(`[Import] ${strategy.name} offset ${offset} failed:`, error);
        break;
      }
    }
    
    console.log(`[Import] Strategy ${strategy.name} complete: +${strategyNewCount} new series`);
  }

  const finalCount = await prisma.series.count();
  console.log(`\n[Import] === COMPLETE ===`);
  console.log(`[Import] Started with: ${startCount}`);
  console.log(`[Import] New imported: ${totalNewImported}`);
  console.log(`[Import] Final count: ${finalCount}`);
}

main()
  .catch(console.error)
  .finally(async () => {
    await prisma.$disconnect();
  });
