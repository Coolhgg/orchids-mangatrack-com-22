import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma } from '@/lib/prisma';
import { syncSourceQueue } from '@/lib/queues';
import { handleApiError, ApiError, validateOrigin, checkRateLimit, validateContentType, validateJsonSize, logSecurityEvent, getClientIp } from '@/lib/api-utils';
import { extractMangaDexId } from '@/lib/mangadex-utils';
import { getMangaById } from '@/lib/mangadex';
import { z } from 'zod';

const AttachSourceSchema = z.object({
    mangadex_id: z.string().min(1).max(255).refine(val => {
        const id = extractMangaDexId(val);
        if (id) return true;
        
        const isLegacy = /^\d+$/.test(val);
        const isPrefixed = /^md-[a-zA-Z0-9_-]+$/i.test(val);
        return isLegacy || isPrefixed;
      }, {
        message: "Invalid MangaDex ID or URL format."
      }),
    type: z.enum(['manga', 'manhwa', 'manhua', 'webtoon', 'comic', 'novel', 'light_novel']).optional().default('manga'),
});

/**
 * POST /api/series/attach
 * User manual override: System fetches metadata from canonical source URL provided by user.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      throw new ApiError('Unauthorized', 401);
    }

    validateOrigin(req);
    validateContentType(req);
    await validateJsonSize(req, 128 * 1024);

    const ip = getClientIp(req);
    if (!await checkRateLimit(`attach:${user.id}`, 10, 60000)) {
      throw new ApiError('Too many requests. Please wait.', 429);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      throw new ApiError('Invalid JSON body', 400);
    }
    
    const parseResult = AttachSourceSchema.safeParse(body);
    if (!parseResult.success) {
      throw new ApiError(`Validation error: ${parseResult.error.errors[0].message}`, 400);
    }
    const validated = parseResult.data;

    const mangadexId = extractMangaDexId(validated.mangadex_id) || validated.mangadex_id;

    // HARDENING: Fetch metadata from canonical source (MangaDex) server-side
    // User can no longer provide title/description/etc. in the request.
    const canonicalMetadata = await getMangaById(mangadexId);
    if (!canonicalMetadata) {
      throw new ApiError('Could not fetch metadata from MangaDex. Please verify the ID/URL.', 404);
    }

    // 1. Find or Create Series (USER_OVERRIDE path)
    const series = await prisma.series.upsert({
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

    // 2. Create SeriesSource (Lazy Attachment)
    const DEFAULT_MANGADEX_TRUST_SCORE = 0.9;

    const source = await prisma.seriesSource.upsert({
      where: {
        source_name_source_id: {
          source_name: 'mangadex',
          source_id: mangadexId,
        },
      },
      update: {
        series_id: series.id,
        source_status: 'active',
        trust_score: DEFAULT_MANGADEX_TRUST_SCORE,
      },
      create: {
        series_id: series.id,
        source_name: 'mangadex',
        source_id: mangadexId,
        source_url: `https://mangadex.org/title/${mangadexId}`,
        source_title: canonicalMetadata.title,
        source_status: 'active',
        sync_priority: 'HOT',
        trust_score: DEFAULT_MANGADEX_TRUST_SCORE,
      },
    });

    // 3. Add to User's Library
    const sourceUrl = `https://mangadex.org/title/${mangadexId}`;
      const libraryEntry = await prisma.libraryEntry.upsert({
        where: {
          user_id_source_url: {
            user_id: user.id,
            source_url: sourceUrl,
          },
        },
        update: {
          series_id: series.id,
          status: 'reading',
          metadata_status: 'enriched',
          needs_review: false,
        },
        create: {
          user_id: user.id,
          series_id: series.id,
          source_url: sourceUrl,
          source_name: 'mangadex',
          status: 'reading',
          metadata_status: 'enriched', // Since we know the series and source here
          needs_review: false,
        },
      });

    // 4. Trigger Initial Sync Job
    await syncSourceQueue.add(`sync-${source.id}`, {
      seriesSourceId: source.id,
    }, {
      priority: 1, // High priority for first sync
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // 5. Create Notifications & Emit Events (Phase-4)
    const supabaseAdminClient = (await import('@/lib/supabase/admin')).supabaseAdmin;

    // Log security event
    await logSecurityEvent({
      userId: user.id,
      event: 'SERIES_ATTACH',
      status: 'success',
      ipAddress: ip,
      userAgent: req.headers.get('user-agent'),
      metadata: { series_id: series.id, mangadex_id: validated.mangadex_id }
    });
    
    // Series Available Notification
    await prisma.notification.create({
      data: {
        user_id: user.id,
        type: 'SERIES_AVAILABLE',
        title: 'Series Available',
        message: `"${series.title}" is now available in your library.`,
        series_id: series.id,
        metadata: {
          mangadex_id: validated.mangadex_id,
        }
      }
    });

    // Source Attached Notification
    await prisma.notification.create({
      data: {
        user_id: user.id,
        type: 'SOURCE_ATTACHED',
        title: 'Source Attached',
        message: `MangaDex source successfully attached to "${series.title}".`,
        series_id: series.id,
        metadata: {
          source_id: source.id,
          source_name: 'mangadex',
        }
      }
    });

    // Emit series.available event
    await supabaseAdminClient
      .channel('public:series')
      .send({
        type: 'broadcast',
        event: 'series.available',
        payload: {
          series_id: series.id,
          mangadex_id: validated.mangadex_id,
          title: series.title
        }
      });

    return NextResponse.json({
      success: true,
      series_id: series.id,
      library_entry_id: libraryEntry.id,
    }, { status: 201 });

  } catch (error) {
    return handleApiError(error);
  }
}
