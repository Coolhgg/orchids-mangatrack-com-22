# Monitoring & Alerts: Stats Pipeline and Search

## Metrics to Export

### 1. MangaDex Stats Fetch Metrics
```typescript
// Prometheus-style metrics (use prom-client or custom counters)

// Success counter - increment on successful batch fetch
mangadex_stats_fetch_success_count{tier="A"|"B"|"C"}

// Failure counter - increment on fetch failure  
mangadex_stats_fetch_failure_count{tier="A"|"B"|"C", error_type="rate_limit"|"server_error"|"network"}

// Rate limit counter - increment on 429 response
mangadex_stats_fetch_rate_limited_count

// Histogram for fetch duration
mangadex_stats_fetch_duration_seconds{tier="A"|"B"|"C"}

// Gauge for queue depth
mangadex_stats_queue_waiting_jobs
mangadex_stats_queue_active_jobs
```

### 2. Search Performance Metrics
```typescript
// Search latency histogram
search_query_duration_seconds{has_results="true"|"false"}

// Search result counts
search_results_count{safe_mode="sfw"|"nsfw"}

// External search triggers
search_external_trigger_count
```

## Alert Rules (Prometheus/Alertmanager Format)

### Critical Alerts

```yaml
# Alert: High failure rate
- alert: MangaDexStatsFetchHighFailures
  expr: |
    increase(mangadex_stats_fetch_failure_count[1h]) > 50
  for: 5m
  labels:
    severity: critical
  annotations:
    summary: "MangaDex stats fetch failure rate too high"
    description: "More than 50 fetch failures in the last hour"

# Alert: Rate limit threshold
- alert: MangaDexStatsRateLimited
  expr: |
    increase(mangadex_stats_fetch_rate_limited_count[15m]) > 10
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: "MangaDex API rate limit being hit frequently"
    description: "More than 10 rate limits in 15 minutes - reduce request frequency"

# Alert: Queue backlog growing
- alert: MangaDexStatsQueueBacklog
  expr: |
    mangadex_stats_queue_waiting_jobs > 500
  for: 30m
  labels:
    severity: warning
  annotations:
    summary: "Stats refresh queue backlog is growing"
    description: "Queue has {{ $value }} waiting jobs, processing may be stalled"
```

### Warning Alerts

```yaml
# Alert: No recent stats updates
- alert: MangaDexStatsStale
  expr: |
    time() - max(mangadex_stats_last_fetch_timestamp) > 3600
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: "No MangaDex stats fetched in over 1 hour"
    description: "Stats pipeline may be stalled"

# Alert: Search latency degraded
- alert: SearchLatencyHigh
  expr: |
    histogram_quantile(0.95, rate(search_query_duration_seconds_bucket[5m])) > 2
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: "Search p95 latency above 2 seconds"
    description: "Search performance degraded, check database indexes"
```

## Structured Logging

### Required Log Fields

```typescript
// Stats fetch logs
logger.info('[MangaDexStats] Batch fetch completed', {
  seriesId: string[],           // Array of series IDs in batch
  batchId: string,              // Unique batch identifier
  tier: 'A' | 'B' | 'C',        // Priority tier
  batchSize: number,            // Number of IDs in batch
  successCount: number,         // Successfully fetched
  failCount: number,            // Failed to fetch
  durationMs: number,           // Total batch duration
  rateLimitHits: number,        // 429s encountered
});

// Stats update logs
logger.info('[MangaDexStats] Database updated', {
  seriesId: string,
  mangadexId: string,
  previousFollows: number,
  newFollows: number,
  previousRating: number | null,
  newRating: number | null,
  durationMs: number,
});

// Error logs
logger.error('[MangaDexStats] Fetch failed', {
  seriesId: string[],
  batchId: string,
  tier: 'A' | 'B' | 'C',
  errorType: 'rate_limit' | 'server_error' | 'network' | 'unknown',
  statusCode: number,
  retryAfter: number,           // Retry-After header if present
  attempt: number,
  maxAttempts: number,
  errorMessage: string,
});

// Search logs
logger.info('[Search] Query executed', {
  query: string,
  normalizedQuery: string,
  safeBrowsingMode: 'sfw' | 'questionable' | 'nsfw',
  resultCount: number,
  hasExactMatch: boolean,
  externalSearchTriggered: boolean,
  durationMs: number,
});
```

## Dashboard Panels (Grafana)

### Stats Pipeline Dashboard

1. **Fetch Success Rate** (time series)
   - `sum(rate(mangadex_stats_fetch_success_count[5m])) / sum(rate(mangadex_stats_fetch_success_count[5m]) + rate(mangadex_stats_fetch_failure_count[5m]))`

2. **Rate Limit Events** (bar chart)
   - `increase(mangadex_stats_fetch_rate_limited_count[1h])`

3. **Queue Depth** (gauge)
   - `mangadex_stats_queue_waiting_jobs + mangadex_stats_queue_active_jobs`

4. **Fetch Duration p95** (time series)
   - `histogram_quantile(0.95, rate(mangadex_stats_fetch_duration_seconds_bucket[5m]))`

### Search Performance Dashboard

1. **Search Latency p50/p95/p99** (time series)
2. **Results per Query** (histogram)
3. **External Search Triggers** (counter)
4. **Zero-Result Searches** (percentage)

## Implementation Snippet

```typescript
// src/lib/metrics.ts
import { Counter, Histogram, Gauge } from 'prom-client';

export const statsMetrics = {
  fetchSuccess: new Counter({
    name: 'mangadex_stats_fetch_success_count',
    help: 'Number of successful stats fetches',
    labelNames: ['tier'],
  }),
  
  fetchFailure: new Counter({
    name: 'mangadex_stats_fetch_failure_count', 
    help: 'Number of failed stats fetches',
    labelNames: ['tier', 'error_type'],
  }),
  
  rateLimited: new Counter({
    name: 'mangadex_stats_fetch_rate_limited_count',
    help: 'Number of 429 rate limit responses',
  }),
  
  fetchDuration: new Histogram({
    name: 'mangadex_stats_fetch_duration_seconds',
    help: 'Stats fetch duration in seconds',
    labelNames: ['tier'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
  }),
  
  queueWaiting: new Gauge({
    name: 'mangadex_stats_queue_waiting_jobs',
    help: 'Number of jobs waiting in stats queue',
  }),
};
```
