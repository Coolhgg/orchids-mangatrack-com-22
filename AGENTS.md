## Project Summary
A comprehensive manga tracking and discovery platform that allows users to track their reading progress across various sources, discover new series, and interact with a social feed.

## Tech Stack
- Frontend: Next.js (App Router), Tailwind CSS
- Backend: Next.js API Routes
- Database: Supabase (PostgreSQL) with Prisma ORM
- Auth: Supabase Auth
- External APIs: MangaDex (primary metadata), AniList (official links/tracking)
- Package Manager: Bun (bun.lock)
- React: 19.2.0 (exact version, no ranges)

## Architecture
- `src/app`: Next.js pages and API routes
- `src/lib`: Core utilities and API clients (MangaDex, AniList, Supabase)
- `src/components`: UI components organized by feature
- `scripts`: Utility scripts for data import and maintenance

## User Preferences
- Always use the provided MangaDex API credentials for rate limiting benefits.
- Use AniList as the primary source for official links (Viz, MangaPlus, etc.).
- Respect rate limits for both MangaDex (5 req/s) and AniList (90 req/min).

## Project Guidelines
- Use functional components with TypeScript.
- Maintain consistent code style mimicking existing patterns.
- Ensure all API calls handle rate limiting and errors gracefully.
- React versions MUST be exact (no ^ or ~) in package.json with matching overrides.
- Use `bun install` for dependency management (not npm).

## Common Patterns
- Upsert logic for series and sources to ensure data consistency.
- Search-based fallbacks when IDs are missing from external APIs.

## Auth Flow & Email Confirmation
- **Registration**: Users register with email/password or OAuth (Google/Discord).
- **Email Confirmation**: By default, Supabase Auth requires email confirmation.
  - After signup, users are shown a "Check your email" card.
  - The `email_confirmed_at` field in Supabase Auth tracks confirmation status.
  - Users cannot sign in until the email is confirmed unless the "Confirm Email" setting is disabled in Supabase Dashboard.
- **Onboarding**: After confirmation/first login, users without a username in their metadata are redirected to `/onboarding`.
- **Session Management**: Handled by Supabase Auth with server-side cookies via `@/lib/supabase/server`.

## Database Schema Modernization
- **Models**: All models use PascalCase singular names (e.g., `User`, `Series`).
- **Tables**: All tables use snake_case plural names (e.g., `users`, `series`).
- **Relations**:
  - Singular relations use the singular model name in camelCase (e.g., `user User`).
  - Collection relations use the plural model name in camelCase (e.g., `activities Activity[]`).
- **Direct Connection**: Use `DIRECT_URL` for Prisma migrations and `db push`. The direct host is `db.nkrxhoamqsawixdwehaq.supabase.co`.

## Dependency Management (CRITICAL)
- Package manager: Bun (packageManager: bun@1.2.0)
- Lock file: bun.lock (NOT package-lock.json)
- React/React-DOM: MUST be exact versions (19.2.0) with matching overrides
- @types/react: MUST match in devDependencies and overrides
- Run `node scripts/check-react-versions.js` to validate before install

## FORBIDDEN Dependencies (DO NOT ADD)
These packages have incompatible peer dependencies with React 19 and will cause constant reinstalls:
- `@react-three/fiber` (requires react >=18 <19)
- `@react-three/drei` (depends on fiber)
- `three` / `three-globe` / `@types/three` (3D dependencies)
- `cobe` (globe visualization)
- `@number-flow/react` (unused)

## Phantom Dependency Root Cause (CRITICAL)
The recurring phantom dependency issue happens because:
1. **Bun's global cache** at `~/.bun/install/cache/` persists packages even after removal from node_modules
2. **`bun install --force`** re-fetches from cache, reintroducing forbidden deps
3. **Transitive dependencies** can pull in forbidden packages as optionalDependencies

The watchdog now:
- Purges forbidden deps from bun's global cache during repair
- Runs post-install verification to catch any that sneak back
- The postinstall script in package.json also guards against phantom deps

If phantom deps keep appearing, run: `node scripts/watchdog.js repair`

## Phantom Directories (Turbopack Issue Fix)
Phantom directories like `home/`, `tmp/`, `var/` in the project root can cause Turbopack to crash with path resolution errors (trying to read directories as files). The watchdog now:
- Detects and reports phantom directories in health checks
- Automatically removes them during repair
- Use `node scripts/watchdog.js clean-phantoms` to manually remove them

These directories are also added to `.gitignore` to prevent accidental commits.

## Security Measures (Implemented)

### SSRF Protection
- `src/lib/constants/image-whitelist.ts`: `isInternalIP()` blocks private IPs, IPv6 mapped addresses, cloud metadata IPs
- `src/lib/constants/image-whitelist.ts`: `isWhitelistedDomain()` validates image proxy URLs
- `src/lib/scrapers/index.ts`: `ALLOWED_HOSTS` restricts source URLs to trusted domains only
- `src/app/api/proxy/image/route.ts`: DNS resolution check prevents DNS rebinding attacks

### CSRF Protection
- `src/lib/api-utils.ts`: `validateOrigin()` checks Origin header against Host
- All POST endpoints call `validateOrigin(req)` before processing
- Supports `ALLOWED_CSRF_ORIGINS` env var for explicit allowlist

### Soft Delete Safety
- `src/lib/prisma.ts`: Middleware auto-filters `deleted_at IS NULL` for soft-delete models
- `src/lib/sql/leaderboard.ts`: Raw SQL queries include `deleted_at IS NULL` in WHERE clauses
- Helper functions: `rawQueryWithSoftDeleteWarning()`, `buildSoftDeleteSafeQuery()`

### Audit Logging (DMCA Compliance)
- `LinkSubmissionAudit` table: Append-only audit log for all chapter link operations
- Events logged: link_created, link_reported, link_status_changed, link_voted, dmca_requested, dmca_approved
- Includes user_id, action, metadata, ip_address, timestamp

### Rate Limiting
- Redis-based with in-memory fallback
- Per-user limits on sensitive operations
- Auth endpoints: 5 attempts per minute
- Library operations: 30-60 requests per minute

## QA & Maintenance Guidelines (Added Jan 2026)

### Performance Optimization
- **Bulk Operations**: When performing bulk updates (e.g., `/api/library/bulk`), always fetch current state using a single `findMany` with `in` clause before the loop to avoid N+1 queries inside transactions.
- **Feed Pagination**: Use cursor-based pagination for feeds. The `feed/activity` and `feed/updates` routes are optimized with Redis caching.
- **Transaction Timeouts**: Standard transactions use a 15s timeout (`DEFAULT_TRANSACTION_TIMEOUT`). Complex migrations or bulk imports should use `LONG_TRANSACTION_TIMEOUT` (45s).

### Error Handling
- Always use `withErrorHandling` wrapper or `handleApiError` in API routes to ensure sensitive information (secrets, stack traces) is masked in production.
- Use `withRetry` for database operations that might encounter transient connection issues.

### Integration Testing
- Critical user flows are covered by Playwright tests in the `e2e/` directory.
- Run `npx playwright test` to verify the "Landing -> Register -> Onboarding -> Library" journey.
- Use `e2e/critical-flow.spec.ts` as a template for new feature testing.

### Security Compliance
- **CSRF**: All mutation endpoints (POST/PATCH/DELETE) MUST call `validateOrigin(req)`.
- **SSRF**: Use `verifyPlatformCompatibility` for any external URL ingestion.
- **SQLi**: Use parameterized queries or `escapeILikePattern` for any dynamic SQL.
