/**
 * Cursor-based Pagination Utilities
 * 
 * CURSOR SCHEMA:
 * {
 *   s: string       // Sort column identifier (e.g., "created_at", "total_follows")
 *   d: "asc" | "desc" // Sort direction
 *   v: string | number | null // Sort column value at cursor position
 *   i: string       // Unique tiebreaker (series.id) - ensures deterministic ordering
 * }
 * 
 * SUPPORTED SORT MODES:
 * - newest: created_at DESC, id DESC
 * - oldest: created_at ASC, id ASC
 * - updated: updated_at DESC, id DESC
 * - popularity/follows: total_follows DESC, id DESC
 * - popularity_asc: total_follows ASC, id ASC
 * - score/rating: average_rating DESC NULLS LAST, id DESC
 * - score_asc: average_rating ASC NULLS FIRST, id ASC
 * - chapters: chapter_count DESC NULLS LAST, id DESC
 * - chapters_asc: chapter_count ASC NULLS FIRST, id ASC
 * - views: total_views DESC, id DESC
 */

export interface CursorData {
  s: string        // Sort column
  d: 'asc' | 'desc' // Direction
  v: string | number | null  // Sort value at cursor position
  i: string        // ID tiebreaker
}

export interface PaginationConfig {
  sortColumn: string
  ascending: boolean
  nullsFirst: boolean
}

// Map sort param to actual column name and config
export const SORT_CONFIG: Record<string, PaginationConfig> = {
  newest: { sortColumn: 'created_at', ascending: false, nullsFirst: false },
  oldest: { sortColumn: 'created_at', ascending: true, nullsFirst: false },
  updated: { sortColumn: 'last_chapter_date', ascending: false, nullsFirst: false },
  latest_chapter: { sortColumn: 'last_chapter_date', ascending: false, nullsFirst: false },
  score: { sortColumn: 'average_rating', ascending: false, nullsFirst: false },
  rating: { sortColumn: 'average_rating', ascending: false, nullsFirst: false },
  score_asc: { sortColumn: 'average_rating', ascending: true, nullsFirst: true },
  popularity: { sortColumn: 'total_follows', ascending: false, nullsFirst: false },
  popular: { sortColumn: 'total_follows', ascending: false, nullsFirst: false },
  follows: { sortColumn: 'total_follows', ascending: false, nullsFirst: false },
  popularity_asc: { sortColumn: 'total_follows', ascending: true, nullsFirst: false },
  views: { sortColumn: 'total_views', ascending: false, nullsFirst: false },
  chapters: { sortColumn: 'chapter_count', ascending: false, nullsFirst: false },
  chapters_asc: { sortColumn: 'chapter_count', ascending: true, nullsFirst: true },
}

/**
 * Encode cursor data to opaque base64 string
 */
export function encodeCursor(data: CursorData): string {
  const json = JSON.stringify(data)
  // Use base64url encoding (URL-safe)
  return Buffer.from(json).toString('base64url')
}

/**
 * Decode cursor string to cursor data
 * Returns null if invalid/tampered
 */
export function decodeCursor(cursor: string): CursorData | null {
  try {
    const json = Buffer.from(cursor, 'base64url').toString('utf-8')
    const data = JSON.parse(json)
    
    // Validate structure
    if (
      typeof data !== 'object' ||
      typeof data.s !== 'string' ||
      (data.d !== 'asc' && data.d !== 'desc') ||
      typeof data.i !== 'string' ||
      !data.i.match(/^[0-9a-f-]{36}$/i) // UUID validation
    ) {
      return null
    }
    
    // Validate sort column is known
    const validColumns = new Set(Object.values(SORT_CONFIG).map(c => c.sortColumn))
    if (!validColumns.has(data.s)) {
      return null
    }
    
    return data as CursorData
  } catch {
    return null
  }
}

/**
 * Create cursor from last item in results
 */
export function createCursor(
  item: Record<string, any>,
  sortConfig: PaginationConfig
): string {
  const cursorData: CursorData = {
    s: sortConfig.sortColumn,
    d: sortConfig.ascending ? 'asc' : 'desc',
    v: item[sortConfig.sortColumn] ?? null,
    i: item.id
  }
  return encodeCursor(cursorData)
}

/**
 * Build WHERE clause for cursor pagination
 * Uses (column, id) tuple comparison for deterministic ordering
 * 
 * For DESC ordering: WHERE (column, id) < (cursor_value, cursor_id)
 * For ASC ordering: WHERE (column, id) > (cursor_value, cursor_id)
 * 
 * Handles NULL values appropriately based on NULLS FIRST/LAST
 */
export function buildCursorCondition(
  cursor: CursorData,
  config: PaginationConfig
): { sql: string; params: any[] } {
  const { sortColumn } = config
  const { v: cursorValue, i: cursorId } = cursor
  
  // Direction determines comparison operator
  const isDescending = cursor.d === 'desc'
  
  if (cursorValue === null) {
    // Cursor is at a NULL value
    // For both DESC and ASC: since we sort ID ascending, we want items with NULL that have larger ID
    return {
      sql: `(${sortColumn} IS NULL AND id > $1)`,
      params: [cursorId]
    }
  }
  
  // Non-NULL cursor value
  if (isDescending) {
    // DESC: Get items where (column < cursorValue) OR (column = cursorValue AND id > cursorId)
    // Also include NULLs (they come after in NULLS LAST)
    return {
      sql: `(
        ${sortColumn} < $1 
        OR (${sortColumn} = $1 AND id > $2)
        OR ${sortColumn} IS NULL
      )`,
      params: [cursorValue, cursorId]
    }
  } else {
    // ASC: Get items where (column > cursorValue) OR (column = cursorValue AND id > cursorId)
    // NULLs already passed (NULLS FIRST) or won't appear (NULLS LAST)
    return {
      sql: `(
        ${sortColumn} > $1 
        OR (${sortColumn} = $1 AND id > $2)
      )`,
      params: [cursorValue, cursorId]
    }
  }
}

/**
 * Build Supabase-compatible cursor filter
 * Returns filter functions to apply to query
 */
export function buildSupabaseCursorFilter(
  cursor: CursorData,
  config: PaginationConfig
): {
  applyFilter: (query: any) => any
} {
  const { sortColumn } = config
  const { v: cursorValue, i: cursorId, d: direction } = cursor
  const isDescending = direction === 'desc'
  
  return {
    applyFilter: (query: any) => {
      if (cursorValue === null) {
        // Already in NULL section, only get items with NULL and larger ID (since we sort id ASC)
        return query.and(`${sortColumn}.is.null,id.gt.${cursorId}`)
      }
      
      // Non-NULL cursor value - use composite comparison
      const escapedValue = typeof cursorValue === 'string' 
        ? cursorValue.replace(/,/g, '\\,').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
        : cursorValue

      if (isDescending) {
        // DESC: (col < val) OR (col = val AND id > cursorId) OR (col IS NULL)
        return query.or(
          `${sortColumn}.lt.${escapedValue},` +
          `and(${sortColumn}.eq.${escapedValue},id.gt.${cursorId}),` +
          `${sortColumn}.is.null`
        )
      } else {
        // ASC: (col > val) OR (col = val AND id > cursorId)
        return query.or(
          `${sortColumn}.gt.${escapedValue},` +
          `and(${sortColumn}.eq.${escapedValue},id.gt.${cursorId})`
        )
      }
    }
  }
}

/**
 * Get sort configuration for a sort parameter
 */
export function getSortConfig(sort: string): PaginationConfig {
  return SORT_CONFIG[sort] || SORT_CONFIG.newest
}

/**
 * Validate that cursor sort matches requested sort
 * Prevents cursor reuse across different sort modes
 */
export function validateCursorSort(cursor: CursorData, requestedSort: string): boolean {
  const config = getSortConfig(requestedSort)
  const expectedDirection = config.ascending ? 'asc' : 'desc'
  
  return cursor.s === config.sortColumn && cursor.d === expectedDirection
}
