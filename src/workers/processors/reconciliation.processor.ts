import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { isFeatureEnabled } from '@/lib/config/feature-flags';

export interface ReconciliationResult {
  checked: number;
  issues: ReconciliationIssue[];
  fixed: number;
  timestamp: Date;
}

export interface ReconciliationIssue {
  type: 'orphaned_entry' | 'missing_series' | 'stale_sync' | 'invalid_status' | 'soft_delete_leak';
  entryId: string;
  details: string;
  severity: 'low' | 'medium' | 'high';
  autoFixed: boolean;
}

const STALE_SYNC_THRESHOLD_DAYS = 7;
const BATCH_SIZE = 100;

export async function runReconciliation(): Promise<ReconciliationResult> {
  if (!isFeatureEnabled('reconciliation_jobs')) {
    logger.info('[Reconciliation] Feature disabled, skipping');
    return { checked: 0, issues: [], fixed: 0, timestamp: new Date() };
  }

  const result: ReconciliationResult = {
    checked: 0,
    issues: [],
    fixed: 0,
    timestamp: new Date(),
  };

  try {
    await checkOrphanedEntries(result);
    await checkMissingSeries(result);
    await checkStaleSyncs(result);
    await checkInvalidStatuses(result);
    await checkSoftDeleteLeaks(result);

    logger.info(`[Reconciliation] Complete: ${result.checked} checked, ${result.issues.length} issues, ${result.fixed} fixed`);
  } catch (err) {
    logger.error('[Reconciliation] Failed', { error: err instanceof Error ? err.message : String(err) });
  }

  return result;
}

async function checkOrphanedEntries(result: ReconciliationResult): Promise<void> {
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const entries = await prisma.$queryRaw<Array<{ id: string; series_id: string | null }>>`
      SELECT le.id, le.series_id 
      FROM library_entries le
      LEFT JOIN series s ON le.series_id = s.id
      WHERE le.deleted_at IS NULL 
        AND le.series_id IS NOT NULL 
        AND s.id IS NULL
      LIMIT ${BATCH_SIZE} OFFSET ${offset}
    `;

    result.checked += entries.length;

    for (const entry of entries) {
      result.issues.push({
        type: 'orphaned_entry',
        entryId: entry.id,
        details: `Library entry references non-existent series ${entry.series_id}`,
        severity: 'high',
        autoFixed: false,
      });
    }

    hasMore = entries.length === BATCH_SIZE;
    offset += BATCH_SIZE;
  }
}

async function checkMissingSeries(result: ReconciliationResult): Promise<void> {
  const entriesWithoutSeries = await prisma.libraryEntry.count({
    where: {
      deleted_at: null,
      series_id: null,
      metadata_status: 'enriched',
    },
  });

  if (entriesWithoutSeries > 0) {
    const samples = await prisma.libraryEntry.findMany({
      where: {
        deleted_at: null,
        series_id: null,
        metadata_status: 'enriched',
      },
      take: 10,
      select: { id: true },
    });

    for (const sample of samples) {
      result.issues.push({
        type: 'missing_series',
        entryId: sample.id,
        details: `Entry marked as enriched but has no series_id`,
        severity: 'medium',
        autoFixed: false,
      });
    }

    result.checked += entriesWithoutSeries;
  }
}

async function checkStaleSyncs(result: ReconciliationResult): Promise<void> {
  const staleThreshold = new Date();
  staleThreshold.setDate(staleThreshold.getDate() - STALE_SYNC_THRESHOLD_DAYS);

  const staleEntries = await prisma.libraryEntry.findMany({
    where: {
      deleted_at: null,
      sync_status: 'healthy',
      last_sync_at: {
        lt: staleThreshold,
      },
    },
    take: 50,
    select: { id: true, last_sync_at: true },
  });

  result.checked += staleEntries.length;

  for (const entry of staleEntries) {
    const daysSinceSync = entry.last_sync_at 
      ? Math.floor((Date.now() - entry.last_sync_at.getTime()) / (1000 * 60 * 60 * 24))
      : 'never';

    result.issues.push({
      type: 'stale_sync',
      entryId: entry.id,
      details: `Entry marked healthy but last sync was ${daysSinceSync} days ago`,
      severity: 'low',
      autoFixed: false,
    });
  }
}

async function checkInvalidStatuses(result: ReconciliationResult): Promise<void> {
  const validStatuses = ['reading', 'completed', 'planning', 'dropped', 'paused'];
  
  const invalidEntries = await prisma.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT id, status 
    FROM library_entries 
    WHERE deleted_at IS NULL 
      AND status NOT IN (${validStatuses.join("','")})
    LIMIT 50
  `;

  result.checked += invalidEntries.length;

  for (const entry of invalidEntries) {
    result.issues.push({
      type: 'invalid_status',
      entryId: entry.id,
      details: `Invalid status value: ${entry.status}`,
      severity: 'medium',
      autoFixed: false,
    });
  }
}

async function checkSoftDeleteLeaks(result: ReconciliationResult): Promise<void> {
  const leakedEntries = await prisma.$queryRaw<Array<{ id: string; series_id: string }>>`
    SELECT le.id, le.series_id
    FROM library_entries le
    JOIN series s ON le.series_id = s.id
    WHERE le.deleted_at IS NULL
      AND s.deleted_at IS NOT NULL
    LIMIT 50
  `;

  result.checked += leakedEntries.length;

  for (const entry of leakedEntries) {
    result.issues.push({
      type: 'soft_delete_leak',
      entryId: entry.id,
      details: `Entry references soft-deleted series ${entry.series_id}`,
      severity: 'medium',
      autoFixed: false,
    });

    try {
      await prisma.libraryEntry.update({
        where: { id: entry.id },
        data: { series_id: null, metadata_status: 'unavailable' },
      });
      result.fixed++;
      result.issues[result.issues.length - 1].autoFixed = true;
    } catch (err) {
      logger.error(`[Reconciliation] Failed to fix soft-delete leak for ${entry.id}`, { 
        error: err instanceof Error ? err.message : String(err) 
      });
    }
  }
}

export async function getReconciliationReport(): Promise<{
  lastRun: Date | null;
  issueCount: number;
  healthScore: number;
}> {
  const recentIssues = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*) as count FROM library_entries
    WHERE deleted_at IS NULL
      AND (
        (metadata_status = 'enriched' AND series_id IS NULL)
        OR sync_status = 'failed'
      )
  `;

  const totalEntries = await prisma.libraryEntry.count({
    where: { deleted_at: null },
  });

  const issueCount = Number(recentIssues[0]?.count || 0);
  const healthScore = totalEntries > 0 
    ? Math.max(0, 100 - (issueCount / totalEntries * 100))
    : 100;

  return {
    lastRun: new Date(),
    issueCount,
    healthScore: Math.round(healthScore * 100) / 100,
  };
}
