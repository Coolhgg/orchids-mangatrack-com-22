import { prisma } from '@/lib/prisma';
import { runTierDemotionCheck, refreshActivityScore } from '@/lib/catalog-tiers';
import { logger } from '@/lib/logger';

/**
 * Periodically check for stale series and demote their tiers.
 * Also refreshes popularity ranks and activity scores for Tier A series.
 */
export async function runTierMaintenanceScheduler() {
  logger.info('[TierMaintenance] Starting maintenance run...');
  
  try {
    await runTierDemotionCheck();
    
    const staleTierA = await prisma.series.findMany({
      where: {
        catalog_tier: 'A',
        updated_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      },
      select: { id: true },
      take: 100
    });
    
    logger.info(`[TierMaintenance] Refreshing activity scores for ${staleTierA.length} Tier A series`);
    
    for (const series of staleTierA) {
      await refreshActivityScore(series.id);
    }
    
    logger.info('[TierMaintenance] Maintenance run complete.');
  } catch (error) {
    logger.error('[TierMaintenance] Maintenance run failed:', { error: error instanceof Error ? error.message : String(error) });
  }
}
