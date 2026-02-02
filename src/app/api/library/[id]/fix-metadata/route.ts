import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS } from '@/lib/prisma';
import { validateUUID, checkRateLimit, handleApiError, ApiError, validateOrigin, ErrorCodes, getClientIp, logSecurityEvent } from '@/lib/api-utils';
import { extractMangaDexId, isValidMangaDexId } from '@/lib/mangadex-utils';
import { getMangaById } from '@/lib/mangadex';
import { z } from 'zod';

const FixMetadataSchema = z.object({
  mangadex_id: z.string().min(1).max(255),
  type: z.enum(['manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'novel', 'light_novel']).optional().default('manga'),
});

/**
 * POST /api/library/[id]/fix-metadata
 * Manually link a library entry to a MangaDex series.
 * HARDENING: System fetches metadata from canonical source server-side.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    validateOrigin(req);
    validateContentType(req);

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const { id: entryId } = await params;
    validateUUID(entryId, 'entryId');

    const ip = getClientIp(req);
    if (!await checkRateLimit(`metadata-fix:${user.id}`, 20, 60000)) {
      throw new ApiError('Too many fix attempts. Please wait.', 429, ErrorCodes.RATE_LIMITED);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400, ErrorCodes.VALIDATION_ERROR);
    }

    const parseResult = FixMetadataSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(`Validation error: ${parseResult.error.errors[0].message}`, 400, ErrorCodes.VALIDATION_ERROR);
    }
    const validated = parseResult.data;

    const mangadexId = extractMangaDexId(validated.mangadex_id) || validated.mangadex_id;
    if (!isValidMangaDexId(mangadexId)) {
      throw new ApiError('Invalid MangaDex ID format', 400, ErrorCodes.VALIDATION_ERROR);
    }

    // HARDENING: Fetch metadata from canonical source (MangaDex) server-side
    const canonicalMetadata = await getMangaById(mangadexId);
    if (!canonicalMetadata) {
      throw new ApiError('Could not fetch metadata from MangaDex. Please verify the ID/URL.', 404, ErrorCodes.NOT_FOUND);
    }

    const result = await prisma.$transaction(async (tx) => {
      const entry = await tx.libraryEntry.findUnique({
        where: { id: entryId, user_id: user.id }
      });

      if (!entry) {
        throw new ApiError('Library entry not found', 404, ErrorCodes.NOT_FOUND);
      }

      const existingSeries = await tx.series.findUnique({
        where: { mangadex_id: mangadexId }
      });

      if (existingSeries) {
        const existingEntry = await tx.libraryEntry.findFirst({
          where: {
            user_id: user.id,
            series_id: existingSeries.id,
            id: { not: entryId }
          }
        });

        if (existingEntry) {
          throw new ApiError(
            'This series is already in your library. Remove the duplicate entry first.',
            409,
            ErrorCodes.CONFLICT
          );
        }
      }

      // 3. Find or create the series (USER_OVERRIDE path)
      const series = await tx.series.upsert({
        where: { mangadex_id: mangadexId },
        update: {
          title: canonicalMetadata.title,
          alternative_titles: canonicalMetadata.alternative_titles,
          description: canonicalMetadata.description,
          cover_url: canonicalMetadata.cover_url,
          status: canonicalMetadata.status || "ongoing",
          genres: canonicalMetadata.genres || [],
          metadata_source: 'USER_OVERRIDE',
          metadata_confidence: 0.8,
          override_user_id: user.id,
        },
        create: {
          mangadex_id: mangadexId,
          title: canonicalMetadata.title,
          alternative_titles: canonicalMetadata.alternative_titles,
          description: canonicalMetadata.description,
          cover_url: canonicalMetadata.cover_url,
          type: validated.type || canonicalMetadata.type || 'manga',
          status: canonicalMetadata.status || "ongoing",
          genres: canonicalMetadata.genres || [],
          metadata_source: 'USER_OVERRIDE',
          metadata_confidence: 0.8,
          override_user_id: user.id,
        },
      });

      // 4. Ensure SeriesSource exists for MangaDex
      await tx.seriesSource.upsert({
        where: {
          source_name_source_id: {
            source_name: 'mangadex',
            source_id: mangadexId,
          },
        },
        update: {
          series_id: series.id,
        },
        create: {
          series_id: series.id,
          source_name: 'mangadex',
          source_id: mangadexId,
          source_url: `https://mangadex.org/title/${mangadexId}`,
          source_title: canonicalMetadata.title,
          sync_priority: 'WARM',
        },
      });

      const updatedEntry = await tx.libraryEntry.update({
        where: { id: entryId },
        data: {
          series_id: series.id,
          metadata_status: 'enriched',
          needs_review: false,
        },
        include: {
          series: {
            select: {
              id: true,
              title: true,
              cover_url: true,
              type: true,
              status: true,
            }
          }
        }
      });

      // 5. Create activity record for the feed
      await tx.activity.create({
        data: {
          user_id: user.id,
          type: 'metadata_updated',
          series_id: series.id,
          metadata: {
            entry_id: entryId,
            mangadex_id: mangadexId,
            action: 'manual_fix'
          }
        }
      });

      return { entry: updatedEntry, series };
    }, DEFAULT_TX_OPTIONS);

    // Log security event
    await logSecurityEvent({
      userId: user.id,
      event: 'METADATA_MANUAL_FIX',
      status: 'success',
      ipAddress: ip,
      userAgent: req.headers.get('user-agent'),
      metadata: { 
        entry_id: entryId, 
        series_id: result.series.id, 
        mangadex_id: mangadexId 
      }
    });

    // Create notification
    await prisma.notification.create({
      data: {
        user_id: user.id,
        type: 'METADATA_FIXED',
        title: 'Metadata Fixed',
        message: `Successfully linked "${result.entry.imported_title || 'your entry'}" to "${result.series.title}".`,
        series_id: result.series.id,
        metadata: {
          entry_id: entryId,
          mangadex_id: mangadexId,
        }
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Metadata successfully linked',
      entry: result.entry,
      series: result.series,
    });
  } catch (error: unknown) {
    return handleApiError(error);
  }
}
