/**
 * READ TELEMETRY RECORDING
 * 
 * PURPOSE:
 * - Analytics: Track reading patterns across the platform
 * - Anti-cheat: Collect data for trust_score algorithm refinement
 * - Future ML: Enable training of abuse detection models
 * 
 * RULES (LOCKED):
 * 1. INSERT ONLY - telemetry is never updated or mutated
 * 2. NEVER BLOCKS READS - recording happens asynchronously
 * 3. Flagged reads do NOT affect XP or reading (trust_score only)
 * 4. Retention: 90 days (older records can be pruned)
 * 
 * SCHEMA:
 * - user_id: User who read
 * - series_id: Series being read
 * - chapter_number: Integer chapter number
 * - read_duration_s: Time spent reading (seconds)
 * - page_count: Number of pages (if known)
 * - flagged: True if read was suspiciously fast
 * - flag_reason: Why it was flagged (speed_read, bulk_speed_read, etc.)
 * - device_id: Client device identifier (optional)
 * - created_at: Timestamp of the read event
 */

import { prisma } from '../prisma';
import { calculateMinimumReadTime } from './read-time-validation';

export interface TelemetryData {
  userId: string;
  seriesId: string;
  chapterNumber: number;
  readDurationSeconds: number;
  pageCount?: number | null;
  deviceId?: string | null;
}

export interface TelemetryResult {
  recorded: boolean;
  flagged: boolean;
  flagReason?: string;
}

/**
 * Records read telemetry event (INSERT ONLY, NEVER BLOCKS)
 * 
 * This function is designed to:
 * 1. Never throw errors that would block the read operation
 * 2. Insert telemetry data for analytics and anti-cheat
 * 3. Flag suspicious reads without blocking or penalizing
 * 
 * @param data - Telemetry data to record
 * @returns Result indicating if recorded and if flagged
 */
export async function recordReadTelemetry(data: TelemetryData): Promise<TelemetryResult> {
  try {
    const { userId, seriesId, chapterNumber, readDurationSeconds, pageCount, deviceId } = data;
    
    // Determine if this read should be flagged
    const minimumTime = calculateMinimumReadTime(pageCount);
    const flagged = readDurationSeconds < minimumTime;
    
    // Determine flag reason
    let flagReason: string | null = null;
    if (flagged) {
      // Very fast reads (< 10s) are more suspicious
      if (readDurationSeconds < 10) {
        flagReason = 'instant_read';
      } else if (readDurationSeconds < minimumTime / 2) {
        flagReason = 'speed_read';
      } else {
        flagReason = 'fast_read';
      }
    }
    
    // INSERT ONLY - fire and forget pattern for non-blocking
    await prisma.readTelemetry.create({
      data: {
        user_id: userId,
        series_id: seriesId,
        chapter_number: chapterNumber,
        read_duration_s: readDurationSeconds,
        page_count: pageCount ?? null,
        flagged,
        flag_reason: flagReason,
        device_id: deviceId ?? null,
      },
    });
    
    return {
      recorded: true,
      flagged,
      flagReason: flagReason ?? undefined,
    };
  } catch (error) {
    // NEVER block reads due to telemetry failures
    console.error('[TELEMETRY] Failed to record read telemetry:', error);
    return {
      recorded: false,
      flagged: false,
    };
  }
}

/**
 * Records read telemetry asynchronously (fire and forget)
 * Use this when you don't need to wait for the result
 * 
 * @param data - Telemetry data to record
 */
export function recordReadTelemetryAsync(data: TelemetryData): void {
  // Fire and forget - don't await, don't block
  recordReadTelemetry(data).catch((error) => {
    console.error('[TELEMETRY] Async telemetry recording failed:', error);
  });
}

/**
 * Batch record multiple telemetry events (for bulk operations)
 * Still INSERT ONLY, just more efficient for multiple records
 * 
 * @param records - Array of telemetry data to record
 * @returns Number of records successfully inserted
 */
export async function recordReadTelemetryBatch(records: TelemetryData[]): Promise<number> {
  try {
    const telemetryRecords = records.map(data => {
      const minimumTime = calculateMinimumReadTime(data.pageCount);
      const flagged = data.readDurationSeconds < minimumTime;
      
      let flagReason: string | null = null;
      if (flagged) {
        if (data.readDurationSeconds < 10) {
          flagReason = 'instant_read';
        } else if (data.readDurationSeconds < minimumTime / 2) {
          flagReason = 'speed_read';
        } else {
          flagReason = 'fast_read';
        }
      }
      
      return {
        user_id: data.userId,
        series_id: data.seriesId,
        chapter_number: data.chapterNumber,
        read_duration_s: data.readDurationSeconds,
        page_count: data.pageCount ?? null,
        flagged,
        flag_reason: flagReason,
        device_id: data.deviceId ?? null,
      };
    });
    
    const result = await prisma.readTelemetry.createMany({
      data: telemetryRecords,
      skipDuplicates: true,
    });
    
    return result.count;
  } catch (error) {
    console.error('[TELEMETRY] Batch telemetry recording failed:', error);
    return 0;
  }
}

/**
 * Gets telemetry statistics for a user (for admin/analytics dashboards)
 * READ ONLY - no mutations
 * 
 * @param userId - User to get stats for
 * @param days - Number of days to look back (default 30)
 */
export async function getUserTelemetryStats(userId: string, days: number = 30): Promise<{
  totalReads: number;
  flaggedReads: number;
  flaggedPercentage: number;
  averageReadTime: number;
  flagReasons: Record<string, number>;
}> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const [stats, flaggedStats] = await Promise.all([
    prisma.readTelemetry.aggregate({
      where: {
        user_id: userId,
        created_at: { gte: since },
      },
      _count: true,
      _avg: { read_duration_s: true },
    }),
    prisma.readTelemetry.groupBy({
      by: ['flag_reason'],
      where: {
        user_id: userId,
        created_at: { gte: since },
        flagged: true,
      },
      _count: true,
    }),
  ]);
  
  const totalReads = stats._count;
  const averageReadTime = stats._avg.read_duration_s ?? 0;
  
  const flagReasons: Record<string, number> = {};
  let flaggedReads = 0;
  
  for (const stat of flaggedStats) {
    const reason = stat.flag_reason ?? 'unknown';
    flagReasons[reason] = stat._count;
    flaggedReads += stat._count;
  }
  
  // Round to 2 decimal places to avoid floating-point precision issues
  const flaggedPercentage = totalReads > 0 
    ? Math.round((flaggedReads / totalReads) * 10000) / 100 
    : 0;
  
  return {
    totalReads,
    flaggedReads,
    flaggedPercentage,
    averageReadTime,
    flagReasons,
  };
}

/**
 * Prunes old telemetry records (for scheduled cleanup)
 * Keeps only records from the last 90 days
 * 
 * @param retentionDays - Number of days to retain (default 90)
 * @returns Number of records deleted
 */
export async function pruneOldTelemetry(retentionDays: number = 90): Promise<number> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  
  const result = await prisma.readTelemetry.deleteMany({
    where: {
      created_at: { lt: cutoff },
    },
  });
  
  console.log(`[TELEMETRY] Pruned ${result.count} records older than ${retentionDays} days`);
  return result.count;
}
