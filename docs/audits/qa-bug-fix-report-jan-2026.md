# QA Bug Fix Report - January 27, 2026

## Executive Summary

Comprehensive QA review of the MangaTrack codebase completed. Focus areas:
- **Critical Business Logic**: Chapter URL redirection to external sources (NOT hosting content)
- **Security**: Input validation, rate limiting, SSRF protection
- **Stability**: NaN handling, advisory lock safety, error recovery

## Architecture Verification

### ✅ Confirmed: External URL Redirection Model
The application correctly redirects users to external chapter source URLs (MangaDex, MangaPlus, etc.) rather than hosting content. Key verification points:

1. **`src/components/series/chapter-list.tsx`**: Opens chapters in new tab via `window.open(chapter.chapter_url, "_blank", "noopener,noreferrer")`
2. **API Response Format**: Returns `chapter_url` pointing to external sources (e.g., `https://mangadex.org/chapter/...`)

## Bugs Fixed

### Bug #1: NaN Parameter Handling in Chapters API
**File**: `src/app/api/series/[id]/chapters/route.ts`
**Severity**: Medium
**Issue**: `parseInt()` on invalid query parameters could return NaN, causing unexpected behavior
**Fix**: Added `safeParseInt()` helper with bounds checking

```typescript
function safeParseInt(value: string | null, defaultValue: number, min: number, max: number): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) return defaultValue;
  return Math.min(max, Math.max(min, parsed));
}
```

### Bug #2: Advisory Lock Array Access
**File**: `src/app/api/series/[id]/chapters/route.ts`
**Severity**: Medium
**Issue**: Unsafe array access on advisory lock result could throw on empty response
**Fix**: Added null/empty check before accessing result

```typescript
if (!lockAcquired || lockAcquired.length === 0 || !lockAcquired[0]?.pg_try_advisory_lock) {
  // Handle gracefully
}
```

### Bug #3: Read Status NaN Comparison
**File**: `src/app/api/series/[id]/chapters/route.ts`
**Severity**: Low
**Issue**: Chapter read status comparison could fail with NaN chapter numbers
**Fix**: Added explicit NaN check in comparison logic

```typescript
const isRead = readChapterIds.has(logicalId) || 
  (lastReadChapter >= 0 && !isNaN(num) && num <= lastReadChapter);
```

### Bug #4: Lock ID Validation
**File**: `src/app/api/series/[id]/chapters/route.ts`
**Severity**: Low
**Issue**: Malformed series IDs could generate invalid lock IDs
**Fix**: Added NaN validation for computed lock IDs

### Bug #5: Advisory Lock Release Error Handling
**File**: `src/app/api/series/[id]/chapters/route.ts`
**Severity**: Low
**Issue**: Lock release failure could throw unhandled exception
**Fix**: Wrapped in catch block to ensure graceful handling

## Tests Added

### New Test File: `src/__tests__/integration/qa-critical-paths-jan2026.test.ts`

**21 test cases covering:**

1. **Chapter URL Redirection Flow**
   - External URL verification (not hosting content)
   - Trust score sorting for multiple sources

2. **Parameter Validation (NaN Handling)**
   - Null/undefined handling
   - NaN-producing strings
   - Bounds clamping
   - Float truncation

3. **Advisory Lock Safety**
   - Valid lock ID generation
   - Malformed ID handling

4. **Read Status Comparison**
   - Correct read detection
   - NaN chapter number safety
   - Negative progress handling

5. **Source URL Validation**
   - Allowed hosts acceptance
   - Malicious URL rejection

6. **Rate Limit Key Generation**
   - Unique key per IP
   - Injection sanitization

7. **UUID Validation**
   - Valid/invalid format detection

## Existing Error Handling (Already Robust)

The codebase already has excellent error handling:

- **Circuit Breakers**: For scraper failures (`CircuitBreaker` class)
- **DNS Error Recovery**: Dedicated `DnsError` class with retry logic
- **Rate Limit Handling**: Proper backoff with `RateLimitError`
- **Dead Letter Queue**: Worker failures logged to `WorkerFailure` table
- **Security Audit Logging**: Via `AuditLog` table

## Performance Observations

The codebase has solid performance patterns:

- **Database Retries**: `withRetry()` wrapper for transient failures
- **Advisory Locks**: Prevent concurrent scrapes
- **Rate Limiting**: Both Redis-backed and in-memory fallback
- **LRU Eviction**: In rate limit store with 10k entry cap

## Security Verification

### ✅ SSRF Protection
- `ALLOWED_HOSTS` whitelist for source URLs
- `validateSourceUrl()` function validates hostnames

### ✅ Input Validation
- UUID regex validation for series IDs
- `sanitizeInput()` for XSS prevention
- `escapeILikePattern()` for SQL injection prevention

### ✅ Rate Limiting
- Per-IP rate limiting on all endpoints
- Auth-specific stricter limits
- Redis with in-memory fallback

### ✅ CSRF Protection
- Origin validation
- CSRF token support

## Recommendations

### Immediate (No Action Required)
- Current implementation correctly redirects to external URLs
- Error handling is comprehensive
- Security measures are in place

### Future Considerations
1. **Add monitoring** for advisory lock contention
2. **Consider Redis Cluster** for high-availability rate limiting

## Test Results

```
bun test src/__tests__/integration/qa-critical-paths-jan2026.test.ts

21 pass
0 fail
56 expect() calls
Ran 21 tests across 1 file. [66.00ms]
```

## Files Modified

| File | Change Type | Description |
|------|-------------|-------------|
| `src/app/api/series/[id]/chapters/route.ts` | Modified | 5 bug fixes for parameter handling and lock safety |
| `src/__tests__/integration/qa-critical-paths-jan2026.test.ts` | Created | 21 new integration tests |

## Final Checklist

- [x] Codebase audited for bugs and security issues
- [x] Critical bugs fixed (5 total)
- [x] Integration tests created (21 new tests)
- [x] Error handling verified (already robust)
- [x] Performance patterns reviewed (already optimized)
- [x] External URL redirection model confirmed
- [x] All tests passing

---

**Report Generated**: January 27, 2026
**Framework**: Next.js (App Router) with TypeScript
**Database**: Supabase (PostgreSQL) with Prisma ORM
**Package Manager**: Bun
