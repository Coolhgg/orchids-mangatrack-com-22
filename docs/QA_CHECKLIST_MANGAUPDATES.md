# MangaUpdates Integration QA Checklist

## Automated/Manual Checks (10 items)

1. **[Unit]** `MangaUpdatesClient.pollLatestReleases` returns flattened releases from nested API response
2. **[Unit]** `MangaUpdatesClient.fetchSeriesMetadata` handles 429 with Retry-After header (throws RateLimitError)
3. **[Unit]** `MangaUpdatesClient.fetchSeriesMetadata` handles 404 (throws NotFoundError, no retry)
4. **[Unit]** In-memory cache expires entries after TTL and returns null
5. **[Integration]** DB upsert with same `mangaupdates_release_id` produces exactly 1 row (idempotency)
6. **[Integration]** Concurrent upserts do not create duplicate releases (race condition safety)
7. **[E2E]** `GET /api/mangaupdates/latest` returns JSON with `title`, `mangaupdatesId`, `publishedAt` fields
8. **[Ops]** Poller acquires distributed lock; second instance skips poll cycle
9. **[Ops]** Worker respects `limiter.max=1` and processes jobs at ~1 req/sec
10. **[Manual]** Run `bun run src/workers/mangaupdatesPoller.ts --once` and verify releases in DB

---

## Top 3 Failure Remediations

```bash
# 1. Rate limit errors (429) during polling
export MANGAUPDATES_POLL_PAGES=1  # Reduce pages temporarily

# 2. Redis connection failed
export REDIS_URL=redis://localhost:6379  # Ensure Redis is running

# 3. Prisma schema out of sync (missing fields)
bunx prisma migrate dev --name fix_mangaupdates_fields
```

---

## Run Tests

```bash
# Unit tests
bun test src/__tests__/unit/mangaupdates-client.test.ts
bun test src/__tests__/unit/mangaupdates-cache.test.ts

# Integration tests (requires DB)
bun test src/__tests__/integration/mangaupdates-db-idempotency.test.ts

# E2E tests (requires dev server)
bunx playwright test e2e/mangaupdates-api.spec.ts
```
