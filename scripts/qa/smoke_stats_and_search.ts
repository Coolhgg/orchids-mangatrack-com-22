#!/usr/bin/env npx ts-node
/**
 * Smoke Test Script: Stats Pipeline & Search Ranking
 * =============================================================================
 *
 * This script performs end-to-end smoke tests to verify:
 * 1. Stats refresh scheduler is working (repeatable jobs registered)
 * 2. Stats data is being populated (stats_last_fetched_at is recent)
 * 3. Search ranking returns results with correct ordering
 * 4. Deduplication by canonical_series_id is working
 *
 * Usage:
 *   npx ts-node scripts/qa/smoke_stats_and_search.ts
 *   # or
 *   bun run scripts/qa/smoke_stats_and_search.ts
 *
 * Options:
 *   --wait <seconds>   Wait time after triggering scheduler (default: 5)
 *   --skip-scheduler   Skip scheduler trigger test
 *   --query <string>   Custom search query (default: "One Piece")
 *
 * Prerequisites:
 *   - Redis running (for BullMQ queues)
 *   - Database accessible
 *   - Environment variables configured (.env)
 */

import { prisma } from '../../src/lib/prisma';
import { mangadexStatsRefreshQueue } from '../../src/lib/queues';
import {
  runMangadexStatsRefreshScheduler,
  getMangadexStatsRefreshStatus,
} from '../../src/workers/schedulers/mangadex-stats-refresh.scheduler';
import { searchSeriesSimple } from '../../src/lib/search/seriesSearch';

// Parse command line arguments
const args = process.argv.slice(2);
const waitTime = parseInt(args[args.indexOf('--wait') + 1] || '5', 10) * 1000;
const skipScheduler = args.includes('--skip-scheduler');
const searchQuery = args[args.indexOf('--query') + 1] || 'One Piece';

// ANSI colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
};

function log(icon: string, message: string, color: string = colors.reset) {
  console.log(`${color}${icon} ${message}${colors.reset}`);
}

function success(message: string) {
  log('✓', message, colors.green);
}

function fail(message: string) {
  log('✗', message, colors.red);
}

function info(message: string) {
  log('ℹ', message, colors.blue);
}

function warn(message: string) {
  log('⚠', message, colors.yellow);
}

function section(title: string) {
  console.log(`\n${colors.bold}${colors.cyan}=== ${title} ===${colors.reset}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test 1: Stats Scheduler
 * - Check for registered repeatable jobs
 * - Trigger scheduler manually
 * - Verify jobs are queued
 */
async function smokeTestStatsScheduler(): Promise<boolean> {
  section('Stats Scheduler Smoke Test');

  if (skipScheduler) {
    info('Skipping scheduler test (--skip-scheduler flag)');
    return true;
  }

  try {
    // Check repeatable jobs
    const repeatableJobs = await mangadexStatsRefreshQueue.getRepeatableJobs();

    if (repeatableJobs.length > 0) {
      success(`Found ${repeatableJobs.length} repeatable job(s) registered`);
      for (const job of repeatableJobs) {
        info(`  - ${job.name || 'stats-refresh'}: ${job.pattern || job.every + 'ms'}`);
      }
    } else {
      warn('No repeatable jobs found. Will trigger scheduler manually...');
    }

    // Get current status before running scheduler
    const statusBefore = await getMangadexStatsRefreshStatus();
    info('Stats refresh status:');
    info(`  - Tier A: ${statusBefore.tierA.stale}/${statusBefore.tierA.total} stale`);
    info(`  - Tier B: ${statusBefore.tierB.stale}/${statusBefore.tierB.total} stale`);
    info(`  - Tier C: ${statusBefore.tierC.stale}/${statusBefore.tierC.total} stale`);
    info(`  - Never fetched: ${statusBefore.neverFetched}`);

    // Trigger scheduler manually
    info('Triggering stats refresh scheduler...');
    await runMangadexStatsRefreshScheduler();
    success('Stats refresh scheduler triggered successfully');

    // Wait for jobs to be processed
    if (waitTime > 0) {
      info(`Waiting ${waitTime / 1000}s for jobs to process...`);
      await sleep(waitTime);
    }

    // Check queue for pending jobs
    const waitingCount = await mangadexStatsRefreshQueue.getWaitingCount();
    const activeCount = await mangadexStatsRefreshQueue.getActiveCount();
    const completedCount = await mangadexStatsRefreshQueue.getCompletedCount();

    info(`Queue status: ${waitingCount} waiting, ${activeCount} active, ${completedCount} completed`);

    if (waitingCount > 0 || activeCount > 0 || completedCount > 0) {
      success('Queue has jobs (waiting, active, or completed)');
    } else if (statusBefore.neverFetched === 0 && statusBefore.tierA.stale === 0) {
      info('No jobs queued (all series are up-to-date)');
    } else {
      warn('No jobs queued but stale series exist - check worker logs');
    }

    return true;
  } catch (error) {
    fail(`Stats scheduler test failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Test 2: Stats Data
 * - Check stats coverage
 * - Verify recent stats_last_fetched_at timestamps
 * - Sample top series by follows
 */
async function smokeTestStatsData(): Promise<boolean> {
  section('Stats Data Smoke Test');

  try {
    // Check how many series have recent stats
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const recentStatsCount = await prisma.series.count({
      where: {
        stats_last_fetched_at: { gte: fiveMinutesAgo },
      },
    });

    const hourlyStatsCount = await prisma.series.count({
      where: {
        stats_last_fetched_at: { gte: oneHourAgo },
      },
    });

    if (recentStatsCount > 0) {
      success(`${recentStatsCount} series have stats fetched in last 5 minutes`);
    } else if (hourlyStatsCount > 0) {
      info(`${hourlyStatsCount} series have stats fetched in last hour`);
    } else {
      warn('No series have stats fetched recently');
    }

    // Check overall stats coverage
    const totalWithMangadexId = await prisma.series.count({
      where: { mangadex_id: { not: null } },
    });

    const totalWithStats = await prisma.series.count({
      where: {
        mangadex_id: { not: null },
        stats_last_fetched_at: { not: null },
      },
    });

    const coverage =
      totalWithMangadexId > 0
        ? Math.round((totalWithStats / totalWithMangadexId) * 100)
        : 0;

    info(`Stats coverage: ${totalWithStats}/${totalWithMangadexId} series (${coverage}%)`);

    // Check for series with populated total_follows
    const withFollows = await prisma.series.count({
      where: {
        mangadex_id: { not: null },
        total_follows: { gt: 0 },
      },
    });

    if (withFollows > 0) {
      success(`${withFollows} series have total_follows > 0`);
    } else {
      warn('No series have total_follows > 0 yet');
    }

    // Sample top series with stats
    const sampleSeries = await prisma.series.findMany({
      where: {
        mangadex_id: { not: null },
        total_follows: { gt: 0 },
      },
      select: {
        title: true,
        total_follows: true,
        average_rating: true,
        stats_last_fetched_at: true,
      },
      orderBy: { total_follows: 'desc' },
      take: 5,
    });

    if (sampleSeries.length > 0) {
      info('Top 5 series by total_follows:');
      for (const series of sampleSeries) {
        const rating = series.average_rating?.toFixed(2) ?? 'N/A';
        const fetched = series.stats_last_fetched_at
          ? new Date(series.stats_last_fetched_at).toISOString()
          : 'never';
        console.log(
          `  ${colors.dim}- ${series.title}: ${series.total_follows?.toLocaleString()} follows, rating: ${rating}, fetched: ${fetched}${colors.reset}`
        );
      }
    }

    return true;
  } catch (error) {
    fail(`Stats data test failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Test 3: Search Ranking
 * - Execute search query
 * - Verify results are ordered by best_match_score DESC
 * - Check exact match boost
 */
async function smokeTestSearch(): Promise<boolean> {
  section('Search Ranking Smoke Test');

  try {
    info(`Searching for: "${searchQuery}"`);

    const results = await searchSeriesSimple(searchQuery, 5, 0, 'sfw');

    if (results.length === 0) {
      warn('No results returned for search query');
      return true; // Not necessarily a failure, just no data
    }

    success(`Found ${results.length} results`);

    // Print top 3 results
    console.log(`\n${colors.bold}Top 3 Results:${colors.reset}`);
    for (let i = 0; i < Math.min(3, results.length); i++) {
      const r = results[i];
      console.log(`  ${colors.cyan}${i + 1}. ${r.title}${colors.reset}`);
      console.log(`     ${colors.dim}- total_follows: ${r.total_follows?.toLocaleString() ?? 0}${colors.reset}`);
      console.log(`     ${colors.dim}- average_rating: ${r.average_rating?.toFixed(2) ?? 'N/A'}${colors.reset}`);
      console.log(`     ${colors.dim}- best_match_score: ${Number(r.best_match_score).toFixed(2)}${colors.reset}`);
      console.log(`     ${colors.dim}- canonical_series_id: ${r.canonical_series_id ?? 'null'}${colors.reset}`);
    }

    // Verify ordering: results should be sorted by best_match_score DESC
    let isCorrectlyOrdered = true;
    for (let i = 1; i < results.length; i++) {
      if (Number(results[i].best_match_score) > Number(results[i - 1].best_match_score)) {
        isCorrectlyOrdered = false;
        warn(`Order violation at index ${i}: ${results[i].best_match_score} > ${results[i - 1].best_match_score}`);
        break;
      }
    }

    if (isCorrectlyOrdered) {
      success('Results are correctly ordered by best_match_score DESC');
    } else {
      fail('Results are NOT correctly ordered');
      return false;
    }

    // Test exact match boost
    const exactMatch = results.find(
      (r) => r.title.toLowerCase() === searchQuery.toLowerCase()
    );
    if (exactMatch && results[0].title.toLowerCase() === searchQuery.toLowerCase()) {
      success('Exact match is ranked first (as expected)');
    } else if (exactMatch) {
      warn('Exact match found but not ranked first');
    } else {
      info('No exact title match found in results');
    }

    return true;
  } catch (error) {
    fail(`Search test failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Test 4: Deduplication
 * - Check for series with canonical_series_id set
 * - Sample canonical relationships
 */
async function smokeTestDeduplication(): Promise<boolean> {
  section('Deduplication Smoke Test');

  try {
    // Check for series with canonical_series_id set
    const withCanonical = await prisma.series.count({
      where: {
        canonical_series_id: { not: null },
      },
    });

    if (withCanonical > 0) {
      success(`${withCanonical} series have canonical_series_id set (deduplication ready)`);

      // Sample some canonical relationships
      const samples = await prisma.series.findMany({
        where: { canonical_series_id: { not: null } },
        select: {
          title: true,
          canonical_series_id: true,
          total_follows: true,
        },
        take: 5,
      });

      info('Sample canonical relationships:');
      for (const s of samples) {
        console.log(
          `  ${colors.dim}- "${s.title}" → canonical: ${s.canonical_series_id}${colors.reset}`
        );
      }
    } else {
      info('No series have canonical_series_id set yet (deduplication not active)');
    }

    // Check mangadex_id-based deduplication (fallback)
    const withMangadexId = await prisma.series.count({
      where: {
        mangadex_id: { not: null },
        canonical_series_id: null,
      },
    });

    info(`${withMangadexId} series use mangadex_id for deduplication (no canonical set)`);

    return true;
  } catch (error) {
    fail(`Deduplication test failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Main entry point
 */
async function main() {
  console.log(
    colors.bold +
      '\n╔════════════════════════════════════════════════════╗\n' +
      '║  MangaTrack Smoke Test: Stats & Search Pipeline    ║\n' +
      '╚════════════════════════════════════════════════════╝' +
      colors.reset
  );

  console.log(`${colors.dim}Options: wait=${waitTime / 1000}s, query="${searchQuery}"${colors.reset}`);

  const results: { name: string; passed: boolean }[] = [];

  // Run all smoke tests
  results.push({
    name: 'Stats Scheduler',
    passed: await smokeTestStatsScheduler(),
  });

  results.push({
    name: 'Stats Data',
    passed: await smokeTestStatsData(),
  });

  results.push({
    name: 'Search Ranking',
    passed: await smokeTestSearch(),
  });

  results.push({
    name: 'Deduplication',
    passed: await smokeTestDeduplication(),
  });

  // Summary
  section('Summary');
  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;

  for (const r of results) {
    if (r.passed) {
      success(`${r.name}: PASSED`);
    } else {
      fail(`${r.name}: FAILED`);
    }
  }

  console.log('');
  if (passedCount === totalCount) {
    log('🎉', `All ${totalCount} tests passed!`, colors.green + colors.bold);
  } else {
    log('⚠️', `${passedCount}/${totalCount} tests passed`, colors.yellow + colors.bold);
  }

  // Cleanup
  await prisma.$disconnect();

  process.exit(passedCount === totalCount ? 0 : 1);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
