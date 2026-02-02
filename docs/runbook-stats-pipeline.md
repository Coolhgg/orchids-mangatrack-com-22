# Stats Pipeline & Search Ranking Runbook

## Overview

This runbook provides step-by-step commands for operating the MangaDex stats ingestion pipeline, search ranking verification, and monitoring.

---

## 1. Run Stats Backfill (Initial Population)

Backfill all series with MangaDex IDs that have never had stats fetched.

```bash
# Option A: Trigger via scheduler (recommended - respects rate limits)
bun run scripts/qa/smoke_stats_and_search.ts --wait 30

# Option B: Direct API call to trigger scheduler
curl -X POST http://localhost:3000/api/admin/trigger-stats-refresh \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# Option C: Run scheduler function directly via Node REPL
bun -e "
const { runMangadexStatsRefreshScheduler } = require('./src/workers/schedulers/mangadex-stats-refresh.scheduler');
runMangadexStatsRefreshScheduler().then(() => console.log('Done')).catch(console.error);
"
```

### Check Backfill Progress

```bash
# Check how many series still need stats
bun -e "
const { prisma } = require('./src/lib/prisma');
async function check() {
  const neverFetched = await prisma.series.count({
    where: { mangadex_id: { not: null }, stats_last_fetched_at: null }
  });
  const totalWithMd = await prisma.series.count({
    where: { mangadex_id: { not: null } }
  });
  const withStats = await prisma.series.count({
    where: { mangadex_id: { not: null }, stats_last_fetched_at: { not: null } }
  });
  console.log('Never fetched:', neverFetched);
  console.log('With stats:', withStats, '/', totalWithMd);
  console.log('Coverage:', Math.round(withStats / totalWithMd * 100) + '%');
  await prisma.\$disconnect();
}
check();
"
```

---

## 2. Start Stats Refresh Job (Recurring)

The stats refresh runs automatically via BullMQ repeatable job. To verify or manually start:

```bash
# Check if repeatable job is registered
bun -e "
const { mangadexStatsRefreshQueue } = require('./src/lib/queues');
mangadexStatsRefreshQueue.getRepeatableJobs().then(jobs => {
  console.log('Repeatable jobs:', jobs.length);
  jobs.forEach(j => console.log(' -', j.name, j.pattern || j.every + 'ms'));
});
"

# Register repeatable job (if not already registered)
bun -e "
const { mangadexStatsRefreshQueue } = require('./src/lib/queues');
mangadexStatsRefreshQueue.add(
  'stats-refresh-repeatable',
  {},
  {
    repeat: { pattern: '*/15 * * * *' }, // Every 15 minutes
    jobId: 'stats-refresh-repeatable',
  }
).then(() => console.log('Repeatable job registered'));
"

# Start worker process (if not running via pm2)
bun run src/workers/index.ts
```

---

## 3. Run Smoke Test

Verify the entire pipeline is working correctly:

```bash
# Full smoke test with 30s wait
bun run scripts/qa/smoke_stats_and_search.ts --wait 30

# Quick smoke test (skip scheduler, just check data)
bun run scripts/qa/smoke_stats_and_search.ts --skip-scheduler

# Custom search query test
bun run scripts/qa/smoke_stats_and_search.ts --query "Naruto"

# Run Jest tests
npm test -- src/__tests__/unit/mangadex-stats-client.test.ts
npm test -- src/__tests__/integration/stats-enrichment-worker.test.ts
npm test -- src/__tests__/qa/search-ranking-sql.test.ts

# Run all QA tests
npm test -- --testPathPattern="(unit|integration|qa).*stats|search"
```

---

## 4. Check Logs for Success

### Worker Logs (pm2)

```bash
# View recent worker logs
pm2 logs workers --lines 100

# Filter for stats-related logs
pm2 logs workers --lines 500 | grep -E "\[MangaDexStats\]|\[MangaDexStatsScheduler\]"

# Watch live logs
pm2 logs workers --lines 0 | grep --line-buffered "MangaDex"
```

### BullMQ Queue Status

```bash
# Check queue health
bun -e "
const { mangadexStatsRefreshQueue } = require('./src/lib/queues');
async function status() {
  const counts = await mangadexStatsRefreshQueue.getJobCounts();
  console.log('Queue counts:', counts);
  
  const failed = await mangadexStatsRefreshQueue.getFailed(0, 5);
  if (failed.length > 0) {
    console.log('Recent failures:');
    failed.forEach(j => console.log(' -', j.id, j.failedReason));
  }
}
status();
"

# Clear failed jobs (if needed)
bun -e "
const { mangadexStatsRefreshQueue } = require('./src/lib/queues');
mangadexStatsRefreshQueue.clean(0, 1000, 'failed').then(removed => {
  console.log('Removed', removed.length, 'failed jobs');
});
"
```

### Database Verification

```bash
# Check stats data quality
bun -e "
const { prisma } = require('./src/lib/prisma');
async function verify() {
  // Recent stats
  const recent = await prisma.series.count({
    where: { stats_last_fetched_at: { gte: new Date(Date.now() - 3600000) } }
  });
  console.log('Stats fetched in last hour:', recent);
  
  // Top by follows
  const top = await prisma.series.findMany({
    where: { total_follows: { gt: 0 } },
    select: { title: true, total_follows: true, average_rating: true },
    orderBy: { total_follows: 'desc' },
    take: 5,
  });
  console.log('Top 5 by follows:');
  top.forEach(s => console.log(' -', s.title, ':', s.total_follows, 'follows'));
  
  await prisma.\$disconnect();
}
verify();
"
```

---

## 5. Monitoring Alerts

### Key Metrics to Monitor

| Metric | Threshold | Action |
|--------|-----------|--------|
| `mangadex.stats.fetch.failure_count` | > 50/hour | Check MangaDex API status |
| `mangadex.stats.fetch.rate_limited_count` | > 10/15min | Reduce batch size |
| Queue waiting jobs | > 500 for 30min | Check worker health |
| Stats coverage | < 80% | Run backfill |

### Alert Queries (Prometheus)

```promql
# High failure rate
increase(mangadex_stats_fetch_failure_count[1h]) > 50

# Rate limiting
increase(mangadex_stats_fetch_rate_limited_count[15m]) > 10

# Queue backlog
mangadex_stats_queue_waiting_jobs > 500
```

---

## 6. Troubleshooting

### Issue: Stats not being fetched

```bash
# 1. Check worker is running
pm2 status workers

# 2. Check Redis connection
bun -e "const { redisWorker } = require('./src/lib/redis'); redisWorker.ping().then(console.log);"

# 3. Check queue has jobs
bun -e "
const { mangadexStatsRefreshQueue } = require('./src/lib/queues');
mangadexStatsRefreshQueue.getJobCounts().then(console.log);
"

# 4. Check for rate limiting
pm2 logs workers --lines 200 | grep "429"
```

### Issue: Search ranking incorrect

```bash
# 1. Run SQL test
npm test -- src/__tests__/qa/search-ranking-sql.test.ts

# 2. Check search query directly
curl "http://localhost:3000/api/series/search?q=One+Piece&limit=5" | jq '.results[:3] | .[] | {title, total_follows, best_match_score}'

# 3. Verify pg_trgm extension
bun -e "
const { prisma } = require('./src/lib/prisma');
prisma.\$queryRaw\`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm'\`.then(console.log);
"
```

### Issue: Deduplication not working

```bash
# Check canonical_series_id population
bun -e "
const { prisma } = require('./src/lib/prisma');
prisma.series.count({ where: { canonical_series_id: { not: null } } }).then(c => {
  console.log('Series with canonical_series_id:', c);
});
"
```

---

## Quick Reference

| Task | Command |
|------|---------|
| Trigger stats refresh | `bun run scripts/qa/smoke_stats_and_search.ts` |
| Check stats coverage | See "Check Backfill Progress" above |
| Run unit tests | `npm test -- mangadex-stats-client.test.ts` |
| Run integration tests | `npm test -- stats-enrichment-worker.test.ts` |
| Run SQL tests | `npm test -- search-ranking-sql.test.ts` |
| View worker logs | `pm2 logs workers --lines 100` |
| Check queue status | See "BullMQ Queue Status" above |
