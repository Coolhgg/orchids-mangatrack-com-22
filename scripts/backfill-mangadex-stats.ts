#!/usr/bin/env bun
/**
 * Backfill MangaDex Statistics
 * 
 * One-time CLI script to populate total_follows and average_rating for all
 * existing series that have a mangadex_id but missing or stale stats.
 * 
 * Usage:
 *   bun run scripts/backfill-mangadex-stats.ts [options]
 * 
 * Options:
 *   --batch-size=N   Number of series per batch (default: 100)
 *   --ttl-days=N     Only refresh stats older than N days (default: 7)
 *   --dry-run        Print what would be updated without making changes
 *   --force          Ignore TTL, refresh all series with mangadex_id
 * 
 * Examples:
 *   bun run scripts/backfill-mangadex-stats.ts --dry-run
 *   bun run scripts/backfill-mangadex-stats.ts --batch-size=50 --ttl-days=30
 *   bun run scripts/backfill-mangadex-stats.ts --force
 */

import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { MangaDexStatsClient, RateLimitError } from '../src/lib/mangadex/stats';

interface BackfillOptions {
  batchSize: number;
  ttlDays: number;
  dryRun: boolean;
  force: boolean;
}

function parseArgs(): BackfillOptions {
  const args = process.argv.slice(2);
  const options: BackfillOptions = {
    batchSize: 100,
    ttlDays: 7,
    dryRun: false,
    force: false,
  };

  for (const arg of args) {
    if (arg.startsWith('--batch-size=')) {
      options.batchSize = parseInt(arg.split('=')[1], 10);
    } else if (arg.startsWith('--ttl-days=')) {
      options.ttlDays = parseInt(arg.split('=')[1], 10);
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Backfill MangaDex Statistics

Usage:
  bun run scripts/backfill-mangadex-stats.ts [options]

Options:
  --batch-size=N   Number of series per batch (default: 100)
  --ttl-days=N     Only refresh stats older than N days (default: 7)
  --dry-run        Print what would be updated without making changes
  --force          Ignore TTL, refresh all series with mangadex_id
`);
      process.exit(0);
    }
  }

  return options;
}

async function main() {
  const options = parseArgs();
  
  console.log('=== MangaDex Stats Backfill ===');
  console.log(`Options: batch=${options.batchSize}, ttl=${options.ttlDays}d, dryRun=${options.dryRun}, force=${options.force}`);
  console.log('');

  const statsClient = new MangaDexStatsClient();

  const ttlCutoff = new Date();
  ttlCutoff.setDate(ttlCutoff.getDate() - options.ttlDays);

  let cursor: string | undefined;
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalFailed = 0;
  let batchNumber = 0;

  while (true) {
    batchNumber++;
    
    const whereClause = options.force
      ? { mangadex_id: { not: null } }
      : {
          mangadex_id: { not: null },
          OR: [
            { stats_last_fetched_at: null },
            { stats_last_fetched_at: { lt: ttlCutoff } },
          ],
        };

    const series = await prisma.series.findMany({
      where: whereClause,
      select: {
        id: true,
        mangadex_id: true,
        title: true,
        total_follows: true,
        average_rating: true,
        stats_last_fetched_at: true,
      },
      orderBy: { id: 'asc' },
      take: options.batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });

    if (series.length === 0) {
      console.log('\nNo more series to process.');
      break;
    }

    console.log(`\n[Batch ${batchNumber}] Processing ${series.length} series...`);

    const mangadexIds = series
      .map(s => s.mangadex_id)
      .filter((id): id is string => id !== null);

    if (options.dryRun) {
      console.log(`  [DRY RUN] Would fetch stats for ${mangadexIds.length} MangaDex IDs`);
      for (const s of series) {
        console.log(`    - ${s.title?.slice(0, 50)}... (mangadex_id: ${s.mangadex_id})`);
      }
      totalProcessed += series.length;
      cursor = series[series.length - 1].id;
      continue;
    }

    try {
      const statsMap = await statsClient.getStatisticsBatch(mangadexIds);

      for (const s of series) {
        if (!s.mangadex_id) continue;

        const stats = statsMap.get(s.mangadex_id);
        if (!stats) {
          console.log(`  [SKIP] ${s.title?.slice(0, 40)}... - no stats returned`);
          totalFailed++;
          continue;
        }

        await prisma.series.update({
          where: { id: s.id },
          data: {
            total_follows: stats.follows,
            average_rating: stats.rating,
            stats_last_fetched_at: new Date(),
          },
        });

        console.log(`  [OK] ${s.title?.slice(0, 40)}... - follows: ${stats.follows}, rating: ${stats.rating ?? 'N/A'}`);
        totalUpdated++;
      }

      totalProcessed += series.length;
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.error(`  [RATE LIMITED] Waiting ${error.retryAfter || 60}s before resuming...`);
        await new Promise(resolve => setTimeout(resolve, (error.retryAfter || 60) * 1000));
        continue;
      }

      console.error(`  [ERROR] Batch failed:`, error);
      totalFailed += series.length;
      totalProcessed += series.length;
    }

    cursor = series[series.length - 1].id;

    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.log('\n=== Backfill Complete ===');
  console.log(`Total processed: ${totalProcessed}`);
  console.log(`Total updated: ${totalUpdated}`);
  console.log(`Total failed: ${totalFailed}`);

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(error => {
  console.error('Fatal error:', error);
  prisma.$disconnect().finally(() => process.exit(1));
});
