# Fix Critical Runtime Errors

## Summary
Fix three critical issues causing runtime crashes: Prisma schema mismatch in `/api/users/me`, invalid UUID handling in `EnhancedChapterList.tsx`, and Supabase auth timeout configuration.

## Requirements
1. **P0 - Schema Mismatch**: The `/api/users/me` route uses `library_entries` but Prisma schema defines the relation as `libraryEntries` (camelCase), causing `PrismaClientValidationError` and breaking the library page.
2. **P1 - UUID Validation**: `EnhancedChapterList.tsx` needs defensive validation to prevent 400 errors when malformed series IDs are passed.
3. **P2 - Auth Timeouts**: Investigate and improve Supabase auth timeout handling to reduce intermittent "Unauthorized" states.

## Current State Analysis

### Issue 1: Schema Mismatch (ALREADY FIXED)
Looking at the current code in `src/app/api/users/me/route.ts`:
- Line 53: Uses `libraryEntries: true` (correct camelCase)
- Line 231: Uses `dbUser._count?.libraryEntries` (correct)

**Status**: This issue appears to have been already fixed. The code now correctly uses `libraryEntries` instead of `library_entries`.

### Issue 2: UUID Validation (ALREADY FIXED)
Looking at `src/components/series/EnhancedChapterList.tsx`:
- Line 73: UUID validation regex is defined: `const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`
- Line 87: Validation check: `const isValidSeriesId = UUID_REGEX.test(seriesId)`
- Lines 113-121: Early return if invalid, with console warning

**Status**: This issue appears to have been already fixed. The component now validates UUIDs before making API calls.

### Issue 3: Supabase Auth Timeouts (NEEDS INVESTIGATION)
Looking at `src/lib/supabase/middleware.ts`:
- Line 12: `AUTH_TIMEOUT_MS = 15000` (15 seconds)
- Lines 40-57: Timeout handling with `Promise.race`

The current implementation has a timeout but the 15s duration may be too long, causing slow page loads when Supabase is unresponsive.

## Implementation Phases

### Phase 1: Verify Previous Fixes
- [ ] Confirm `/api/users/me` correctly uses `libraryEntries` relation name
- [ ] Confirm `EnhancedChapterList.tsx` has UUID validation in place
- [ ] Run TypeScript type-check to ensure no Prisma validation errors

### Phase 2: Improve Auth Timeout Handling
- [ ] Reduce `AUTH_TIMEOUT_MS` from 15000ms to 5000ms for faster failure
- [ ] Add a fallback cached-user mechanism for degraded mode
- [ ] Implement exponential backoff for retry logic
- [ ] Add metrics/logging for auth timeout frequency

### Phase 3: Add Graceful Degradation
- [ ] Update middleware to serve cached session data on timeout
- [ ] Add client-side retry mechanism for failed auth
- [ ] Implement "degraded mode" UI indicator when auth is slow

### Phase 4: Run Watchdog Cleanup
- [ ] Execute `node scripts/watchdog.js repair` to clear phantom files
- [ ] Verify no stale cache entries are causing issues
- [ ] Check for any corrupted Prisma client generation

## Files to Modify

| File | Change Required |
|------|-----------------|
| `src/lib/supabase/middleware.ts` | Reduce AUTH_TIMEOUT_MS, add retry logic |
| `src/lib/supabase/cached-user.ts` | Enhance caching for degraded mode |

## Verification Steps
1. Run `bunx tsc --noEmit` to verify type safety
2. Test `/api/users/me` endpoint returns correct `library_count`
3. Test chapter list with invalid series ID (should show empty state, not error)
4. Monitor Supabase auth timeout logs in development

## Notes
- The first two issues (schema mismatch and UUID validation) appear to have been resolved in previous commits
- The auth timeout issue is a configuration/infrastructure concern that may require environment variable tuning
- If issues persist after these changes, check Supabase project health and network connectivity
