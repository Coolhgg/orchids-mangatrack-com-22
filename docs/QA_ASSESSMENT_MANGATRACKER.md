# MangaTrack - Comprehensive QA Assessment

**Document Version:** 1.0  
**Assessment Date:** January 25, 2026  
**Prepared by:** Senior QA Engineer  
**Codebase Analyzed:** MangaTrack v5

---

## Table of Contents
1. [Scope and Approach](#1-scope-and-approach)
2. [Test Plan with Phases](#2-test-plan-with-phases)
3. [Feature Checklists](#3-feature-checklists)
4. [Sample Test Cases](#4-sample-test-cases)
5. [Tools and Environment](#5-tools-and-environment)
6. [Risk Assessment and Remediation](#6-risk-assessment-and-remediation)
7. [Deliverables](#7-deliverables)

---

## 1. Scope and Approach

### 1.1 Test Goals
- Validate all user-facing features function correctly
- Ensure data integrity across the reading tracking workflow
- Verify security controls (authentication, authorization, input validation)
- Confirm external API integrations (MangaDex, AniList) handle failures gracefully
- Validate background worker reliability and job processing
- Ensure gamification system integrity (XP, achievements, leaderboards)

### 1.2 Environments
| Environment | Purpose | URL |
|-------------|---------|-----|
| Development | Unit/Integration testing | `localhost:3000` |
| Staging | E2E/Performance testing | `staging.mangatracker.app` |
| Production | Smoke testing only | `mangatracker.app` |

### 1.3 Assumptions
- PostgreSQL (Supabase) database with Prisma ORM
- Redis available for queue/rate-limiting operations
- MangaDex API subject to rate limits (5 req/s)
- AniList API subject to rate limits (90 req/min)
- BullMQ workers operate independently with graceful shutdown

### 1.4 Non-Functional Criteria
| Criteria | Target |
|----------|--------|
| API Response Time (p95) | < 500ms |
| Page Load Time | < 3s |
| Worker Job Completion | < 30s |
| Error Rate | < 0.1% |
| Availability | 99.5% |

### 1.5 Functional Criteria
- All CRUD operations must be transactional
- XP calculations must prevent integer overflow (MAX_XP = 999,999,999)
- Soft deletes must be recoverable within 30 days
- Rate limiting must apply per-user and per-IP

### 1.6 Risk Areas (Priority Order)
1. **CRITICAL**: Authentication/Authorization flows
2. **CRITICAL**: XP/Achievement integrity (anti-cheat)
3. **HIGH**: External API failures (MangaDex, AniList)
4. **HIGH**: Worker job failures and DLQ handling
5. **MEDIUM**: Feed/notification delivery timing
6. **MEDIUM**: Concurrent updates to library entries

---

## 2. Test Plan with Phases

### Phase 1: Unit Testing
**Duration:** Ongoing (CI)  
**Framework:** Jest + React Testing Library

| Component | Coverage Target | Priority |
|-----------|----------------|----------|
| `src/lib/gamification/xp.ts` | 100% | Critical |
| `src/lib/gamification/trust-score.ts` | 100% | Critical |
| `src/lib/api-utils.ts` | 95% | Critical |
| `src/lib/gamification/achievements.ts` | 95% | High |
| `src/lib/mangadex.ts` | 90% | High |
| `src/lib/anilist.ts` | 90% | High |
| Worker processors | 90% | High |

**Key Unit Test Areas:**
- XP calculations with boundary values (0, MAX_XP, overflow scenarios)
- Trust score penalties and decay recovery
- Input sanitization (XSS, SQL injection patterns)
- Rate limit window calculations
- CIDR IP range validation

### Phase 2: Integration Testing
**Duration:** 2 weeks  
**Focus:** API routes + Database interactions

| API Group | Endpoints | Priority |
|-----------|-----------|----------|
| Library | `GET/POST/PATCH/DELETE /api/library/*` | Critical |
| Authentication | `/api/auth/*` | Critical |
| Series | `/api/series/*` | High |
| Feed | `/api/feed/*` | High |
| Users | `/api/users/*` | Medium |
| Notifications | `/api/notifications/*` | Medium |
| Admin | `/api/admin/*` | Low |

**Integration Test Scenarios:**
- Library entry creation with duplicate detection
- Series search with MangaDex fallback
- Progress update with XP award and achievement check
- Follow/unfollow with activity feed update
- Notification delivery queue flow

### Phase 3: End-to-End Testing
**Duration:** 3 weeks  
**Framework:** Playwright (multi-browser)

| User Flow | Browsers | Priority |
|-----------|----------|----------|
| Registration → Onboarding → Library Add | Chrome, Firefox, Safari | Critical |
| Search → Series Detail → Add to Library | Chrome, Mobile Chrome | Critical |
| Update Progress → XP Award → Achievement | Chrome, Safari | Critical |
| Import CSV → Track Progress → Verify | Chrome | High |
| Social: Follow → Activity Feed → Profile | Chrome, Firefox | Medium |
| Settings: Notifications → Safe Browsing | Chrome | Medium |

### Phase 4: Security Testing
**Duration:** 2 weeks  
**Tools:** OWASP ZAP, Custom scripts

| Security Area | Test Method | Priority |
|---------------|-------------|----------|
| Authentication bypass | Manual + Automated | Critical |
| CSRF protection | Origin validation tests | Critical |
| XSS injection | Input fuzzing | Critical |
| SQL injection | Parameterized query audit | Critical |
| Rate limit bypass | Concurrent request testing | High |
| IDOR (Insecure Direct Object Reference) | UUID enumeration | High |
| Open redirect | URL validation tests | Medium |
| SSRF (Server-Side Request Forgery) | URL allowlist tests | Medium |

### Phase 5: Performance Testing
**Duration:** 1 week  
**Framework:** k6

| Scenario | Target | VUs | Duration |
|----------|--------|-----|----------|
| API baseline | < 200ms p95 | 50 | 5m |
| Library fetch | < 500ms p95 | 100 | 10m |
| Feed refresh | < 1s p95 | 200 | 10m |
| Search stress | < 2s p95 | 100 | 5m |
| Rate limit enforcement | 429 response | 500 | 2m |

### Phase 6: Concurrency Testing
**Duration:** 1 week

| Scenario | Concurrent Users | Expected Behavior |
|----------|------------------|-------------------|
| Same user, multiple tabs | 5 | No duplicate entries |
| Progress update race | 10 | Last-write-wins, no XP duplication |
| Achievement unlock race | 5 | Single unlock only |
| Notification delivery | 100 | No duplicate notifications |

### Phase 7: Regression Testing
**Frequency:** Per release  
**Scope:** Critical path smoke tests + Full regression suite

---

## 3. Feature Checklists

### 3.1 Library Management

#### Expected Behavior
- Users can add series to library from search/browse
- Duplicate series detection by source URL
- Progress tracking updates XP
- Status changes (reading/completed/planning/dropped/paused)
- Soft delete with restoration capability

#### Edge Cases
- [ ] Add same series from different sources
- [ ] Add series without any sources attached
- [ ] Update progress beyond available chapters
- [ ] Set progress to negative numbers
- [ ] Set progress with excessive decimal precision
- [ ] Concurrent progress updates from multiple devices
- [ ] Restore soft-deleted entry within 30 days
- [ ] Attempt restoration after 30-day window

#### Potential Defects
- **BUG PATTERN**: Progress update without proper XP rate limiting could allow XP farming
- **BUG PATTERN**: Decimal precision loss in chapter numbers (Decimal(10,3))
- **BUG PATTERN**: Duplicate XP award on retry after transaction failure
- **BUG PATTERN**: Status change not triggering activity feed update

---

### 3.2 Authentication & Authorization

#### Expected Behavior
- Email/password registration with validation
- Username uniqueness check
- Password reset flow via email
- Session management via Supabase Auth
- Protected routes require authentication

#### Edge Cases
- [ ] Register with existing email
- [ ] Register with existing username (different case)
- [ ] Login with wrong password (5 attempts = lockout)
- [ ] Password reset for non-existent email
- [ ] Access protected route without session
- [ ] Access other user's data via URL manipulation
- [ ] Session expiry during active operation
- [ ] Concurrent login from multiple devices

#### Potential Defects
- **BUG PATTERN**: Username case sensitivity inconsistency
- **BUG PATTERN**: Session fixation on password reset
- **BUG PATTERN**: Rate limit bypass via IP rotation
- **BUG PATTERN**: IDOR in `/api/users/[username]` endpoints

---

### 3.3 Gamification System (XP, Achievements, Trust Score)

#### Expected Behavior
- XP awarded per chapter read (1 XP per chapter)
- Series completion bonus (100 XP)
- Daily streak bonus (5 XP)
- Achievement unlocks award XP
- Trust score affects leaderboard ranking only
- Trust score decays upward (recovery) daily

#### Edge Cases
- [ ] XP calculation at MAX_XP boundary (999,999,999)
- [ ] XP award during season transition
- [ ] Achievement unlock on exact threshold
- [ ] Multiple achievements unlocked simultaneously
- [ ] Trust score at minimum (0.5) with violation
- [ ] Trust score recovery calculation over multiple days
- [ ] Rapid reads triggering anti-cheat (5 reads in 30s)
- [ ] Leaderboard ranking with identical effective XP

#### Potential Defects
- **BUG PATTERN**: Integer overflow in XP calculations
- **BUG PATTERN**: Achievement double-unlock on concurrent request
- **BUG PATTERN**: Trust score penalty not respecting cooldown
- **BUG PATTERN**: Season XP not resetting on rollover

---

### 3.4 Background Workers

#### Expected Behavior
- 15 specialized workers process jobs from BullMQ queues
- Graceful shutdown on SIGTERM/SIGINT
- Dead Letter Queue (DLQ) for failed jobs after max retries
- Single-instance scheduler via Redis lock
- Heartbeat monitoring for health checks

#### Edge Cases
- [ ] Worker crash mid-job processing
- [ ] Redis connection loss during job execution
- [ ] Scheduler lock acquisition race condition
- [ ] Job exceeds lock duration (stale lock)
- [ ] DLQ overflow with repeated failures
- [ ] Worker restart with pending jobs
- [ ] Duplicate job detection on retry
- [ ] MangaDex rate limit during batch sync

#### Potential Defects
- **BUG PATTERN**: Stale lock preventing new scheduler acquisition
- **BUG PATTERN**: Job data loss on worker crash before completion
- **BUG PATTERN**: Memory leak in long-running worker process
- **BUG PATTERN**: Notification delivery duplication on retry

---

### 3.5 External API Integration (MangaDex, AniList)

#### Expected Behavior
- MangaDex: Search, metadata fetch, cover retrieval
- AniList: Official links (Viz, MangaPlus)
- Retry logic with exponential backoff
- Circuit breaker pattern for repeated failures
- Rate limit compliance (5 req/s MangaDex, 90 req/min AniList)

#### Edge Cases
- [ ] MangaDex returns 429 (rate limited)
- [ ] MangaDex returns 503 (Cloudflare challenge)
- [ ] AniList GraphQL error response
- [ ] Network timeout during batch cover fetch
- [ ] Invalid manga ID in request
- [ ] Empty search results handling
- [ ] Partial response with missing fields
- [ ] API response schema change

#### Potential Defects
- **BUG PATTERN**: Retry loop without backoff exhausting rate limit
- **BUG PATTERN**: Cloudflare challenge not triggering circuit breaker
- **BUG PATTERN**: Null pointer on missing optional field
- **BUG PATTERN**: Cache poisoning with error response

---

## 4. Sample Test Cases

### 4.1 Library Entry Creation (Happy Path)

```gherkin
Feature: Add Series to Library
  As a registered user
  I want to add a series to my library
  So that I can track my reading progress

Scenario: Successfully add a series to library
  Given I am logged in as "testuser@example.com"
  And the series "One Piece" exists with MangaDex source
  And "One Piece" is not in my library
  When I send POST /api/library with body:
    """
    {
      "seriesId": "uuid-of-one-piece",
      "status": "reading"
    }
    """
  Then the response status should be 201
  And the response should contain:
    | field           | value      |
    | status          | reading    |
    | metadata_status | enriched   |
    | sync_status     | healthy    |
  And "One Piece" should appear in my library
  And the series total_follows should increment by 1

Scenario: Idempotent add - series already in library
  Given I am logged in as "testuser@example.com"
  And "One Piece" is already in my library with status "reading"
  When I send POST /api/library with body:
    """
    {
      "seriesId": "uuid-of-one-piece",
      "status": "completed"
    }
    """
  Then the response status should be 200
  And my library entry for "One Piece" should still have status "reading"
  And the series total_follows should NOT change
```

### 4.2 XP Award with Overflow Protection

```gherkin
Feature: XP Award System
  As a user earning XP
  I want the system to protect against overflow
  So that my XP is always valid

Scenario: XP award at MAX_XP boundary
  Given I am logged in as "maxed_user@example.com"
  And my current XP is 999,999,990
  When I mark chapter 100 of "Solo Leveling" as read
  Then my XP should be 999,999,991
  And no achievement should be awarded for overflow

Scenario: XP award that would exceed MAX_XP
  Given I am logged in as "almost_max@example.com"
  And my current XP is 999,999,999
  When I complete the series "Tower of God" (100 XP bonus)
  Then my XP should remain 999,999,999
  And the completion should still be recorded
  And an INFO log should indicate "XP capped at MAX_XP"

Scenario: Invalid XP value handling
  Given a user has XP value NaN in database
  When calculateLevel is called for that user
  Then the function should return level 1
  And a warning log should be generated
```

### 4.3 Trust Score Anti-Cheat

```gherkin
Feature: Trust Score Anti-Cheat System
  As a platform
  I want to detect suspicious reading patterns
  So that leaderboard integrity is maintained

Scenario: Rapid reads trigger trust score penalty
  Given I am logged in as "speed_reader@example.com"
  And my trust score is 1.0 (fully trusted)
  When I mark 5 chapters as read within 30 seconds
  Then my trust score should be 0.95 (rapid_reads penalty: 0.05)
  And a TrustViolation record should be created with type "rapid_reads"
  And my XP should NOT be reduced

Scenario: Trust score cooldown prevents penalty stacking
  Given I am logged in as "repeat_offender@example.com"
  And I triggered a "rapid_reads" violation 30 seconds ago
  When I mark another 5 chapters as read within 30 seconds
  Then my trust score should NOT change
  And no new TrustViolation record should be created

Scenario: Daily trust score recovery
  Given user "reformed@example.com" has trust score 0.80
  And their last violation was 24 hours ago
  When the daily decay job runs
  Then their trust score should be 0.82 (+0.02 recovery)

Scenario: Leaderboard effective XP calculation
  Given user "regular" has XP 10,000 and trust score 1.0
  And user "suspected" has XP 10,000 and trust score 0.8
  When I fetch the leaderboard
  Then "regular" should have effective XP 10,000
  And "suspected" should have effective XP 8,000
  And "regular" should rank higher than "suspected"
```

### 4.4 Security - CSRF Protection

```gherkin
Feature: CSRF Protection
  As a platform
  I want to prevent cross-site request forgery
  So that users' actions cannot be manipulated

Scenario: Valid origin header - request allowed
  Given I am logged in as "user@example.com"
  When I send POST /api/library with headers:
    | Header | Value |
    | Origin | https://mangatracker.app |
    | Host   | mangatracker.app |
  Then the response status should be 201

Scenario: Missing origin header in production - request blocked
  Given I am logged in as "user@example.com"
  And the environment is production
  When I send POST /api/library without Origin header
  Then the response status should be 403
  And the response should contain error "CSRF Protection: Invalid origin"

Scenario: Mismatched origin - request blocked
  Given I am logged in as "user@example.com"
  When I send POST /api/library with headers:
    | Header | Value |
    | Origin | https://evil-site.com |
    | Host   | mangatracker.app |
  Then the response status should be 403
  And the response should contain error "CSRF Protection: Invalid origin"

Scenario: Protocol-relative URL redirect prevention
  When I access /auth/callback with redirect=//evil.com
  Then I should be redirected to /library
  And NOT to //evil.com
```

### 4.5 Worker Graceful Shutdown

```gherkin
Feature: Worker Graceful Shutdown
  As a system administrator
  I want workers to shutdown gracefully
  So that no jobs are lost during deployment

Scenario: SIGTERM triggers graceful shutdown
  Given the worker process is running
  And there is 1 active job in progress
  When SIGTERM is sent to the worker process
  Then the worker should stop accepting new jobs
  And the active job should complete
  And the global lock should be released
  And Redis connections should be closed
  And the process should exit with code 0

Scenario: Shutdown timeout force exit
  Given the worker process is running
  And there is 1 job that takes longer than 25 seconds
  When SIGTERM is sent to the worker process
  And 25 seconds pass
  Then the process should force exit with code 1
  And an error log should indicate "Shutdown timed out, forcing exit"

Scenario: Stale lock recovery on startup
  Given a previous worker crashed without releasing the global lock
  And the heartbeat is older than 45 seconds
  When a new worker instance starts
  Then the stale global lock should be cleared
  And the new worker should acquire the lock
  And processing should resume normally
```

---

## 5. Tools and Environment

### 5.1 Recommended Tooling

| Category | Tool | Purpose |
|----------|------|---------|
| Unit Testing | Jest | JavaScript/TypeScript unit tests |
| Component Testing | React Testing Library | UI component tests |
| E2E Testing | Playwright | Multi-browser E2E tests |
| API Testing | Supertest / curl | Integration API tests |
| Load Testing | k6 | Performance/stress testing |
| Security Scanning | OWASP ZAP | Automated vulnerability scanning |
| Static Analysis | ESLint + TypeScript | Code quality |
| Linting | Prettier | Code formatting |
| Coverage | Jest Coverage | Code coverage reporting |
| CI/CD | GitHub Actions | Automated test pipeline |

### 5.2 Static Analysis Configuration

```yaml
# ESLint Security Rules (recommended additions)
rules:
  no-eval: error
  no-implied-eval: error
  no-new-func: error
  security/detect-object-injection: warn
  security/detect-non-literal-regexp: warn
  security/detect-unsafe-regex: error
```

### 5.3 Environment Setup

```bash
# 1. Clone repository
git clone https://github.com/org/mangatracker.git
cd mangatracker

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with test database credentials

# 4. Run database migrations
npm run db:migrate

# 5. Seed test data (if available)
npm run db:seed

# 6. Run unit tests
npm test

# 7. Run E2E tests (requires dev server)
npm run dev &
npm run test:e2e

# 8. Run load tests
cd load-tests && k6 run api-load-test.js
```

### 5.4 Test Data Strategy

| Data Type | Source | Isolation |
|-----------|--------|-----------|
| Users | Factory/Fixtures | Per-test cleanup |
| Series | Seeded from fixtures | Shared (read-only) |
| Library entries | Created per test | Per-test cleanup |
| Achievements | Seeded from fixtures | Shared (read-only) |
| Worker jobs | Mock/Stub | In-memory |

---

## 6. Risk Assessment and Remediation

### 6.1 Critical Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| XP overflow leading to data corruption | Low | Critical | Already implemented: `MAX_XP` constant, `clampXp()` function |
| Authentication bypass | Low | Critical | Supabase Auth handles; add penetration testing |
| SQL injection via dynamic queries | Low | Critical | Prisma ORM parameterizes; audit raw queries |
| Worker DLQ overflow | Medium | High | Add DLQ monitoring alerts, retention policy |
| MangaDex API breaking change | Medium | High | Schema validation, version pinning, fallback |

### 6.2 High Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Rate limit bypass via distributed attack | Medium | High | IP-based + User-based limits; consider WAF |
| Duplicate notification delivery | Medium | Medium | Idempotency keys in notification queue |
| Trust score manipulation via timing | Low | Medium | Already implemented: cooldown period |
| Memory leak in worker process | Medium | Medium | Add memory monitoring, restart policy |
| Redis connection exhaustion | Low | High | Connection pooling already in place; add alerts |

### 6.3 Medium Risks

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Feed stale data | High | Low | TTL-based cache invalidation |
| Achievement criteria regression | Medium | Medium | Comprehensive unit tests for criteria |
| Import job timeout | Medium | Low | Chunked processing, progress tracking |
| UI state desync after error | Medium | Low | Error boundaries, retry logic |

### 6.4 Prioritized Remediation Plan

1. **Week 1-2**: Security hardening
   - [ ] OWASP ZAP scan and remediation
   - [ ] Penetration testing for auth flows
   - [ ] Rate limit bypass testing

2. **Week 3-4**: Data integrity
   - [ ] XP system comprehensive testing
   - [ ] Achievement edge case coverage
   - [ ] Concurrent update testing

3. **Week 5-6**: Reliability
   - [ ] Worker failure recovery testing
   - [ ] External API failure simulation
   - [ ] Load testing with realistic data

---

## 7. Deliverables

### 7.1 Defect Report Template

```markdown
## Defect Report

**ID:** BUG-XXXX
**Title:** [Brief description]
**Severity:** Critical | High | Medium | Low
**Priority:** P0 | P1 | P2 | P3
**Component:** [e.g., Library, Auth, Worker]
**Environment:** Development | Staging | Production
**Reporter:** [Name]
**Date:** [YYYY-MM-DD]

### Description
[Detailed description of the defect]

### Steps to Reproduce
1. [Step 1]
2. [Step 2]
3. [Step 3]

### Expected Result
[What should happen]

### Actual Result
[What actually happened]

### Evidence
- Screenshot: [link]
- Video: [link]
- Logs: [relevant log snippet]

### Root Cause Analysis (if known)
[Technical details]

### Suggested Fix
[Technical suggestion]

### Affected Users
[Scope of impact]
```

### 7.2 Test Summary Report Template

```markdown
## Test Summary Report

**Release:** v[X.Y.Z]
**Test Period:** [Start Date] - [End Date]
**Environment:** [Staging/Production]

### Executive Summary
[2-3 sentence summary of test results]

### Metrics

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Test Cases Executed | XXX | XXX | ✅/⚠️/❌ |
| Test Cases Passed | XXX (XX%) | >95% | ✅/⚠️/❌ |
| Test Cases Failed | XXX (XX%) | <5% | ✅/⚠️/❌ |
| Defects Found | XX | - | - |
| Critical Defects | X | 0 | ✅/❌ |
| High Defects | X | <3 | ✅/⚠️/❌ |
| Code Coverage | XX% | >80% | ✅/⚠️/❌ |

### Defects by Severity

| Severity | Found | Fixed | Open |
|----------|-------|-------|------|
| Critical | X | X | X |
| High | X | X | X |
| Medium | X | X | X |
| Low | X | X | X |

### Test Coverage by Feature

| Feature | Cases | Pass | Fail | Skip |
|---------|-------|------|------|------|
| Library | XX | XX | X | X |
| Auth | XX | XX | X | X |
| Gamification | XX | XX | X | X |
| Workers | XX | XX | X | X |
| Feed | XX | XX | X | X |

### Remaining Risks
1. [Risk 1 with impact]
2. [Risk 2 with impact]

### Recommendations
1. [Recommendation 1]
2. [Recommendation 2]

### Go/No-Go Recommendation
**Recommendation:** [GO / NO-GO / CONDITIONAL GO]
**Rationale:** [Explanation]
```

### 7.3 Security Test Outline

```markdown
## Security Testing Checklist

### Authentication
- [ ] Password brute force protection (lockout after 5 attempts)
- [ ] Session fixation prevention
- [ ] Session timeout enforcement
- [ ] Password complexity requirements
- [ ] Secure password reset flow
- [ ] Multi-device session management

### Authorization
- [ ] IDOR testing on all UUID-based endpoints
- [ ] Admin endpoint access control
- [ ] User data isolation verification
- [ ] API key/token permission scoping

### Input Validation
- [ ] XSS via form inputs (username, bio, search)
- [ ] XSS via URL parameters
- [ ] SQL injection via search queries
- [ ] NoSQL injection (if applicable)
- [ ] Command injection (file upload, import)
- [ ] Path traversal (image proxy, file operations)

### CSRF Protection
- [ ] Origin header validation
- [ ] Referer header validation
- [ ] State-changing requests require valid origin
- [ ] Token-based CSRF (if implemented)

### Rate Limiting
- [ ] API endpoint rate limits enforced
- [ ] Auth endpoint stricter limits
- [ ] Rate limit bypass via IP rotation
- [ ] Rate limit bypass via user ID rotation
- [ ] Response includes rate limit headers

### Data Exposure
- [ ] Sensitive data not in logs
- [ ] API responses don't leak internal IDs
- [ ] Error messages don't reveal system info
- [ ] Soft-deleted data not accessible

### External Integrations
- [ ] SSRF prevention (URL allowlist)
- [ ] API key not exposed to client
- [ ] External API errors handled gracefully
- [ ] No credential leakage in redirects
```

---

## Appendix A: API Endpoint Coverage Matrix

| Endpoint | Auth | Rate Limit | CSRF | Unit | Integration | E2E |
|----------|------|------------|------|------|-------------|-----|
| POST /api/library | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| GET /api/library | ✅ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| PATCH /api/library/[id] | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| DELETE /api/library/[id] | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| POST /api/library/[id]/progress | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| GET /api/series/search | ⬜ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| GET /api/series/[id] | ⬜ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| GET /api/feed | ✅ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| POST /api/users/[username]/follow | ✅ | ✅ | ✅ | ⬜ | ⬜ | ⬜ |
| GET /api/leaderboard | ⬜ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| GET /api/users/me/achievements | ✅ | ✅ | N/A | ⬜ | ⬜ | ⬜ |
| GET /api/health | ⬜ | ⬜ | N/A | ⬜ | ⬜ | ⬜ |
| GET /api/admin/queue-health | ✅ (Admin) | ✅ | N/A | ⬜ | ⬜ | ⬜ |

Legend: ✅ = Implemented/Required | ⬜ = Needs Test | N/A = Not Applicable

---

## Appendix B: Worker Queue Coverage Matrix

| Queue | Processor | DLQ | Retry | Rate Limit | Unit | Integration |
|-------|-----------|-----|-------|------------|------|-------------|
| canonicalize | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| poll-source | ✅ | ✅ | 3 | 10/s | ⬜ | ⬜ |
| chapter-ingest | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| check-source | ✅ | ✅ | 3 | 3/s | ⬜ | ⬜ |
| notification | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| notification-delivery | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| notification-delivery-premium | ✅ | ✅ | 3 | 1000/min | ⬜ | ⬜ |
| notification-digest | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| notification-timing | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| refresh-cover | ✅ | ✅ | 3 | 5/s | ⬜ | ⬜ |
| gap-recovery | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| resolution | ✅ | ✅ | 3 | 5/s | ⬜ | ⬜ |
| import | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| feed-fanout | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |
| latest-feed | ✅ | ✅ | 3 | N/A | ⬜ | ⬜ |

---

*Document prepared for MangaTrack QA assessment. Confidential.*
