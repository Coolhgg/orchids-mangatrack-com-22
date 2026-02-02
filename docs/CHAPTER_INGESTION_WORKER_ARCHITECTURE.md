# Background Worker Architecture for Manga Chapter Ingestion

## Overview

This document defines the architecture for a queue-based background worker system that handles manga chapter polling and ingestion. The system ensures:

1. **Deduplication** - Same chapter from same source is never duplicated
2. **Source Independence** - Same chapter from different sources = separate events
3. **Idempotent Ingestion** - Safe retries that update timestamps, not create rows
4. **Reliable Processing** - Retry and failure handling with circuit breakers

---

## Worker Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           MASTER SCHEDULER (5 min interval)                      │
│                                                                                  │
│  1. Query SeriesSource where next_check_at <= NOW                                │
│  2. Batch sources by sync_priority (HOT/WARM/COLD)                               │
│  3. Enqueue to poll-source-queue with priority                                   │
│  4. Update next_check_at based on priority interval                              │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           POLL-SOURCE QUEUE (Redis/BullMQ)                       │
│                                                                                  │
│  Job Data: { seriesSourceId: UUID }                                              │
│  Job ID: "poll-{seriesSourceId}-{timestamp}"                                     │
│  Priority: HOT=1, WARM=2, COLD=3                                                 │
│  Dedup: jobId prevents duplicate enqueues in same scheduler cycle                │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           POLL WORKER (concurrency: 5)                           │
│                                                                                  │
│  1. Validate job payload (Zod schema)                                            │
│  2. Check circuit breaker (failure_count < MAX_FAILURES)                         │
│  3. Fetch source metadata from DB                                                │
│  4. Call external API (MangaDex, MangaPark, etc.)                                │
│  5. Compare scraped chapters with existing                                       │
│  6. Enqueue NEW chapters to chapter-ingest-queue                                 │
│  7. Update source.last_checked_at                                                │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       │  For each NEW chapter discovered
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CHAPTER-INGEST QUEUE (Redis/BullMQ)                       │
│                                                                                  │
│  Job Data: {                                                                     │
│    seriesId: UUID,                                                               │
│    seriesSourceId: UUID,                                                         │
│    chapterNumber: Decimal,                                                       │
│    chapterTitle: string | null,                                                  │
│    chapterUrl: string,                                                           │
│    publishedAt: ISO8601 | null,                                                  │
│    sourceChapterId: string | null,                                               │
│    volumeNumber: number | null,                                                  │
│    scanlationGroup: string | null,                                               │
│    language: string | null                                                       │
│  }                                                                               │
│                                                                                  │
│  DEDUPLICATION KEY: "ingest-{seriesSourceId}-{chapterNumber}"                    │
│  (Same source + same chapter = same job, deduplicated by BullMQ)                 │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        CHAPTER INGEST WORKER (concurrency: 10)                   │
│                                                                                  │
│  1. Validate payload (Zod schema)                                                │
│  2. Generate dedup key: {seriesSourceId}:{chapterNumber}                         │
│  3. UPSERT chapter (idempotent):                                                 │
│     - If exists: UPDATE timestamps only                                          │
│     - If new: INSERT chapter row                                                 │
│  4. Update series.latest_chapter if needed                                       │
│  5. Enqueue notification job (if new chapter)                                    │
│  6. Record success metrics                                                       │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       │  If chapter was NEW (not update)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION QUEUE (Redis/BullMQ)                         │
│                                                                                  │
│  Job Data: {                                                                     │
│    seriesId: UUID,                                                               │
│    chapterId: UUID,                                                              │
│    chapterNumber: Decimal                                                        │
│  }                                                                               │
│                                                                                  │
│  DEDUPLICATION KEY: "notify-{seriesId}-{chapterId}"                              │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                        NOTIFICATION WORKER (concurrency: 10)                     │
│                                                                                  │
│  1. Find users with series in library + notify_new_chapters=true                 │
│  2. Batch insert notifications                                                   │
│  3. Trigger push notifications (if enabled)                                      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Deduplication Key Definition

### Problem Statement
- Same chapter number from **different sources** = **separate events** (both stored)
- Same chapter number from **same source** = **must not duplicate** (idempotent)

### Deduplication Key Formula

```
DEDUP_KEY = "{series_source_id}:{chapter_number}"
```

| Scenario | series_source_id | chapter_number | Dedup Key | Result |
|----------|------------------|----------------|-----------|--------|
| Ch 45 from MangaDex | `abc-123` | 45 | `abc-123:45` | New row |
| Ch 45 from MangaPark | `def-456` | 45 | `def-456:45` | New row (different source) |
| Ch 45 from MangaDex (re-poll) | `abc-123` | 45 | `abc-123:45` | UPSERT (update timestamps) |
| Ch 45.5 from MangaDex | `abc-123` | 45.5 | `abc-123:45.5` | New row |

### Database Constraint
The existing unique constraint enforces this at the DB level:
```sql
@@unique([series_source_id, chapter_number])  -- Already exists in schema
```

### Queue-Level Deduplication
BullMQ job ID prevents duplicate jobs in the queue:
```typescript
jobId: `ingest-${seriesSourceId}-${chapterNumber}`
```

---

## Pseudocode for Ingestion Worker

### 1. Poll Worker (Source Polling)

```typescript
// src/workers/processors/poll-source.processor.ts

interface PollSourceJob {
  seriesSourceId: string;  // UUID
}

async function processPollSource(job: Job<PollSourceJob>) {
  const { seriesSourceId } = job.data;
  
  // 1. VALIDATE & FETCH SOURCE
  const source = await prisma.seriesSource.findUnique({
    where: { id: seriesSourceId },
    include: { series: true }
  });
  
  if (!source) {
    return { status: 'skipped', reason: 'source_deleted' };
  }
  
  // 2. CHECK CIRCUIT BREAKER
  if (source.failure_count >= MAX_FAILURES) {
    await demoteSource(source.id);
    return { status: 'skipped', reason: 'circuit_breaker_open' };
  }
  
  // 3. CALL EXTERNAL API
  const scraper = getScraper(source.source_name);
  let scrapedChapters: ScrapedChapter[];
  
  try {
    scrapedChapters = await scraper.fetchChapters(source.source_id);
  } catch (error) {
    await recordFailure(source.id, error);
    throw error;  // Let BullMQ retry
  }
  
  // 4. GET EXISTING CHAPTERS FOR THIS SOURCE
  const existingChapters = await prisma.chapter.findMany({
    where: { series_source_id: source.id },
    select: { chapter_number: true }
  });
  
  const existingSet = new Set(
    existingChapters.map(c => c.chapter_number.toString())
  );
  
  // 5. FILTER TO NEW CHAPTERS ONLY
  const newChapters = scrapedChapters.filter(
    ch => !existingSet.has(ch.chapterNumber.toString())
  );
  
  // 6. ENQUEUE EACH NEW CHAPTER FOR INGESTION
  if (newChapters.length > 0) {
    const ingestJobs = newChapters.map(ch => ({
      name: 'ingest-chapter',
      data: {
        seriesId: source.series_id,
        seriesSourceId: source.id,
        chapterNumber: ch.chapterNumber,
        chapterTitle: ch.chapterTitle,
        chapterUrl: ch.chapterUrl,
        publishedAt: ch.publishedAt?.toISOString(),
        sourceChapterId: ch.sourceChapterId,
        volumeNumber: ch.volumeNumber,
        scanlationGroup: ch.scanlationGroup,
        language: ch.language,
      },
      opts: {
        // DEDUPLICATION: Same source + chapter = same job ID
        jobId: `ingest-${source.id}-${ch.chapterNumber}`,
      }
    }));
    
    await chapterIngestQueue.addBulk(ingestJobs);
  }
  
  // 7. UPDATE SOURCE METADATA
  await prisma.seriesSource.update({
    where: { id: source.id },
    data: {
      last_checked_at: new Date(),
      last_success_at: new Date(),
      failure_count: 0,  // Reset on success
    }
  });
  
  return {
    status: 'completed',
    newChapters: newChapters.length,
    totalScraped: scrapedChapters.length
  };
}
```

### 2. Chapter Ingest Worker (Idempotent Upsert)

```typescript
// src/workers/processors/chapter-ingest.processor.ts

interface ChapterIngestJob {
  seriesId: string;
  seriesSourceId: string;
  chapterNumber: number;
  chapterTitle: string | null;
  chapterUrl: string;
  publishedAt: string | null;
  sourceChapterId: string | null;
  volumeNumber: number | null;
  scanlationGroup: string | null;
  language: string | null;
}

async function processChapterIngest(job: Job<ChapterIngestJob>) {
  const data = validatePayload(job.data);  // Zod validation
  
  // IDEMPOTENT UPSERT
  // - If chapter exists: UPDATE discovered_at timestamp
  // - If new: INSERT full row
  const result = await prisma.chapter.upsert({
    where: {
      // Unique constraint: series_source_id + chapter_number
      series_source_id_chapter_number: {
        series_source_id: data.seriesSourceId,
        chapter_number: new Prisma.Decimal(data.chapterNumber),
      }
    },
    create: {
      series_id: data.seriesId,
      series_source_id: data.seriesSourceId,
      chapter_number: new Prisma.Decimal(data.chapterNumber),
      chapter_title: data.chapterTitle,
      chapter_url: data.chapterUrl,
      published_at: data.publishedAt ? new Date(data.publishedAt) : null,
      source_chapter_id: data.sourceChapterId,
      volume_number: data.volumeNumber,
      scanlation_group: data.scanlationGroup,
      language: data.language,
      discovered_at: new Date(),
      is_available: true,
    },
    update: {
      // Only update timestamps and availability on re-ingest
      discovered_at: new Date(),  // Refresh timestamp
      is_available: true,         // Mark as still available
      // Optionally update metadata if source provides better data:
      chapter_title: data.chapterTitle,
      published_at: data.publishedAt ? new Date(data.publishedAt) : undefined,
    }
  });
  
  // CHECK IF THIS WAS A NEW INSERT (not update)
  // We can detect this by comparing discovered_at with a threshold
  const isNewChapter = result.discovered_at.getTime() > Date.now() - 5000;
  
  if (isNewChapter) {
    // UPDATE SERIES LATEST CHAPTER (if this is higher)
    await prisma.series.update({
      where: { id: data.seriesId },
      data: {
        latest_chapter: {
          // Only update if new chapter is higher
          set: new Prisma.Decimal(data.chapterNumber),
        },
        last_chapter_at: new Date(),
      }
    });
    
    // QUEUE NOTIFICATION
    await notificationQueue.add(
      'new-chapter',
      {
        seriesId: data.seriesId,
        chapterId: result.id,
        chapterNumber: data.chapterNumber,
      },
      {
        jobId: `notify-${data.seriesId}-${result.id}`,  // Dedup notifications
      }
    );
  }
  
  return {
    status: isNewChapter ? 'created' : 'updated',
    chapterId: result.id,
    chapterNumber: data.chapterNumber,
  };
}
```

### 3. Alternative: Batch Ingest (Higher Throughput)

```typescript
// For bulk ingestion, use createMany with skipDuplicates

async function processBatchIngest(job: Job<BatchIngestJob>) {
  const { seriesSourceId, chapters } = job.data;
  
  // Prepare batch data
  const chapterData = chapters.map(ch => ({
    series_id: ch.seriesId,
    series_source_id: seriesSourceId,
    chapter_number: new Prisma.Decimal(ch.chapterNumber),
    chapter_title: ch.chapterTitle,
    chapter_url: ch.chapterUrl,
    published_at: ch.publishedAt ? new Date(ch.publishedAt) : null,
    discovered_at: new Date(),
    is_available: true,
  }));
  
  // IDEMPOTENT: skipDuplicates ignores rows that violate unique constraint
  const result = await prisma.chapter.createMany({
    data: chapterData,
    skipDuplicates: true,  // Key for idempotency!
  });
  
  // For updates on existing rows, run a separate update:
  await prisma.$executeRaw`
    UPDATE chapters 
    SET discovered_at = NOW(), is_available = true
    WHERE series_source_id = ${seriesSourceId}
    AND chapter_number = ANY(${chapters.map(c => c.chapterNumber)})
  `;
  
  return { inserted: result.count };
}
```

---

## Retry & Failure Handling Strategy

### Retry Configuration

```typescript
// Queue configuration with exponential backoff
const chapterIngestQueue = new Queue('chapter-ingest', {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,                    // Max 3 attempts
    backoff: {
      type: 'exponential',
      delay: 5000,                  // 5s, 10s, 20s
    },
    removeOnComplete: { 
      count: 1000,                  // Keep last 1000 completed
      age: 3600                     // Or 1 hour, whichever first
    },
    removeOnFail: { 
      count: 5000,                  // Keep last 5000 failed for debugging
      age: 86400 * 7                // Or 7 days
    },
  },
});
```

### Error Classification

```typescript
enum ErrorType {
  RETRYABLE = 'retryable',      // Network timeout, rate limit, 5xx
  NON_RETRYABLE = 'non_retry',  // 404, invalid data, auth failure
  FATAL = 'fatal',              // DB connection lost, OOM
}

function classifyError(error: unknown): ErrorType {
  if (error instanceof ScraperError) {
    return error.isRetryable ? ErrorType.RETRYABLE : ErrorType.NON_RETRYABLE;
  }
  
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // Unique constraint violation - idempotent, not an error
    if (error.code === 'P2002') return ErrorType.NON_RETRYABLE;
    // Connection errors - retry
    if (error.code === 'P2024') return ErrorType.RETRYABLE;
  }
  
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('timeout')) return ErrorType.RETRYABLE;
    if (msg.includes('rate limit')) return ErrorType.RETRYABLE;
    if (msg.includes('econnrefused')) return ErrorType.RETRYABLE;
  }
  
  return ErrorType.RETRYABLE;  // Default to retry
}
```

### Circuit Breaker Pattern

```typescript
const MAX_CONSECUTIVE_FAILURES = 5;
const CIRCUIT_RESET_HOURS = 24;

async function checkCircuitBreaker(sourceId: string): Promise<boolean> {
  const source = await prisma.seriesSource.findUnique({
    where: { id: sourceId },
    select: { failure_count: true, last_checked_at: true }
  });
  
  if (!source) return false;  // Source deleted
  
  // Circuit is OPEN if too many failures
  if (source.failure_count >= MAX_CONSECUTIVE_FAILURES) {
    // Check if enough time has passed to try again
    const hoursSinceLastCheck = source.last_checked_at 
      ? (Date.now() - source.last_checked_at.getTime()) / (1000 * 60 * 60)
      : Infinity;
    
    if (hoursSinceLastCheck < CIRCUIT_RESET_HOURS) {
      return false;  // Circuit still open
    }
  }
  
  return true;  // Circuit closed, proceed
}

async function recordFailure(sourceId: string, error: Error): Promise<void> {
  await prisma.seriesSource.update({
    where: { id: sourceId },
    data: {
      failure_count: { increment: 1 },
      last_checked_at: new Date(),
      // Demote to COLD after failures
      sync_priority: 'COLD',
      // Extend next check exponentially based on failure count
      next_check_at: new Date(Date.now() + 24 * 60 * 60 * 1000),  // 24 hours
    }
  });
}

async function recordSuccess(sourceId: string): Promise<void> {
  await prisma.seriesSource.update({
    where: { id: sourceId },
    data: {
      failure_count: 0,  // Reset circuit breaker
      last_checked_at: new Date(),
      last_success_at: new Date(),
    }
  });
}
```

### Dead Letter Queue (DLQ)

```typescript
// Jobs that fail all retries go to DLQ for manual inspection
const deadLetterQueue = new Queue('chapter-ingest-dlq', {
  connection: redis,
});

// Worker event handler
chapterIngestWorker.on('failed', async (job, error) => {
  if (job && job.attemptsMade >= job.opts.attempts!) {
    // Move to DLQ after exhausting retries
    await deadLetterQueue.add('failed-ingest', {
      originalJob: job.data,
      error: error.message,
      stack: error.stack,
      failedAt: new Date().toISOString(),
      attempts: job.attemptsMade,
    });
    
    console.error(`[ChapterIngest] Job ${job.id} moved to DLQ after ${job.attemptsMade} attempts`);
  }
});
```

---

## Summary Table

| Component | Queue Name | Dedup Key | Concurrency | Retries |
|-----------|------------|-----------|-------------|---------|
| Poll Scheduler | `poll-source` | `poll-{sourceId}-{timestamp}` | 5 | 3 |
| Chapter Ingest | `chapter-ingest` | `ingest-{sourceId}-{chapterNum}` | 10 | 3 |
| Notifications | `notifications` | `notify-{seriesId}-{chapterId}` | 10 | 5 |
| Dead Letter | `chapter-ingest-dlq` | N/A | 1 | 0 |

---

## Key Design Principles

1. **Deduplication at Multiple Levels**
   - Queue level: BullMQ jobId
   - Database level: Unique constraint on (series_source_id, chapter_number)

2. **Source Independence**
   - Each SeriesSource has its own ID
   - Same chapter from different sources = different dedup keys

3. **Idempotent Operations**
   - UPSERT instead of INSERT
   - skipDuplicates for batch operations
   - Re-ingestion updates timestamps, never creates duplicates

4. **Graceful Degradation**
   - Circuit breaker prevents hammering failed sources
   - Exponential backoff on retries
   - DLQ for failed jobs requiring manual intervention

5. **Observability**
   - All jobs log completion/failure
   - Metrics on queue depth, processing time
   - Error classification for alerting
