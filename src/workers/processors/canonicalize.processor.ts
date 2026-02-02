import { Job } from 'bullmq';
import { prisma } from '@/lib/prisma';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { isValidCoverUrl, isMangaDexPlaceholder } from '@/lib/cover-resolver';
import { withLock } from '@/lib/redis';
import { normalizeTitle } from '@/lib/string-utils';
import { enrichSingleSeriesWithStats, isStatsEnrichmentEnabled } from '@/lib/mangadex';
import { logger } from '@/lib/logger';
import { isBlockedContent } from '@/lib/constants/safe-browsing';

interface CanonicalizeJobData {
  version?: number; // BUG 67: Job Schema versioning
  title: string;
  source_name: string;
  source_id: string;
  source_url: string;
  mangadex_id?: string;
  alternative_titles?: string[];
  description?: string;
  cover_url?: string;
  type: string;
  status?: string;
  genres?: string[];
  tags?: string[];  // Themes/tags from MangaDex
  content_rating?: string;
  confidence?: number;
}

export async function processCanonicalize(job: Job<CanonicalizeJobData>) {
    const { 
      version, // BUG 67
      title: rawTitle, 
      source_name, 
      source_id, 
      source_url, 
      mangadex_id, 
      alternative_titles = [], 
      description, 
      cover_url,
      type,
      status,
      genres = [],
      tags = [],  // Themes/tags from MangaDex
      content_rating,
      confidence
    } = job.data;

    // CRITICAL: Reject pornographic content at the canonicalization layer (platform policy)
    if (isBlockedContent(content_rating)) {
      logger.warn(`[Canonicalize] Job ${job.id} rejected: content_rating "${content_rating}" is blocked by platform policy`);
      return { series_id: null, created: false, blocked: true, reason: 'Content blocked by platform policy' };
    }

    const title = normalizeTitle(rawTitle); // BUG 36: Normalize title for consistent matching

    logger.info(`[Canonicalize] Job ${job.id} (v${version || 1}) started processing: ${source_name}:${source_id} - "${title}"`);

    // BUG 25: Distributed lock to prevent duplicate series creation/merging
    return await withLock(`canonicalize:${title.slice(0, 100)}`, 60000, async () => {
      const result = await prisma.$transaction(async (tx) => {
        let series = null;
        let created = false;


    if (mangadex_id) {
      series = await tx.series.findUnique({
        where: { mangadex_id },
      });
      if (series) {
        logger.debug(`[Canonicalize] Matched by mangadex_id: ${series.title} (ID: ${series.id})`);
      }
    }

    if (!series) {
      const existingSource = await tx.seriesSource.findUnique({
        where: {
          source_name_source_id: {
            source_name,
            source_id,
          },
        },
        include: { series: true },
      });
      if (existingSource) {
          series = existingSource.series;
          logger.debug(`[Canonicalize] Matched by source link: ${series?.title} (ID: ${series?.id})`);
      }
    }

    if (!series) {
      series = await tx.series.findFirst({
        where: {
          title: {
            equals: title,
            mode: 'insensitive',
          },
        },
      });
      if (series) {
        logger.debug(`[Canonicalize] Matched by title: ${series.title} (ID: ${series.id})`);
      }
    }

    const currentAltTitles = (series?.alternative_titles as string[]) || [];
    const mergedAltTitles = Array.from(new Set([...currentAltTitles, ...alternative_titles, title]));

    const validIncomingCover = isValidCoverUrl(cover_url) ? cover_url : null;
    const incomingIsPlaceholder = isMangaDexPlaceholder(cover_url);
    const existingCoverValid = isValidCoverUrl(series?.cover_url);
    const existingIsPlaceholder = isMangaDexPlaceholder(series?.cover_url);

    // Merge existing tags with new tags
    const existingTags = (series?.tags as string[]) || [];
    const mergedTags = Array.from(new Set([...existingTags, ...tags]));

    if (series) {
      let newCoverUrl: string | null = series.cover_url ?? null;

      if (source_name === 'mangadex') {
        if (validIncomingCover && !incomingIsPlaceholder) {
          newCoverUrl = validIncomingCover;
        } else if (existingCoverValid && !existingIsPlaceholder) {
          newCoverUrl = series.cover_url;
        } else if (validIncomingCover) {
          newCoverUrl = validIncomingCover;
        }
      } else if (validIncomingCover && !existingCoverValid) {
        newCoverUrl = validIncomingCover;
      } else if (validIncomingCover && !incomingIsPlaceholder && existingIsPlaceholder) {
        newCoverUrl = validIncomingCover;
      }

      const needsUpdate = 
        (!series.mangadex_id && mangadex_id) ||
        (series.mangadex_id?.startsWith('local-') && mangadex_id && !mangadex_id.startsWith('local-')) ||
        (!series.description && description) ||
        (series.cover_url !== newCoverUrl) ||
        (status && series.status !== status) ||
        (content_rating && series.content_rating !== content_rating) ||
        (tags.length > 0 && existingTags.length === 0);  // Update if we have new tags

      if (needsUpdate) {
        series = await tx.series.update({
          where: { id: series.id },
          data: {
            mangadex_id: (series.mangadex_id?.startsWith('local-') && mangadex_id && !mangadex_id.startsWith('local-')) 
              ? mangadex_id 
              : (series.mangadex_id || mangadex_id),
            description: series.description || description,
            cover_url: newCoverUrl,
            alternative_titles: mergedAltTitles,
            status: series.status || status,
            genres: series.genres.length > 0 ? series.genres : genres,
            tags: mergedTags.length > 0 ? mergedTags : (series.tags || []),  // Save tags/themes
            content_rating: content_rating || series.content_rating,
          },
        });
        logger.debug(`[Canonicalize] Updated existing series: ${series.title} (tags: ${mergedTags.length})`);
      }
    } else {
      logger.info(`[Canonicalize] Creating new canonical series: "${title}" with ${tags.length} tags`);
      series = await tx.series.create({
        data: {
          title,
          mangadex_id,
          alternative_titles: mergedAltTitles,
          description,
          cover_url: validIncomingCover,
          type,
          status,
          genres,
          tags,  // Save tags/themes on creation
          content_rating,
        },
      });
      created = true;
      logger.info(`[Canonicalize] Created new series: ${series.title} (ID: ${series.id}, tags: ${tags.length})`);
    }

    await tx.seriesSource.upsert({
      where: {
        source_name_source_id: {
          source_name,
          source_id,
        },
      },
      update: {
        series_id: series.id,
        source_url,
        source_title: title,
        source_status: 'active',
        match_confidence: confidence,
        cover_url: validIncomingCover || undefined,
        cover_updated_at: validIncomingCover ? new Date() : undefined,
      },
      create: {
        series_id: series.id,
        source_name,
        source_id,
        source_url,
        source_title: title,
        source_status: 'active',
        match_confidence: confidence,
        sync_priority: 'COLD',
        cover_url: validIncomingCover || null,
        cover_updated_at: validIncomingCover ? new Date() : null,
      },
      });

      return { series, created };
    });

    logger.info(`[Canonicalize] Job ${job.id} completed for "${result.series.title}" (created: ${result.created})`);

    if (isStatsEnrichmentEnabled() && mangadex_id && source_name === 'mangadex') {
      try {
        const statsResult = await enrichSingleSeriesWithStats(
          prisma,
          result.series.id,
          mangadex_id
        );
        if (statsResult.success) {
          logger.info(`[Canonicalize] Stats enriched for ${result.series.id}`);
        } else if (statsResult.shouldRequeue) {
          logger.warn(`[Canonicalize] Stats fetch rate limited, will retry later`, {
            seriesId: result.series.id,
            requeueDelay: statsResult.requeueDelay,
          });
        }
      } catch (statsErr) {
        logger.warn(`[Canonicalize] Stats enrichment failed (non-fatal)`, {
          seriesId: result.series.id,
          error: statsErr instanceof Error ? statsErr.message : String(statsErr),
        });
      }
    }

    logger.info(`[Canonicalize] Emitting series.available event for "${result.series.title}"`);
    try {
      await supabaseAdmin
        .channel('public:series')
        .send({
          type: 'broadcast',
          event: 'series.available',
          payload: {
            series_id: result.series.id,
            mangadex_id,
            title: result.series.title,
            created: result.created
          }
        });
      logger.info(`[Canonicalize] series.available event emitted successfully`);
      } catch (err) {
        logger.error(`[Canonicalize] Failed to emit series.available event:`, { error: err instanceof Error ? err.message : String(err) });
      }

    return { series_id: result.series.id, created: result.created };
  });
}
