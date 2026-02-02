# MangaDex + MangaUpdates QA Checklist

## Automated Checks (11 Total)

| # | Type | Check | Command |
|---|------|-------|---------|
| 1 | Unit | MangaDex `fetchLatestChapters` - mocked API response parsing | `npm test -- mangadex-mangaupdates-qa` |
| 2 | Unit | MangaDex `fetchMangaMetadata` - mocked 200 with relationships | `npm test -- mangadex-mangaupdates-qa` |
| 3 | Unit | MangaDex `fetchCovers` - batch request handling | `npm test -- mangadex-mangaupdates-qa` |
| 4 | Unit | MangaUpdates `pollLatestReleases` - nested record flattening | `npm test -- mangadex-mangaupdates-qa` |
| 5 | Unit | MangaUpdates `fetchSeriesMetadata` - 429 Retry-After handling | `npm test -- mangadex-mangaupdates-qa` |
| 6 | Unit | Cache TTL behavior - in-memory expiration | `npm test -- mangadex-mangaupdates-qa` |
| 7 | Unit | Rate limiter - token bucket prevents > configured RPS | `npm test -- mangadex-mangaupdates-qa` |
| 8 | Integration | DB upsert idempotency - same release twice = single row | `npm test -- db-idempotency` |
| 9 | Unit | Error handling - 5xx retry with exponential backoff | `npm test -- mangadex-mangaupdates-qa` |
| 10 | Security | No secrets in code - cache key validation | `npm test -- mangadex-mangaupdates-qa` |
| 11 | Integration-External | Real MangaDex API - 5 latest chapters (optional) | `INTEGRATION_EXTERNAL=true npm test -- mangadex-external` |

---

## Top 3 Remediation Commands (By Impact)

### 1. Redis Connection Failure
```bash
# Check if Redis is running
redis-cli ping

# If not running, start Redis
redis-server --daemonize yes

# Or add REDIS_URL to .env for remote Redis
echo "REDIS_URL=redis://localhost:6379" >> .env
```

### 2. Rate Limit Exceeded (429)
```bash
# Temporarily increase requestsPerSecond in client options
# Edit src/lib/mangaupdates/client.ts line 39:
sed -i 's/DEFAULT_REQUESTS_PER_SECOND = 1/DEFAULT_REQUESTS_PER_SECOND = 0.5/' src/lib/mangaupdates/client.ts

# Or wait and retry
sleep 60 && bun run src/workers/mangaupdatesPoller.ts --once
```

### 3. Selector/Schema Mismatch
```bash
# If MangaUpdates API response structure changed:
# 1. Check current API response
curl -s "https://api.mangaupdates.com/v1/releases/days?page=1" | jq '.results[0]'

# 2. Update type definitions in src/lib/mangaupdates/client.ts
# 3. Update flattening logic in flattenReleaseResult method
```

---

## Manual Verification Checklist

- [ ] Run poller once and verify releases in DB: `bun run src/workers/mangaupdatesPoller.ts --once`
- [ ] Check Redis queue: `redis-cli LLEN bull:mangaupdates:fetch-metadata:wait`
- [ ] Verify no duplicate releases: `SELECT mangaupdates_release_id, COUNT(*) FROM "mangaupdates_releases" GROUP BY mangaupdates_release_id HAVING COUNT(*) > 1;`
- [ ] Check worker logs for rate limit warnings: `grep "Rate limited" /tmp/dev-server.err.log`

---

## Lighthouse Commands (If Frontend Exists)

```bash
# Desktop
npx lighthouse http://localhost:3000 --output=json --output-path=./lighthouse-desktop.json --preset=desktop --only-categories=performance,accessibility

# Mobile
npx lighthouse http://localhost:3000 --output=json --output-path=./lighthouse-mobile.json --preset=mobile --only-categories=performance,accessibility

# Thresholds
# - Performance: >= 80
# - Accessibility: >= 90
```

---

## Run All Tests

```bash
# Unit tests only
npm test -- --testPathPattern="(mangadex|mangaupdates)" --coverage

# Integration tests (requires DB)
npm test -- --testPathPattern=integration

# Playwright E2E
npx playwright test e2e/api-schema.spec.ts

# Full QA suite
npm test -- --testPathPattern="qa|mangadex|mangaupdates|db-idempotency"
```
