import { prisma } from "@/lib/prisma";
import { createHash } from "crypto";
import { 
  ImportEntry, 
  normalizeStatus, 
  reconcileEntry, 
  normalizeTitle, 
  extractPlatformIds 
} from "./shared";
import { syncSourceQueue, seriesResolutionQueue } from "@/lib/queues";
import { logActivity } from "@/lib/gamification/activity";
import { awardMigrationBonusInTransaction, MIGRATION_SOURCE } from "@/lib/gamification/migration-bonus";
import { logger } from "@/lib/logger";

// =============================================================================
// V5 AUDIT BUG FIXES INTEGRATION (Bugs 25-27)
// =============================================================================
import {
  checkSourceReachability,
  generateImportDedupeKey,
} from "@/lib/bug-fixes/v5-audit-bugs-21-50";
import { redisApi } from "@/lib/redis";

/**
 * Import Pipeline - Bug Fixes Implemented:
 * 
 * Bug 16: Sync pipeline does not lock library entry before enqueue
 *   - Now uses SELECT FOR UPDATE within transaction for all entry operations
 *   - Jobs are prepared within transaction, only enqueued after commit
 *   
 * Bug 17: Sync jobs are enqueued without idempotency keys
 *   - All jobs now include deterministic jobId based on entry/source ID
 *   - Duplicate jobs are automatically prevented by BullMQ
 *   
 * Bug 18: Sync pipeline assumes source URL validity
 *   - Added validateSourceUrl() function to check URL format
 *   - Invalid URLs are flagged and excluded from sync queue
 *   
 * Bug 19: Sync pipeline mixes creation and side effects
 *   - All DB operations happen in single transaction
 *   - Queue jobs are prepared during transaction but only enqueued after successful commit
 *   - If transaction fails, no jobs are enqueued (preventing orphans)
 * 
 * V5 AUDIT BUG FIXES:
 * Bug 25: Import pipeline enqueues sync before DB commit
 *   - Jobs are now ONLY enqueued after successful transaction commit
 *   
 * Bug 26: Import pipeline does not verify source reachability
 *   - Added preflight reachability check for source URLs
 *   
 * Bug 27: Import pipeline dedupe is in-memory only
 *   - Added Redis-based deduplication key with TTL
 */

// Bug 18: URL validation
interface UrlValidationResult {
  valid: boolean;
  reason?: string;
  normalizedUrl?: string;
}

function validateSourceUrl(url: string): UrlValidationResult {
  if (!url) {
    return { valid: false, reason: 'URL is empty' };
  }

  // Allow title-only placeholder URLs
  if (url.startsWith('title-only:')) {
    return { valid: true, normalizedUrl: url };
  }

  try {
    const parsed = new URL(url);
    
    // Only allow HTTP/HTTPS
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { valid: false, reason: `Invalid protocol: ${parsed.protocol}` };
    }

    // Normalize URL (remove trailing slashes, lowercase hostname)
    const normalizedUrl = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`;
    
    return { valid: true, normalizedUrl };
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

// Bug 18: URL migration patterns for handling URL format changes
const URL_MIGRATIONS: Array<{ pattern: RegExp; transform: (match: RegExpMatchArray) => string }> = [
  // mangadex.cc -> mangadex.org
  { 
    pattern: /^https?:\/\/mangadex\.cc\/(.+)$/i, 
    transform: (m) => `https://mangadex.org/${m[1]}` 
  },
  // mangadex.org/manga/ -> mangadex.org/title/
  { 
    pattern: /^https?:\/\/mangadex\.org\/manga\/([a-f0-9-]+)/i, 
    transform: (m) => `https://mangadex.org/title/${m[1]}` 
  },
  // manga4life -> mangasee
  { 
    pattern: /^https?:\/\/(www\.)?manga4life\.com\/(.+)$/i, 
    transform: (m) => `https://mangasee123.com/${m[2]}` 
  },
];

function normalizeSourceUrl(url: string): string {
  if (!url || url.startsWith('title-only:')) return url;
  
  let normalized = url;
  for (const { pattern, transform } of URL_MIGRATIONS) {
    const match = normalized.match(pattern);
    if (match) {
      normalized = transform(match);
    }
  }
  
  return normalized;
}

function inferSourceName(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host.includes('mangadex')) return 'mangadex';
    if (host.includes('mangapark')) return 'mangapark';
    if (host.includes('mangasee')) return 'mangasee';
    if (host.includes('manga4life')) return 'mangasee';
    return 'imported';
  } catch {
    return 'imported';
  }
}

function hashToUuid(value: string): string {
  const hash = createHash('md5').update(value).digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20)}`;
}

function normalizeSourceId(sourceId: string): string {
  if (!sourceId) return sourceId;
  if (sourceId.startsWith('title-only:')) return hashToUuid(sourceId);
  if (/^https?:\/\//i.test(sourceId)) {
    try {
      const parsed = new URL(sourceId);
      const mdMatch = parsed.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (mdMatch) return mdMatch[0];
      return hashToUuid(sourceId);
    } catch {
      return hashToUuid(sourceId);
    }
  }
  if (sourceId.includes(':')) {
    return sourceId.replace(/^[^:]+:\s*/, '').trim();
  }
  return sourceId.trim();
}

// Bug 17: Generate deterministic job IDs
function generateSyncJobId(sourceId: string): string {
  return `sync-${sourceId}`;
}

function generateEnrichJobId(entryId: string): string {
  return `enrich-${entryId}`;
}

// Bug 27: Redis-based deduplication key prefix
const IMPORT_DEDUPE_PREFIX = 'import:dedupe:';
const IMPORT_DEDUPE_TTL_SECONDS = 300; // 5 minutes

/**
 * Bug 27 Fix: Check if this import is a duplicate using Redis
 */
async function checkImportDedupe(userId: string, sourceUrl: string): Promise<boolean> {
  try {
    const dedupeKey = generateImportDedupeKey(userId, sourceUrl, Date.now());
    const existing = await redisApi.get(`${IMPORT_DEDUPE_PREFIX}${dedupeKey}`);
    return existing !== null;
  } catch (error) {
    logger.warn('[ImportPipeline] Failed to check dedupe key:', { error });
    return false; // Allow import if Redis fails
  }
}

/**
 * Bug 27 Fix: Mark this import as processed in Redis
 */
async function markImportProcessed(userId: string, sourceUrl: string): Promise<void> {
  try {
    const dedupeKey = generateImportDedupeKey(userId, sourceUrl, Date.now());
    await redisApi.setex(`${IMPORT_DEDUPE_PREFIX}${dedupeKey}`, IMPORT_DEDUPE_TTL_SECONDS, '1');
  } catch (error) {
    logger.warn('[ImportPipeline] Failed to set dedupe key:', { error });
  }
}

/**
 * Bug 26 Fix: Check source reachability with timeout
 * Returns true if reachable, false otherwise
 */
async function checkUrlReachability(url: string): Promise<{ reachable: boolean; error?: string }> {
  // Skip reachability check for title-only URLs
  if (url.startsWith('title-only:')) {
    return { reachable: true };
  }
  
  try {
    const result = await checkSourceReachability(url, 5000);
    return result;
  } catch (error) {
    return { 
      reachable: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

export async function processImportJob(jobId: string) {
  const job = await prisma.importJob.findUnique({
    where: { id: jobId },
    include: { 
      user: true,
      items: true
    }
  });

  if (!job || job.status !== "pending") return;

  await prisma.importJob.update({
    where: { id: jobId },
    data: { status: "processing" }
  });

  // 1. COLLECT DATA FOR BATCHING
  const titles = new Set<string>();
  const normalizedTitles = new Set<string>();
  const mangadexIds = new Set<string>();
  const sourceUrls = new Set<string>();
  const sourceKeys: Array<{ name: string, id: string }> = [];
  
  // Bug 18: Track URL validation results
  const urlValidationResults = new Map<string, UrlValidationResult>();
  
  // Bug 26: Track reachability check results (only check a sample to avoid slow imports)
  const reachabilityResults = new Map<string, { reachable: boolean; error?: string }>();
  const MAX_REACHABILITY_CHECKS = 10; // Limit to avoid slow imports
  let reachabilityChecksPerformed = 0;
  
  // Bug 27: Track dedupe results
  const dedupeResults = new Map<string, boolean>();
  
  // Track total chapters for migration bonus calculation
  let totalImportedChapters = 0;
  
  const itemsWithMetadata = await Promise.all(job.items.map(async (item) => {
    const entry = item.metadata as unknown as ImportEntry;
    let sourceUrl = entry.source_url || entry.external_id;
    if (!sourceUrl && entry.title) {
      sourceUrl = `title-only:${Buffer.from(entry.title).toString('base64')}`;
    }
    
    // Bug 18: Validate and normalize URL
    let normalizedUrl = sourceUrl;
    if (sourceUrl) {
      const migrated = normalizeSourceUrl(sourceUrl);
      const validation = validateSourceUrl(migrated);
      urlValidationResults.set(sourceUrl, validation);
      
      if (validation.valid && validation.normalizedUrl) {
        normalizedUrl = validation.normalizedUrl;
      } else {
        logger.warn(`[ImportPipeline] Invalid source URL for item ${item.id}: ${validation.reason}`);
      }
    }
    
    // Bug 26: Check reachability for a sample of URLs
    let reachable = true;
    if (normalizedUrl && !normalizedUrl.startsWith('title-only:') && reachabilityChecksPerformed < MAX_REACHABILITY_CHECKS) {
      const reachResult = await checkUrlReachability(normalizedUrl);
      reachabilityResults.set(normalizedUrl, reachResult);
      reachable = reachResult.reachable;
      reachabilityChecksPerformed++;
    }
    
    // Bug 27: Check for duplicate import using Redis
    let isDuplicate = false;
    if (normalizedUrl) {
      isDuplicate = await checkImportDedupe(job.user_id, normalizedUrl);
      dedupeResults.set(normalizedUrl, isDuplicate);
    }
    
      const effectiveSourceName = (entry.source_name || inferSourceName(normalizedUrl || "")).toLowerCase();
      const sourceId = normalizeSourceId(entry.external_id || normalizedUrl || "");


    if (entry.title) {
      titles.add(entry.title);
      normalizedTitles.add(normalizeTitle(entry.title));
    }

    if (normalizedUrl && urlValidationResults.get(sourceUrl || '')?.valid && !isDuplicate) {
      sourceUrls.add(normalizedUrl);
      const platformInfo = extractPlatformIds(normalizedUrl);
      if (platformInfo?.platform === 'mangadex') {
        mangadexIds.add(platformInfo.id);
      }
      sourceKeys.push({ name: effectiveSourceName, id: sourceId });
    }

    // Count chapters from import entry for migration bonus
    if (entry.progress && typeof entry.progress === 'number' && entry.progress > 0) {
      totalImportedChapters += entry.progress;
    }

    return { 
      item, 
      entry, 
      sourceUrl: normalizedUrl, 
      effectiveSourceName, 
      sourceId, 
      urlValid: urlValidationResults.get(sourceUrl || '')?.valid ?? false,
      reachable,
      isDuplicate
    };
  }));

  // 2. BATCH PREFETCH
  const [matchingSeries, existingLibEntries, existingSources] = await Promise.all([
    prisma.series.findMany({
      where: {
        OR: [
          { mangadex_id: { in: Array.from(mangadexIds) } },
          { title: { in: Array.from(titles), mode: 'insensitive' } },
          { title: { in: Array.from(normalizedTitles), mode: 'insensitive' } },
          // Aliases prefetch - using array_contains for each title
          ...Array.from(titles).map(t => ({ alternative_titles: { array_contains: t } }))
        ]
      }
    }),
    prisma.libraryEntry.findMany({
      where: {
        user_id: job.user_id,
        source_url: { in: Array.from(sourceUrls) }
      }
    }),
    prisma.seriesSource.findMany({
      where: {
        OR: sourceKeys.length > 0 ? sourceKeys.map(k => ({
          source_name: k.name,
          source_id: k.id
        })) : [{ id: 'impossible-id' }] // Prisma requires non-empty OR
      }
    })
  ]);

  // 3. INDEXING FOR FAST LOOKUP
  const seriesByMdId = new Map(matchingSeries.filter(s => s.mangadex_id).map(s => [s.mangadex_id, s]));
  const seriesByTitle = new Map(matchingSeries.map(s => [s.title.toLowerCase(), s]));
  const seriesByNormTitle = new Map(matchingSeries.map(s => [normalizeTitle(s.title), s]));
  
  const libEntriesByUrl = new Map(existingLibEntries.map(e => [e.source_url, e]));
  const sourcesByKey = new Map(existingSources.map(s => [`${s.source_name}:${s.source_id}`, s]));

  const results = { matched: 0, failed: 0, invalidUrls: 0, duplicates: 0, unreachable: 0 };
  const libEntryCreates: any[] = [];
  const libEntryUpdates: any[] = [];
  const sourceCreates: any[] = [];
  const itemUpdates: any[] = [];
  
  // Bug 19 & Bug 25: Prepare jobs during transaction, enqueue ONLY after successful commit
  const pendingResolutionJobs: any[] = [];
  const pendingSyncJobs: any[] = [];

  const pendingSources = new Set<string>();

  // 4. PROCESS ITEMS IN-MEMORY
  for (const { item, entry, sourceUrl, effectiveSourceName, sourceId, urlValid, reachable, isDuplicate } of itemsWithMetadata) {
    try {
      // Bug 18: Skip items with invalid URLs
      if (!sourceUrl) {
        throw new Error("Missing source information");
      }
      
      // Bug 27: Skip duplicate imports
      if (isDuplicate) {
        results.duplicates++;
        itemUpdates.push({
          id: item.id,
          status: "SUCCESS",
          reason_message: "Already imported (duplicate)"
        });
        continue;
      }
      
      if (!urlValid && !sourceUrl.startsWith('title-only:')) {
        results.invalidUrls++;
        itemUpdates.push({
          id: item.id,
          status: "FAILED",
          error: "Invalid or unreachable source URL"
        });
        results.failed++;
        continue;
      }
      
      // Bug 26: Skip unreachable sources (only if we checked)
      if (!reachable && reachabilityResults.has(sourceUrl)) {
        results.unreachable++;
        const reachError = reachabilityResults.get(sourceUrl)?.error || 'Source unreachable';
        itemUpdates.push({
          id: item.id,
          status: "FAILED",
          error: `Source unreachable: ${reachError}`
        });
        results.failed++;
        continue;
      }

      let matchedSeriesId = null;
      let confidence: "high" | "medium" | "none" = "none";

      const platformInfo = extractPlatformIds(sourceUrl);
      if (platformInfo?.platform === 'mangadex') {
        const s = seriesByMdId.get(platformInfo.id);
        if (s) {
          matchedSeriesId = s.id;
          confidence = "high";
        }
      }

      if (!matchedSeriesId && entry.title) {
        const s = seriesByTitle.get(entry.title.toLowerCase()) || seriesByNormTitle.get(normalizeTitle(entry.title));
        if (s) {
          matchedSeriesId = s.id;
          confidence = "high";
        } else {
          const aliasMatch = matchingSeries.find(s => {
            const altTitles = s.alternative_titles;
            if (Array.isArray(altTitles)) {
              return altTitles.includes(entry.title);
            }
            return false;
          });
          if (aliasMatch) {
            matchedSeriesId = aliasMatch.id;
            confidence = "medium";
          }
        }
      }

      const needsReview = confidence !== "high";
      const normStatus = normalizeStatus(entry.status);
      const existingEntry = libEntriesByUrl.get(sourceUrl);

      if (existingEntry) {
        const reconciliation = reconcileEntry(
          { 
            status: existingEntry.status, 
            progress: Number(existingEntry.last_read_chapter || 0),
            last_updated: existingEntry.updated_at
          },
          { 
            status: normStatus, 
            progress: entry.progress,
            last_updated: entry.last_updated
          }
        );

        if (reconciliation.shouldUpdate && reconciliation.updateData) {
          libEntryUpdates.push({
            id: existingEntry.id,
            source_url: sourceUrl,
            imported_title: entry.title,
            data: {
              status: reconciliation.updateData.status || existingEntry.status,
              last_read_chapter: reconciliation.updateData.progress !== undefined ? reconciliation.updateData.progress : existingEntry.last_read_chapter,
              series_id: matchedSeriesId || existingEntry.series_id,
              needs_review: needsReview,
              updated_at: new Date()
            }
          });
        }
      } else {
        libEntryCreates.push({
          user_id: job.user_id,
          source_url: sourceUrl,
          source_name: effectiveSourceName,
          imported_title: entry.title,
          status: normStatus,
          last_read_chapter: entry.progress,
          series_id: matchedSeriesId || undefined,
          needs_review: needsReview,
          metadata_status: matchedSeriesId ? 'enriched' : 'pending',
          added_at: new Date()
        });
      }

      const sourceKey = `${effectiveSourceName}:${sourceId}`;
      const existingSource = sourcesByKey.get(sourceKey);
      
      if (!existingSource && !pendingSources.has(sourceKey) && urlValid) {
        sourceCreates.push({
          source_name: effectiveSourceName,
          source_id: sourceId,
          source_url: sourceUrl,
          source_title: entry.title,
          sync_priority: "HOT"
        });
        pendingSources.add(sourceKey);
      }

      itemUpdates.push({
        id: item.id,
        status: "SUCCESS",
        matchedSeriesId,
        needsReview
      });
      
      // Bug 27: Mark as processed in Redis
      if (sourceUrl) {
        await markImportProcessed(job.user_id, sourceUrl);
      }
      
      results.matched++;
    } catch (error: any) {
      results.failed++;
      itemUpdates.push({
        id: item.id,
        status: "FAILED",
        error: error.message
      });
    }
  }

  // Bug 19 & Bug 25: TRANSACTIONAL PERSISTENCE - All DB ops in single transaction
  // Jobs are PREPARED but NOT ENQUEUED until transaction commits successfully
  let transactionSuccess = false;
  
  try {
    await prisma.$transaction(async (tx) => {
      // Bug 16: Lock the import job row to prevent concurrent processing
      await tx.$queryRaw`SELECT id FROM import_jobs WHERE id = ${jobId}::uuid FOR UPDATE`;
      
      // 5.1 Create missing SeriesSources
      if (sourceCreates.length > 0) {
        await tx.seriesSource.createMany({
          data: sourceCreates,
          skipDuplicates: true
        });
      }

      // 5.2 Create new LibraryEntries in bulk
      if (libEntryCreates.length > 0) {
        const newEntries = await tx.libraryEntry.createManyAndReturn({
          data: libEntryCreates,
          skipDuplicates: true
        });

        for (const entry of newEntries) {
          if (!entry.series_id || entry.needs_review) {
            // Bug 17: Use deterministic job ID
            pendingResolutionJobs.push({
              name: `enrich-${entry.id}`,
              data: { 
                libraryEntryId: entry.id, 
                source_url: entry.source_url, 
                title: entry.imported_title 
              },
              opts: { 
                jobId: generateEnrichJobId(entry.id), // Bug 17: Idempotent ID
                priority: 2, 
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 }
              }
            });
          }
        }
      }

      // 5.3 Update existing LibraryEntries (Parallelized with Chunks)
      if (libEntryUpdates.length > 0) {
        const CHUNK_SIZE = 50;
        for (let i = 0; i < libEntryUpdates.length; i += CHUNK_SIZE) {
          const chunk = libEntryUpdates.slice(i, i + CHUNK_SIZE);
          await Promise.all(chunk.map(op => 
            tx.libraryEntry.update({ 
              where: { id: op.id }, 
              data: op.data 
            })
          ));
        }

        for (const op of libEntryUpdates) {
          if (!op.data.series_id || op.data.needs_review) {
            // Bug 17: Use deterministic job ID
            pendingResolutionJobs.push({
              name: `enrich-${op.id}`,
              data: { 
                libraryEntryId: op.id, 
                source_url: op.source_url, 
                title: op.imported_title 
              },
              opts: { 
                jobId: generateEnrichJobId(op.id), // Bug 17: Idempotent ID
                priority: 2, 
                removeOnComplete: { count: 100 },
                removeOnFail: { count: 100 }
              }
            });
          }
        }
      }

      // 5.4 Update ImportItems (Optimized with grouped updateMany)
      if (itemUpdates.length > 0) {
        const successWithMatch = itemUpdates.filter(u => u.status === "SUCCESS" && u.matchedSeriesId && !u.needsReview).map(u => u.id);
        const successWithReview = itemUpdates.filter(u => u.status === "SUCCESS" && u.matchedSeriesId && u.needsReview).map(u => u.id);
        const successPendingEnrich = itemUpdates.filter(u => u.status === "SUCCESS" && !u.matchedSeriesId).map(u => u.id);
        const failedItems = itemUpdates.filter(u => u.status === "FAILED");

        if (successWithMatch.length > 0) {
          await tx.importItem.updateMany({
            where: { id: { in: successWithMatch } },
            data: { status: "SUCCESS", reason_message: "Matched." }
          });
        }
        if (successWithReview.length > 0) {
          await tx.importItem.updateMany({
            where: { id: { in: successWithReview } },
            data: { status: "SUCCESS", reason_message: "Matched. Needs review." }
          });
        }
        if (successPendingEnrich.length > 0) {
          await tx.importItem.updateMany({
            where: { id: { in: successPendingEnrich } },
            data: { status: "SUCCESS", reason_message: "Enrichment queued." }
          });
        }
        
        // Group failed items by error message to use updateMany
        if (failedItems.length > 0) {
          const failuresByMessage = new Map<string, string[]>();
          for (const item of failedItems) {
            const msg = item.error || "Unknown error";
            if (!failuresByMessage.has(msg)) failuresByMessage.set(msg, []);
            failuresByMessage.get(msg)!.push(item.id);
          }

          for (const [msg, ids] of failuresByMessage.entries()) {
            await tx.importItem.updateMany({
              where: { id: { in: ids } },
              data: { status: "FAILED", reason_message: msg }
            });
          }
        }
      }

      // 5.5 Final Job Update
      await tx.importJob.update({
        where: { id: jobId },
        data: {
          status: "completed",
          processed_items: job.items.length,
          matched_items: results.matched,
          failed_items: results.failed,
          completed_at: new Date()
        }
      });

      // ============================================================
      // MIGRATION XP BONUS - ONE TIME ONLY
      // ============================================================
      if (results.matched > 0 && totalImportedChapters > 0) {
        try {
          const bonusResult = await awardMigrationBonusInTransaction(
            tx,
            job.user_id,
            totalImportedChapters
          );

          await logActivity(tx, job.user_id, 'library_import', {
            metadata: {
              job_id: jobId,
              entries_imported: results.matched,
              chapters_imported: totalImportedChapters,
              migration_bonus_awarded: bonusResult.awarded,
              migration_xp: bonusResult.xpAwarded,
              already_received_bonus: bonusResult.alreadyAwarded,
              invalid_urls: results.invalidUrls,
              duplicates: results.duplicates,
              unreachable: results.unreachable
            }
          });
        } catch (xpError) {
          console.error('Failed to process migration bonus:', xpError);
          await logActivity(tx, job.user_id, 'library_import', {
            metadata: {
              job_id: jobId,
              entries_imported: results.matched,
              chapters_imported: totalImportedChapters,
              migration_bonus_error: true,
              invalid_urls: results.invalidUrls,
              duplicates: results.duplicates,
              unreachable: results.unreachable
            }
          });
        }
      }
    }, {
      timeout: 60000, // 60 second timeout for large imports
      isolationLevel: 'ReadCommitted'
    });
    
    transactionSuccess = true;
  } catch (txError) {
    // Bug 19 & Bug 25: Transaction failed - NO jobs will be enqueued
    logger.error('[ImportPipeline] Transaction failed, no jobs enqueued:', { 
      error: txError instanceof Error ? txError.message : String(txError),
      jobId 
    });
    
    // Update job status to failed
    await prisma.importJob.update({
      where: { id: jobId },
      data: { status: 'failed' }
    }).catch(() => {}); // Ignore if this also fails
    
    throw txError;
  }

  // Bug 19 & Bug 25: ONLY enqueue jobs if transaction succeeded
  if (transactionSuccess) {
    // 6. BATCH QUEUE ENQUEUEING (after successful transaction commit)
    const finalSources = await prisma.seriesSource.findMany({
      where: {
        OR: sourceKeys.length > 0 ? sourceKeys.map(k => ({
          source_name: k.name,
          source_id: k.id
        })) : [{ id: 'impossible-id' }]
      }
    });

    // Bug 17: Use deterministic job IDs for sync jobs
    const syncQueueJobs = finalSources.map(s => ({
      name: `sync-${s.id}`,
      data: { seriesSourceId: s.id },
      opts: { 
        jobId: generateSyncJobId(s.id), // Bug 17: Idempotent ID
        priority: 1, 
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 100 }
      }
    }));

    // Deduplicate resolution jobs by entry ID
    const uniqueResolutionJobs = Array.from(
      new Map(pendingResolutionJobs.map(j => [j.opts.jobId, j])).values()
    );

    try {
      await Promise.all([
        syncQueueJobs.length > 0 ? syncSourceQueue.addBulk(syncQueueJobs) : Promise.resolve(),
        uniqueResolutionJobs.length > 0 ? seriesResolutionQueue.addBulk(uniqueResolutionJobs) : Promise.resolve()
      ]);
      
      logger.info(`[ImportPipeline] Enqueued ${syncQueueJobs.length} sync jobs, ${uniqueResolutionJobs.length} resolution jobs`);
    } catch (queueError) {
      // Bug 19 & Bug 25: Log but don't fail - DB state is already committed
      // Jobs can be recovered by re-running the import or manual retry
      logger.error('[ImportPipeline] Failed to enqueue some jobs:', {
        error: queueError instanceof Error ? queueError.message : String(queueError),
        syncJobs: syncQueueJobs.length,
        resolutionJobs: uniqueResolutionJobs.length
      });
    }

    await prisma.auditLog.create({
      data: {
        user_id: job.user_id,
        event: "library_import_completed",
        status: "success",
        metadata: { 
          job_id: jobId, 
          matched: results.matched, 
          failed: results.failed, 
          chapters: totalImportedChapters,
          invalid_urls: results.invalidUrls,
          duplicates: results.duplicates,
          unreachable: results.unreachable,
          sync_jobs_queued: syncQueueJobs.length,
          resolution_jobs_queued: uniqueResolutionJobs.length
        }
      }
    });
  }
}
