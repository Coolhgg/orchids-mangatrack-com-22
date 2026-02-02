import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { prisma, DEFAULT_TX_OPTIONS } from '@/lib/prisma';
import { logActivity } from '@/lib/gamification/activity';
import { XP_SERIES_COMPLETED, calculateLevel } from '@/lib/gamification/xp';
import { checkAchievements } from '@/lib/gamification/achievements';
import { checkRateLimit, handleApiError, ApiError, validateOrigin, ErrorCodes, getClientIp, validateContentType, validateJsonSize } from '@/lib/api-utils';

export async function PATCH(req: NextRequest) {
  try {
    validateOrigin(req);
    validateContentType(req);
    await validateJsonSize(req);

    const ip = getClientIp(req);
    if (!await checkRateLimit(`library-bulk-update:${ip}`, 10, 60000)) {
      throw new ApiError('Too many requests. Please wait a moment.', 429, ErrorCodes.RATE_LIMITED);
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      throw new ApiError('Unauthorized', 401, ErrorCodes.UNAUTHORIZED);
    }

    const body = await req.json();
    const { updates } = body;

    if (!Array.isArray(updates) || updates.length === 0) {
      throw new ApiError('Updates must be a non-empty array', 400, ErrorCodes.BAD_REQUEST);
    }

    if (updates.length > 50) {
      throw new ApiError('Cannot update more than 50 entries at once', 400, ErrorCodes.BAD_REQUEST);
    }

    const entryIds = updates.map(u => u.id).filter(Boolean);
    const results = await prisma.$transaction(async (tx) => {
      // PERFORMANCE FIX: Fetch all current entries in one query instead of inside the loop
      const currentEntries = await tx.libraryEntry.findMany({
        where: { 
          id: { in: entryIds },
          user_id: user.id 
        },
      });

      const currentEntriesMap = new Map(currentEntries.map(e => [e.id, e]));
      const updatedEntries = [];
      const now = new Date();

      // Collect data for batching side effects
      const completionsToProcess = [];
      const statusUpdatesToProcess = [];

      for (const update of updates) {
        const { id, status, rating, preferred_source } = update;
        if (!id) continue;

        const currentEntry = currentEntriesMap.get(id);
        if (!currentEntry) continue;

        const updateData: any = { updated_at: now };
        if (status) {
          const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
          if (validStatuses.includes(status)) {
            updateData.status = status;
          }
        }
        if (rating !== undefined && rating !== null) {
          const ratingNum = Number(rating);
          if (!isNaN(ratingNum) && ratingNum >= 1 && ratingNum <= 10) {
            updateData.user_rating = ratingNum;
          }
        }
        if (preferred_source !== undefined) {
          updateData.preferred_source = preferred_source;
        }

        const updatedEntry = await tx.libraryEntry.update({
          where: { id, user_id: user.id },
          data: updateData,
        });

        updatedEntries.push(updatedEntry);

        // Side effects preparation
        if (status === 'completed' && currentEntry.status !== 'completed') {
          completionsToProcess.push(currentEntry);
        } else if (status && status !== currentEntry.status) {
          statusUpdatesToProcess.push({ 
            entry: currentEntry, 
            oldStatus: currentEntry.status, 
            newStatus: status 
          });
        }
      }

        // PERFORMANCE FIX: Batch process completions to avoid N+1 queries
        if (completionsToProcess.length > 0) {
          const seriesIds = completionsToProcess.map(c => c.series_id).filter(Boolean) as string[];
          
          // 1. Check existing activities in one query
          const existingActivities = await tx.activity.findMany({
            where: {
              user_id: user.id,
              series_id: { in: seriesIds },
              type: 'series_completed',
            },
            select: { series_id: true }
          });
          
          const existingSeriesIds = new Set(existingActivities.map(a => a.series_id));
          const newCompletions = completionsToProcess.filter(c => c.series_id && !existingSeriesIds.has(c.series_id));

          if (newCompletions.length > 0) {
            // 2. Fetch user profile once
            const userProfile = await tx.user.findUnique({
              where: { id: user.id },
              select: { xp: true },
            });

            // 3. Calculate total XP gain and update user once
            const totalXpGain = newCompletions.length * XP_SERIES_COMPLETED;
            const newXp = (userProfile?.xp || 0) + totalXpGain;
            const newLevel = calculateLevel(newXp);

            await tx.user.update({
              where: { id: user.id },
              data: { xp: newXp, level: newLevel },
            });

            // 4. PERFORMANCE FIX: Batch log activities and check achievements ONCE
            await tx.activity.createMany({
              data: newCompletions.map(c => ({
                user_id: user.id,
                type: 'series_completed',
                series_id: c.series_id,
                metadata: {},
              }))
            });
            
            await checkAchievements(tx, user.id, 'series_completed');
          }
        }

        // Process other status updates
        if (statusUpdatesToProcess.length > 0) {
          await tx.activity.createMany({
            data: statusUpdatesToProcess.map(update => ({
              user_id: user.id,
              type: 'status_updated',
              series_id: update.entry.series_id,
              metadata: { old_status: update.oldStatus, new_status: update.newStatus },
            }))
          });
        }

      return updatedEntries;
    }, { ...DEFAULT_TX_OPTIONS, timeout: 20000 });

    return NextResponse.json({
      success: true,
      count: results.length,
      entries: results
    });
  } catch (error: any) {
    return handleApiError(error);
  }
}
