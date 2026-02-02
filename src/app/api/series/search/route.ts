import { supabaseAdminRead } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"
import { checkRateLimit, sanitizeInput, handleApiError, ApiError, ErrorCodes, getClientIp, escapeILikePattern } from "@/lib/api-utils"
import { checkSourceQueue, isQueueHealthy } from "@/lib/queues"
import { areWorkersOnline, redis, waitForRedis, REDIS_KEY_PREFIX } from "@/lib/redis"
import { detectSearchIntent } from "@/lib/search-intent"
import { recordSearchEvent } from "@/lib/analytics"
import { getBestCoversBatch, isValidCoverUrl } from "@/lib/cover-resolver"
import { FilterSchema } from "@/lib/schemas/filters"
import { FILTER_PARAMS, DEPRECATED_PARAMS } from "@/lib/constants/filters"
import { 
  buildSeriesQuery, 
  createSearchCursor,
  getSeriesIdsWithMultipleSources,
  stripSourcesFromResults
} from "@/lib/api/search-query"
import { prisma } from "@/lib/prisma"
import { PRODUCTION_QUERIES } from "@/lib/sql/production-queries"
import {
  getCachedSearchResult,
  setCachedSearchResult,
  checkPendingSearch,
  markSearchPending,
  clearPendingSearch,
  waitForPendingSearch,
  SEARCH_PRIORITY,
  consumeSearchQuota,
  checkPremiumSlidingWindow,
  incrementPremiumConcurrency,
deferSearchQuery,
} from "@/lib/search-cache"
import { 
  normalizeSearchQuery, 
  recordSearchIntent, 
  shouldEnqueueExternalSearch, 
  markQueryEnqueued,
  markQueryDeferred,
  EnqueueDecision
} from "@/lib/search-utils"
import { promoteSeriesTier } from "@/lib/catalog-tiers"
import { searchMangaDex, MangaDexCandidate } from "@/lib/mangadex"

// =============================================================================
// V5 AUDIT BUG FIXES 59-60: Import search utilities
// =============================================================================
import {
  SEARCH_LIMITS,
  capSearchResults,
  sortSearchResultsDeterministic,
} from "@/lib/bug-fixes/v5-audit-bugs-51-80"

function getDiscoveryInfo(status: string, results: any[], skipReason?: string, isGuest?: boolean) {
  const resultsCount = results.length
  if (status === 'limit_reached') {
    return {
      discovery_status: 'limit_reached',
      discovery_state: 'LOCAL_ONLY',
      message: isGuest 
        ? "GUEST_LIMIT: You've reached the guest search limit. Please log in for more searches."
        : "LIMIT_REACHED: You've reached your daily external search quota. Showing local results only."
    }
  }
    if (skipReason === 'workers_offline') {
      return {
        discovery_status: 'maintenance',
        discovery_state: 'WORKERS_OFFLINE',
        message: "SYSTEM_BUSY: Our external discovery workers are currently offline. Showing local results only."
      }
    }
    if (skipReason === 'queue_overload') {
      return {
        discovery_status: 'maintenance',
        discovery_state: 'WORKERS_BUSY',
        message: "SYSTEM_BUSY: Discovery queue is currently overloaded. Showing local results only."
      }
    }
  if (skipReason === 'guest_gated') {
    return {
      discovery_status: 'login_required',
      discovery_state: 'GUEST_RESTRICTED',
      message: "LOGIN_REQUIRED: Deep discovery for repeat searches is reserved for logged-in users. Please sign in to search external sources."
    }
  }
  if (status === 'resolving') {
    return {
      discovery_status: resultsCount > 0 ? 'resolved' : 'queued',
      discovery_state: resultsCount > 0 ? 'FOUND' : 'QUEUED_FOR_DISCOVERY',
      message: resultsCount > 0 
        ? "FOUND: We found some matches in our database. We are also searching external sources for more results."
        : "QUEUED_FOR_DISCOVERY: We couldn't find any local matches. An external search has been queued. Please check back in a few seconds."
    }
  }
  if (resultsCount > 0) {
    return {
      discovery_status: 'resolved',
      discovery_state: 'FOUND',
      message: "FOUND: Search completed successfully."
    }
  }
  return {
    discovery_status: 'not_found',
    discovery_state: 'NOT_FOUND',
    message: "NOT_FOUND: No series found matching your search criteria."
  }
}

const VALID_SOURCES = new Set(['all', 'mangadex', 'multiple'])

/**
 * Validates cursor format to prevent injection attacks.
 * Cursor format: base64-encoded JSON with score, id, and sortBy fields.
 */
function validateCursor(cursor: string | null | undefined): boolean {
  if (!cursor) return true;
  
  // Cursor should be base64 and decode to valid JSON
  try {
    // Basic length check (reasonable limit for cursor)
    if (cursor.length > 500) return false;
    
    // Only allow base64 characters
    if (!/^[A-Za-z0-9+/=]+$/.test(cursor)) return false;
    
    const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    
    // Validate expected structure
    if (typeof parsed !== 'object' || parsed === null) return false;
    if (parsed.id && typeof parsed.id !== 'string') return false;
    if (parsed.sortBy && typeof parsed.sortBy !== 'string') return false;
    
    return true;
  } catch {
    return false;
  }
}

function getParam(searchParams: URLSearchParams, canonicalKey: keyof typeof FILTER_PARAMS): string | null {
  const P = FILTER_PARAMS
  const canonicalName = P[canonicalKey]
  const canonicalValue = searchParams.get(canonicalName)
  if (canonicalValue !== null) return canonicalValue
  for (const [deprecated, canonical] of Object.entries(DEPRECATED_PARAMS)) {
    if (canonical === canonicalKey) {
      const deprecatedValue = searchParams.get(deprecated)
      if (deprecatedValue !== null) {
        console.warn(`[Search API] Deprecated param '${deprecated}' used. Use '${canonicalName}' instead.`)
        return deprecatedValue
      }
    }
  }
  return null
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const ip = getClientIp(request)
  const P = FILTER_PARAMS

  try {
    if (!await checkRateLimit(`search:${ip}`, 30, 60000)) {
      throw new ApiError("Too many requests", 429, ErrorCodes.RATE_LIMITED)
    }

    const searchParams = request.nextUrl.searchParams
      const rawFilters: any = {
        q: getParam(searchParams, 'query'),
        type: getParam(searchParams, 'types')?.split(',').filter(Boolean) || [],
        genres: searchParams.get(P.genres)?.split(',').filter(Boolean) || [],
        tags: getParam(searchParams, 'themes')?.split(',').filter(Boolean) || [],
        themes: getParam(searchParams, 'themes')?.split(',').filter(Boolean) || [],
      contentWarnings: {
        include: getParam(searchParams, 'includeWarnings')?.split(',').filter(Boolean) || [],
        exclude: getParam(searchParams, 'excludeWarnings')?.split(',').filter(Boolean) || [],
      },
      publicationStatus: getParam(searchParams, 'status')?.split(',').filter(Boolean) || [],
      contentRating: getParam(searchParams, 'rating')?.split(',').filter(Boolean) || [],
      readableOn: getParam(searchParams, 'source')?.split(',').filter(Boolean) || [],
      languages: {
        original: getParam(searchParams, 'origLang') || undefined,
        translated: getParam(searchParams, 'transLang')?.split(',').filter(Boolean) || [],
      },
      chapterCount: {
        min: getParam(searchParams, 'chapters') ? parseInt(getParam(searchParams, 'chapters')!) : undefined,
        max: undefined,
      },
      releasePeriod: {
        from: getParam(searchParams, 'dateFrom') || undefined,
        to: getParam(searchParams, 'dateTo') || undefined,
      },
        sortBy: getParam(searchParams, 'sort') || (getParam(searchParams, 'query') ? 'score' : 'newest'),
      sortOrder: 'desc',
      cursor: getParam(searchParams, 'cursor'),
      limit: parseInt(searchParams.get(P.limit) || '24'),
      mode: searchParams.get(P.mode) || 'all',
    }

      const validated = FilterSchema.safeParse(rawFilters)
      if (!validated.success) throw new ApiError("Invalid filters", 400, ErrorCodes.VALIDATION_ERROR)

      const filters = validated.data
      
      // Validate cursor format before using it
      if (filters.cursor && !validateCursor(filters.cursor)) {
        throw new ApiError("Invalid cursor format", 400, ErrorCodes.VALIDATION_ERROR)
      }
      
      // Bug 59: Validate query length
      if (filters.q && filters.q.length > SEARCH_LIMITS.MAX_QUERY_LENGTH) {
        throw new ApiError(`Query too long (max ${SEARCH_LIMITS.MAX_QUERY_LENGTH} characters)`, 400, ErrorCodes.VALIDATION_ERROR)
      }
      
      const queryStr = filters.q ? sanitizeInput(filters.q, SEARCH_LIMITS.MAX_QUERY_LENGTH) : null
    const normalizedKey = queryStr ? normalizeSearchQuery(queryStr) : null
    const escapedQuery = normalizedKey ? escapeILikePattern(normalizedKey) : null
    
    // Bug 59: Cap requested limit to MAX_RESULTS_RETURNED
    const requestedLimit = Math.min(Math.max(1, filters.limit), SEARCH_LIMITS.MAX_RESULTS_RETURNED)
    
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    const dbUser = user ? await prisma.user.findUnique({
      where: { id: user.id },
      select: { subscription_tier: true, safe_browsing_mode: true }
    }) : null
    const isPremium = dbUser?.subscription_tier === 'premium'
    const safeBrowsingMode = dbUser?.safe_browsing_mode || 'sfw'

    if (normalizedKey) await recordSearchIntent(normalizedKey, user?.id)

    const rawSource = getParam(searchParams, 'source')
    const source = rawSource && VALID_SOURCES.has(rawSource.toLowerCase()) ? rawSource.toLowerCase() : null
    const requestId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const cacheFilters = { ...filters, source }

    // Use optimized SQL for text search without cursor/source filter
    const useOptimizedSql = normalizedKey && !filters.cursor && !source && filters.mode === 'all'

    if (useOptimizedSql) {
      const cached = await getCachedSearchResult(normalizedKey!, cacheFilters)
      if (cached) {
        const uniqueResults = Array.from(new Map(cached.results.map((s: any) => [s.id, s])).values())
        recordSearchEvent({ normalized_query: normalizedKey!.toLowerCase().trim(), intent_type: 'TEXT', local_hit: true, external_attempted: false, results_count: uniqueResults.length, resolution_time_ms: Date.now() - startTime, status: 'cache_hit' })
        return NextResponse.json({ status: 'complete', results: uniqueResults, ...(cached.total !== undefined && { total: cached.total }), has_more: cached.has_more, next_cursor: cached.next_cursor, filters_applied: cacheFilters, cache_hit: true, cached_at: cached.cached_at, ...getDiscoveryInfo('complete', uniqueResults, undefined, !user) })
      }

      const pendingRequestId = await checkPendingSearch(normalizedKey!, cacheFilters)
      if (pendingRequestId) {
        const pendingResult = await waitForPendingSearch(normalizedKey!, cacheFilters, { maxPendingWaitMs: 3000 })
        if (pendingResult) {
          return NextResponse.json({ status: 'complete', results: pendingResult.results, ...(pendingResult.total !== undefined && { total: pendingResult.total }), has_more: pendingResult.has_more, next_cursor: pendingResult.next_cursor, filters_applied: cacheFilters, cache_hit: true, dedup_wait: true, ...getDiscoveryInfo('complete', pendingResult.results, undefined, !user) })
        }
      }
      await markSearchPending(normalizedKey!, cacheFilters, requestId)
    }

    let results: any[] = []
    let count: number | null = null
    let hasMore = false

    if (useOptimizedSql) {
      // Bug 59: Cap the database query to MAX_RESULTS_BEFORE_PROCESSING
      const dbLimit = Math.min(requestedLimit + 1, SEARCH_LIMITS.MAX_RESULTS_BEFORE_PROCESSING)
      results = await prisma.$queryRawUnsafe<any[]>(
        PRODUCTION_QUERIES.SERIES_DISCOVERY,
        escapedQuery,
        filters.genres.length > 0 ? filters.genres : null,
        safeBrowsingMode,
        dbLimit
      )
      
      // Bug 59: Cap results before processing
      results = capSearchResults(results, SEARCH_LIMITS.MAX_RESULTS_BEFORE_PROCESSING)
      
      hasMore = results.length > requestedLimit
      if (hasMore) results = results.slice(0, requestedLimit)
    } else {
      let multipleSourceIds: Set<string> | null = null
      if (source === 'multiple') {
        multipleSourceIds = await getSeriesIdsWithMultipleSources(supabaseAdminRead)
        if (multipleSourceIds.size === 0) {
          if (normalizedKey && !filters.cursor) await clearPendingSearch(normalizedKey, cacheFilters)
          return NextResponse.json({ status: 'complete', results: [], total: 0, has_more: false, next_cursor: null, filters_applied: cacheFilters, ...getDiscoveryInfo('complete', [], undefined, !user) })
        }
      }
      const supabaseQuery = buildSeriesQuery(supabaseAdminRead, filters, source, multipleSourceIds)
      const { data, count: c, error } = await supabaseQuery
      if (error) {
        if (normalizedKey && !filters.cursor) await clearPendingSearch(normalizedKey, cacheFilters)
        throw error
      }
      results = data || []
      
      // Bug 59: Cap results before processing
      results = capSearchResults(results, SEARCH_LIMITS.MAX_RESULTS_BEFORE_PROCESSING)
      
      count = c
      if (source && source !== 'all' && source !== 'multiple') results = stripSourcesFromResults(results)
      hasMore = results.length > requestedLimit
      if (hasMore) results = results.slice(0, requestedLimit)
    }

    const seriesIds = results.map((r: any) => String(r.id)).filter(id => id && id !== 'undefined')
    
    // Track search_hit for top results and promote Tier C results
    await Promise.allSettled([
      ...seriesIds.slice(0, 5).map(id => promoteSeriesTier(id, 'user_search')),
      ...results.filter((r: any) => r.catalog_tier === 'C').map((r: any) => promoteSeriesTier(r.id, 'user_search'))
    ])

    const bestCovers = await getBestCoversBatch(seriesIds)

    const formattedResults = results.map((r: any) => ({
      ...r,
      best_cover_url: bestCovers.get(String(r.id)) || r.cover_url || r.best_cover_url
    }))

      // Bug 60: Apply deterministic sorting to ensure consistent result ordering
      // Parse relevance_score as number (may come as string from SQL)
      const sortedResults = sortSearchResultsDeterministic(
        formattedResults.map((r: any) => ({ ...r, score: parseFloat(r.relevance_score) || 0 })),
        filters.sortBy === 'score' ? 'score' : filters.sortBy === 'newest' ? 'newest' : 'score'
      )

    let nextCursor = null
    if (hasMore && sortedResults.length > 0) {
      nextCursor = createSearchCursor(sortedResults[sortedResults.length - 1], filters.sortBy)
    }

    if (normalizedKey && !filters.cursor) {
      await clearPendingSearch(normalizedKey, cacheFilters)
    }

    let status = 'complete'
    let skipReason: string | undefined = undefined

    if (normalizedKey && !filters.cursor && sortedResults.length < 5) {
      try {
        const intent = detectSearchIntent(normalizedKey, results)
        const hasGoodMatch = sortedResults.some((r: any) => {
          const title = (r.title || '').toLowerCase()
          const q = normalizedKey.toLowerCase()
          return (title.includes(q) || q.includes(title)) && r.cover_url && r.description
        })

            if (intent !== 'NOISE' || !hasGoodMatch) {
              // Quick check: if Redis status is 'wait' or 'end', skip waiting entirely
              const redisStatus = redis?.status || 'end'
              console.log(`[Search] External discovery check - redisStatus: ${redisStatus}, query: "${queryStr}"`)
              const redisReady = (redisStatus === 'ready') || 
                (redisStatus !== 'end' && redisStatus !== 'close' && await waitForRedis(redis, 500))
              
              // Check if workers are actually processing jobs (via heartbeat)
              const workersOnline = redisReady && await areWorkersOnline()
              console.log(`[Search] redisReady: ${redisReady}, workersOnline: ${workersOnline}`)
              
              if (redisReady && workersOnline) {
                const decision = await shouldEnqueueExternalSearch(normalizedKey, checkSourceQueue)
                  
                  if (decision.shouldEnqueue) {
                    const jobId = normalizedKey
                    await checkSourceQueue.add('check-source', { 
                      query: queryStr,
                      normalizedKey,
                      intent, 
                      trigger: 'user_search', 
                      userId: user?.id, 
                      isPremium 
                    }, { 
                      jobId, 
                      priority: isPremium ? SEARCH_PRIORITY.CRITICAL : SEARCH_PRIORITY.STANDARD, 
                      removeOnComplete: true 
                    })
                    await markQueryEnqueued(normalizedKey)
                    status = 'resolving'
                      } else {
                        if (decision.reason === 'queue_unhealthy') {
                          console.warn(`[Search] Discovery fetch skipped due to queue overload: "${queryStr || normalizedKey}"`);
                          skipReason = 'queue_overload';
                          await markQueryDeferred(normalizedKey)
                          await deferSearchQuery(queryStr || normalizedKey, 'queue_unhealthy', isPremium, !!user)
                        }

                    const existingJob = await checkSourceQueue.getJob(normalizedKey)
                    if (existingJob) {
                      status = 'resolving'
                    }
                  }

              } else {
                // SYNCHRONOUS MANGADEX FALLBACK: Workers offline, do direct search
                console.log(`[Search] Workers offline, performing synchronous MangaDex search for: "${queryStr}"`)
                try {
                  const mangadexResults = await searchMangaDex(queryStr || normalizedKey)
                  console.log(`[Search] MangaDex returned ${mangadexResults.length} results`)
                  if (mangadexResults.length > 0) {
                    const externalResults = mangadexResults.slice(0, 10).map((m: MangaDexCandidate) => ({
                      id: `mangadex:${m.mangadex_id}`,
                      mangadex_id: m.mangadex_id,
                      title: m.title,
                      alternative_titles: m.alternative_titles,
                      description: m.description?.slice(0, 500) || '',
                      status: m.status,
                      type: m.type,
                      genres: m.genres,
                      content_rating: m.content_rating,
                      cover_url: m.cover_url,
                      best_cover_url: m.cover_url,
                      source: 'mangadex',
                      external_only: true,
                      year: m.year,
                    }))
                    
                    // Merge external results with local, avoiding duplicates by mangadex_id
                    const existingMangadexIds = new Set(sortedResults.map((r: any) => r.mangadex_id).filter(Boolean))
                    const newExternalResults = externalResults.filter((r: any) => !existingMangadexIds.has(r.mangadex_id))
                    sortedResults.push(...newExternalResults)
                    
                    console.log(`[Search] Added ${newExternalResults.length} external results from MangaDex`)
                  }
                } catch (mdError: any) {
                  console.warn(`[Search] Synchronous MangaDex search failed: ${mdError.message}`, mdError.stack)
                }
                skipReason = 'workers_offline'
              }
            }

      } catch (e: any) { console.error("[Search] Discovery trigger error:", e.message) }
    }

    if (normalizedKey && !filters.cursor && (status === 'complete' || status === 'limit_reached')) {
      await setCachedSearchResult(normalizedKey, cacheFilters, { results: sortedResults, total: count ?? sortedResults.length, has_more: hasMore, next_cursor: nextCursor }, { ttlSeconds: sortedResults.length >= 5 ? 3600 : 300 })
    }

      recordSearchEvent({ normalized_query: normalizedKey || 'none', intent_type: normalizedKey ? 'TEXT' : 'FILTER', local_hit: sortedResults.length > 0, external_attempted: status === 'resolving', results_count: sortedResults.length, resolution_time_ms: Date.now() - startTime, status })
      const uniqueResults = Array.from(new Map(sortedResults.map((s: any) => [s.id, s])).values())
      
      // Determine appropriate cache duration based on result quality
      const cacheMaxAge = uniqueResults.length >= 5 ? 300 : 60; // 5 min for good results, 1 min for sparse
      const cacheHeaders = {
        'Cache-Control': `public, max-age=${cacheMaxAge}, stale-while-revalidate=${cacheMaxAge * 2}`,
        'Vary': 'Accept-Encoding'
      };
      
      return NextResponse.json({ status, results: uniqueResults, ...(count !== null && !filters.cursor && { total: count }), has_more: hasMore, next_cursor: nextCursor, filters_applied: cacheFilters, ...getDiscoveryInfo(status, uniqueResults, skipReason, !user) }, { headers: cacheHeaders })
  } catch (error: any) { return handleApiError(error) }
}
