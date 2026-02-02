#!/usr/bin/env npx ts-node

/**
 * DLQ Backlog Resolution Script
 * 
 * Analyzes and resolves the DLQ (Dead Letter Queue) backlog by:
 * 1. Grouping failures by error pattern
 * 2. Auto-resolving known transient errors (rate limits, timeouts)
 * 3. Pruning old resolved failures
 * 4. Providing a summary of remaining issues
 * 
 * Usage:
 *   npx ts-node scripts/resolve-dlq-backlog.ts [--dry-run] [--auto-resolve] [--prune-days=30]
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Known transient error patterns that can be auto-resolved
const TRANSIENT_ERROR_PATTERNS = [
  // Concurrency/capacity limits (transient - will succeed on retry)
  /concurrency.?limit/i,
  /capacity.?limit/i,
  /queue.?full/i,
  // Rate limiting
  /rate.?limit/i,
  /429/,
  /too many requests/i,
  // Network timeouts
  /timeout/i,
  /ETIMEDOUT/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  // Temporary unavailability
  /503/,
  /502/,
  /temporarily unavailable/i,
  // DNS issues (transient)
  /ENOTFOUND/i,
  /getaddrinfo/i,
  // SSL/TLS transient
  /CERT_HAS_EXPIRED/i,
  // Circuit breaker
  /circuit.?breaker/i,
  /breaker.?open/i,
];

// Permanent errors that should NOT be auto-resolved
const PERMANENT_ERROR_PATTERNS = [
  /not found/i,
  /404/,
  /unauthorized/i,
  /403/,
  /invalid.*id/i,
  /does not exist/i,
];

interface DLQAnalysis {
  total: number;
  byQueue: Record<string, number>;
  byErrorPattern: Record<string, { count: number; isTransient: boolean; sample: string }>;
  oldestUnresolved: Date | null;
  transientCount: number;
  permanentCount: number;
  unknownCount: number;
}

async function analyzeDLQ(): Promise<DLQAnalysis> {
  const failures = await prisma.workerFailure.findMany({
    where: { resolved_at: null },
    orderBy: { created_at: 'asc' },
  });

  const analysis: DLQAnalysis = {
    total: failures.length,
    byQueue: {},
    byErrorPattern: {},
    oldestUnresolved: failures.length > 0 ? failures[0].created_at : null,
    transientCount: 0,
    permanentCount: 0,
    unknownCount: 0,
  };

  for (const failure of failures) {
    // Count by queue
    analysis.byQueue[failure.queue_name] = (analysis.byQueue[failure.queue_name] || 0) + 1;

    // Categorize error
    const errorMsg = failure.error_message || 'Unknown error';
    const errorPattern = errorMsg.slice(0, 80); // Truncate for grouping
    
    if (!analysis.byErrorPattern[errorPattern]) {
      const isTransient = TRANSIENT_ERROR_PATTERNS.some(p => p.test(errorMsg));
      const isPermanent = PERMANENT_ERROR_PATTERNS.some(p => p.test(errorMsg));
      
      analysis.byErrorPattern[errorPattern] = {
        count: 0,
        isTransient: isTransient && !isPermanent,
        sample: errorMsg.slice(0, 200),
      };
    }
    
    analysis.byErrorPattern[errorPattern].count++;
    
    // Tally categories
    const pattern = analysis.byErrorPattern[errorPattern];
    if (pattern.isTransient) {
      analysis.transientCount++;
    } else if (PERMANENT_ERROR_PATTERNS.some(p => p.test(errorMsg))) {
      analysis.permanentCount++;
    } else {
      analysis.unknownCount++;
    }
  }

  return analysis;
}

async function autoResolveTransient(dryRun: boolean): Promise<number> {
  const failures = await prisma.workerFailure.findMany({
    where: { resolved_at: null },
  });

  let resolvedCount = 0;
  const toResolve: string[] = [];

  for (const failure of failures) {
    const errorMsg = failure.error_message || '';
    const isTransient = TRANSIENT_ERROR_PATTERNS.some(p => p.test(errorMsg));
    const isPermanent = PERMANENT_ERROR_PATTERNS.some(p => p.test(errorMsg));
    
    if (isTransient && !isPermanent) {
      toResolve.push(failure.id);
      resolvedCount++;
    }
  }

  if (!dryRun && toResolve.length > 0) {
    await prisma.workerFailure.updateMany({
      where: { id: { in: toResolve } },
      data: { resolved_at: new Date() },
    });
    console.log(`✅ Auto-resolved ${resolvedCount} transient failures`);
  } else if (dryRun) {
    console.log(`🔍 Would auto-resolve ${resolvedCount} transient failures (dry-run)`);
  }

  return resolvedCount;
}

async function pruneOldResolved(days: number, dryRun: boolean): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - days);

  const oldResolved = await prisma.workerFailure.count({
    where: {
      resolved_at: { lt: cutoffDate },
    },
  });

  if (!dryRun && oldResolved > 0) {
    const result = await prisma.workerFailure.deleteMany({
      where: {
        resolved_at: { lt: cutoffDate },
      },
    });
    console.log(`🗑️  Pruned ${result.count} resolved failures older than ${days} days`);
    return result.count;
  } else if (dryRun) {
    console.log(`🔍 Would prune ${oldResolved} resolved failures older than ${days} days (dry-run)`);
  }

  return oldResolved;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const autoResolve = args.includes('--auto-resolve');
  const pruneDaysArg = args.find(a => a.startsWith('--prune-days='));
  const pruneDays = pruneDaysArg ? parseInt(pruneDaysArg.split('=')[1]) : 30;

  console.log('\n📊 DLQ Backlog Analysis');
  console.log('========================\n');

  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  }

  // Step 1: Analyze
  const analysis = await analyzeDLQ();

  console.log(`Total unresolved failures: ${analysis.total}`);
  console.log(`Oldest unresolved: ${analysis.oldestUnresolved?.toISOString() || 'N/A'}`);
  console.log(`\nBreakdown by category:`);
  console.log(`  - Transient (auto-resolvable): ${analysis.transientCount}`);
  console.log(`  - Permanent (needs review): ${analysis.permanentCount}`);
  console.log(`  - Unknown: ${analysis.unknownCount}`);

  console.log(`\nBy queue:`);
  for (const [queue, count] of Object.entries(analysis.byQueue).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${queue}: ${count}`);
  }

  console.log(`\nTop error patterns:`);
  const sortedPatterns = Object.entries(analysis.byErrorPattern)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 10);
  
  for (const [pattern, data] of sortedPatterns) {
    const tag = data.isTransient ? '🔄 TRANSIENT' : '❌ REVIEW';
    console.log(`  [${tag}] (${data.count}x) ${pattern}`);
  }

  // Step 2: Auto-resolve transient errors if requested
  if (autoResolve || args.includes('--resolve')) {
    console.log('\n📝 Auto-resolving transient errors...');
    await autoResolveTransient(dryRun);
  }

  // Step 3: Prune old resolved failures
  if (args.includes('--prune') || pruneDaysArg) {
    console.log(`\n🗑️  Pruning resolved failures older than ${pruneDays} days...`);
    await pruneOldResolved(pruneDays, dryRun);
  }

  // Step 4: Final status
  const finalCount = await prisma.workerFailure.count({
    where: { resolved_at: null },
  });

  console.log('\n📈 Final Status');
  console.log('================');
  console.log(`Remaining unresolved: ${finalCount}`);
  
  if (finalCount >= 200) {
    console.log('⚠️  WARNING: DLQ count still exceeds threshold (200)');
    console.log('   Consider reviewing permanent errors manually via /api/admin/dlq');
  } else if (finalCount >= 50) {
    console.log('⚠️  DLQ count above warning threshold (50)');
  } else {
    console.log('✅ DLQ count is healthy');
  }

  console.log('\n');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('Error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
