# MangaUpdates Integration

## Overview

MangaTrack integrates with the MangaUpdates API V1 to poll latest manga releases and enrich series metadata. The integration uses a poller/worker architecture: the poller fetches recent releases and enqueues metadata jobs, while workers process those jobs with rate limiting and caching to stay within API constraints.

## Endpoints Used

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/releases/search` | POST | Poll latest releases by date range |
| `/v1/series/{id}` | GET | Fetch full series metadata |

## Rate Limit Strategy

- **Default**: 1 request/second enforced via `p-queue` with `intervalCap: 1, interval: 1000`
- **429 Handling**: Parse `Retry-After` header, wait specified duration, then retry
- **Backoff**: Exponential backoff on failures (5s base, doubles per attempt, max 5 retries)
- **Queue Monitoring**: Poller pauses when queue backpressure exceeds 10 pending requests

## Caching Strategy

- **TTL**: 24 hours for series metadata, 15 minutes for release lists
- **Primary**: Redis via `ioredis` (uses existing `redisWorker` connection)
- **Fallback**: In-memory LRU cache (1000 entries max) when Redis unavailable
- **Database Check**: Before fetching, checks `mu_last_fetched_at` to skip recently-fetched series

## Operational Commands

```bash
# Release poller (continuous)
bun run src/workers/mangaupdatesPoller.ts

# Single poll then exit
bun run src/workers/mangaupdatesPoller.ts --once

# Metadata worker
bun run src/workers/mangaupdatesMetadataWorker.ts

# Run database migrations
npx prisma migrate dev --name <migration_name>
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MANGAUPDATES_POLL_INTERVAL_MS` | `900000` | Polling interval (15 min) |
| `MANGAUPDATES_POLL_DAYS` | `7` | Days to look back for releases |
| `MANGAUPDATES_POLL_PAGES` | `3` | Number of pages to poll |

## Failure Modes and Remediation

| Failure | Detection | Remediation |
|---------|-----------|-------------|
| **429 Rate Limit** | `RateLimitError` thrown | Wait `Retry-After` seconds, retry automatically |
| **5xx Server Error** | HTTP status 500-599 | Exponential backoff, max 5 retries, then DLQ |
| **DB Deadlock** | Prisma error code P2034 | Automatic retry with backoff |
| **Redis Unavailable** | Connection timeout | Fallback to in-memory cache, log warning |
| **Series Not Found** | 404 response | Log warning, skip job (no retry) |

### Monitoring

Check worker health via existing admin endpoints:
- `GET /api/admin/queue-health` - Queue depth and processing rate
- `GET /api/admin/metrics` - Worker error rates

## Security & Legal

> **Important**: We use the public MangaUpdates API V1. We cache responses and obey their Terms of Service. We do **not** display copyrighted manga pages. Before enabling any public paste-link feature, add a DMCA/takedown footer linking to `/dmca`.
