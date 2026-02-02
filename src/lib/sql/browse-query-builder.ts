import { escapeILikePattern } from '@/lib/api-utils'
import { SORT_CONFIG, type CursorData, type PaginationConfig } from '@/lib/cursor-pagination'

export interface BrowseFilters {
  q: string | null
  types: string[]
  genres: string[]
  themes: string[]
  includeWarnings: string[]
  excludeWarnings: string[]
  status: string | null
  contentRating: string | null
  source: string | null
  period: string | null
  dateFrom: Date | null
  dateTo: Date | null
  chapters: number | null
  originalLanguage: string | null
  translatedLanguage: string | null
}

export interface BrowseQueryResult {
  sql: string
  params: any[]
  countSql: string
  countParams: any[]
}

const STATUS_MAP: Record<string, string[]> = {
  releasing: ['ongoing', 'releasing'],
  finished: ['completed', 'finished'],
  ongoing: ['ongoing', 'releasing'],
  completed: ['completed', 'finished'],
  hiatus: ['hiatus', 'on hiatus'],
  cancelled: ['cancelled', 'discontinued'],
}

function escapePostgresString(value: string): string {
  return value.replace(/'/g, "''")
}

function escapeArrayValues(values: string[]): string {
  return values.map(v => `'${escapePostgresString(v)}'`).join(',')
}

export function buildBrowseQuery(
  filters: BrowseFilters,
  sortConfig: PaginationConfig,
  limit: number,
  cursor: CursorData | null
): BrowseQueryResult {
  const { 
    q, types, genres, themes, includeWarnings, excludeWarnings, 
    status, contentRating, source, period, dateFrom, dateTo, chapters,
    originalLanguage, translatedLanguage
  } = filters
  const { sortColumn, ascending, nullsFirst } = sortConfig

  const conditions: string[] = ['s.deleted_at IS NULL']
  const params: any[] = []
  let paramIndex = 1

  let fromClause = 'FROM series s'
  const selectFields = `
    s.id,
    s.title,
    s.alternative_titles,
    s.description,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.tags,
    s.content_rating,
    s.total_follows,
    s.total_views,
    s.average_rating,
    s.created_at,
    s.updated_at,
    s.themes,
    s.chapter_count
  `

  if (source && source !== 'all' && source !== 'multiple') {
    fromClause = 'FROM series s INNER JOIN series_sources ss ON ss.series_id = s.id'
    conditions.push(`ss.source_name = $${paramIndex}`)
    params.push(source)
    paramIndex++
  }

  if (q && q.length >= 2) {
    const escapedQuery = escapeILikePattern(q)
    conditions.push(`(s.title ILIKE $${paramIndex} OR s.description ILIKE $${paramIndex})`)
    params.push(`%${escapedQuery}%`)
    paramIndex++
  }

  if (types.length > 0) {
    conditions.push(`s.type = ANY($${paramIndex}::varchar[])`)
    params.push(types)
    paramIndex++
  }

  if (genres.length > 0) {
    conditions.push(`s.genres @> $${paramIndex}::varchar[]`)
    params.push(genres)
    paramIndex++
  }

  if (themes.length > 0) {
    conditions.push(`(s.tags @> $${paramIndex}::varchar[] OR s.themes @> $${paramIndex}::varchar[])`)
    params.push(themes)
    paramIndex++
  }

  if (includeWarnings.length > 0) {
    conditions.push(`s.tags @> $${paramIndex}::varchar[]`)
    params.push(includeWarnings)
    paramIndex++
  }

  if (excludeWarnings.length > 0) {
    conditions.push(`NOT (s.tags && $${paramIndex}::varchar[])`)
    params.push(excludeWarnings)
    paramIndex++
  }

  if (status && status !== 'all') {
    const statusValues = STATUS_MAP[status] || [status]
    conditions.push(`s.status = ANY($${paramIndex}::varchar[])`)
    params.push(statusValues)
    paramIndex++
  }

  if (contentRating && contentRating !== 'all') {
    conditions.push(`s.content_rating = $${paramIndex}`)
    params.push(contentRating)
    paramIndex++
  }

  if (chapters !== null && chapters > 0) {
    conditions.push(`COALESCE(s.chapter_count, 0) >= $${paramIndex}`)
    params.push(chapters)
    paramIndex++
  }

  if (period && period !== 'all' && dateFrom && dateTo) {
    conditions.push(`s.last_chapter_date >= $${paramIndex} AND s.last_chapter_date <= $${paramIndex + 1}`)
    params.push(dateFrom.toISOString())
    params.push(dateTo.toISOString())
    paramIndex += 2
  }

  if (source === 'multiple') {
    conditions.push(`EXISTS (
      SELECT 1 FROM series_sources ss
      WHERE ss.series_id = s.id
      GROUP BY ss.series_id
      HAVING COUNT(DISTINCT ss.source_name) >= 2
    )`)
  }

  if (originalLanguage && originalLanguage !== 'all') {
    conditions.push(`s.original_language = $${paramIndex}`)
    params.push(originalLanguage)
    paramIndex++
  }

  if (translatedLanguage && translatedLanguage !== 'all') {
    conditions.push(`$${paramIndex} = ANY(s.translated_languages)`)
    params.push(translatedLanguage)
    paramIndex++
  }

  if (cursor) {
    const cursorCondition = buildCursorConditionSQL(cursor, sortConfig, paramIndex)
    if (cursorCondition.sql) {
      conditions.push(cursorCondition.sql)
      params.push(...cursorCondition.params)
      paramIndex += cursorCondition.params.length
    }
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const direction = ascending ? 'ASC' : 'DESC'
  const idDirection = ascending ? 'ASC' : 'DESC'
  let nullsClause = ''
  if (sortColumn === 'average_rating') {
    nullsClause = ascending ? ' NULLS FIRST' : ' NULLS LAST'
  }

  const orderClause = `ORDER BY s.${sortColumn} ${direction}${nullsClause}, s.id ${idDirection}`

  const sql = `
SELECT ${selectFields}
${fromClause}
${whereClause}
${orderClause}
LIMIT ${limit + 1}
  `.trim()

  const countFromClause = fromClause
  let countSelect = 'COUNT(*)'
  if (source && source !== 'all' && source !== 'multiple') {
    countSelect = 'COUNT(DISTINCT s.id)'
  }

  const countConditions = conditions.filter((_, i) => {
    return !conditions[i]?.includes('s.created_at') && 
           !conditions[i]?.includes('s.updated_at') &&
           !conditions[i]?.includes('s.total_follows') &&
           !conditions[i]?.includes('s.average_rating') &&
           !conditions[i]?.includes('s.title <') &&
           !conditions[i]?.includes('s.title >') &&
           !conditions[i]?.includes('s.id <') &&
           !conditions[i]?.includes('s.id >')
  })

  const countWhereClause = countConditions.length > 0 ? `WHERE ${countConditions.join(' AND ')}` : whereClause.replace(/AND \([\s\S]*?(s\.\w+ [<>]|s\.id [<>])[\s\S]*?\)/g, '')

  const countSql = `
SELECT ${countSelect} AS total
${countFromClause}
${countWhereClause}
  `.trim()

  const countParams = params.slice(0, paramIndex - (cursor ? cursor.v !== null ? 2 : 1 : 0))

  return {
    sql,
    params,
    countSql,
    countParams: countParams.length > 0 ? countParams : params.slice(0, conditions.length - (cursor ? 1 : 0))
  }
}

export function buildMultipleSourcesQuery(
  filters: Omit<BrowseFilters, 'source'>,
  sortConfig: PaginationConfig,
  limit: number,
  cursor: CursorData | null
): BrowseQueryResult {
  const { 
    q, types, genres, themes, includeWarnings, excludeWarnings, 
    status, contentRating, period, dateFrom, dateTo, chapters,
    originalLanguage, translatedLanguage
  } = filters
  const { sortColumn, ascending } = sortConfig

  const conditions: string[] = ['s.deleted_at IS NULL']
  const params: any[] = []
  let paramIndex = 1

  const selectFields = `
    s.id,
    s.title,
    s.alternative_titles,
    s.description,
    s.cover_url,
    s.type,
    s.status,
    s.genres,
    s.tags,
    s.content_rating,
    s.total_follows,
    s.total_views,
    s.average_rating,
    s.created_at,
    s.updated_at,
    s.themes,
    s.chapter_count
  `

  conditions.push(`EXISTS (
    SELECT 1 FROM series_sources ss
    WHERE ss.series_id = s.id
    GROUP BY ss.series_id
    HAVING COUNT(DISTINCT ss.source_name) >= 2
  )`)

  if (q && q.length >= 2) {
    const escapedQuery = escapeILikePattern(q)
    conditions.push(`(s.title ILIKE $${paramIndex} OR s.description ILIKE $${paramIndex})`)
    params.push(`%${escapedQuery}%`)
    paramIndex++
  }

  if (types.length > 0) {
    conditions.push(`s.type = ANY($${paramIndex}::varchar[])`)
    params.push(types)
    paramIndex++
  }

  if (genres.length > 0) {
    conditions.push(`s.genres @> $${paramIndex}::varchar[]`)
    params.push(genres)
    paramIndex++
  }

  if (themes.length > 0) {
    conditions.push(`(s.tags @> $${paramIndex}::varchar[] OR s.themes @> $${paramIndex}::varchar[])`)
    params.push(themes)
    paramIndex++
  }

  if (includeWarnings.length > 0) {
    conditions.push(`s.tags @> $${paramIndex}::varchar[]`)
    params.push(includeWarnings)
    paramIndex++
  }

  if (excludeWarnings.length > 0) {
    conditions.push(`NOT (s.tags && $${paramIndex}::varchar[])`)
    params.push(excludeWarnings)
    paramIndex++
  }

  if (status && status !== 'all') {
    const statusValues = STATUS_MAP[status] || [status]
    conditions.push(`s.status = ANY($${paramIndex}::varchar[])`)
    params.push(statusValues)
    paramIndex++
  }

  if (contentRating && contentRating !== 'all') {
    conditions.push(`s.content_rating = $${paramIndex}`)
    params.push(contentRating)
    paramIndex++
  }

  if (chapters !== null && chapters > 0) {
    conditions.push(`COALESCE(s.chapter_count, 0) >= $${paramIndex}`)
    params.push(chapters)
    paramIndex++
  }

  if (period && period !== 'all' && dateFrom && dateTo) {
    conditions.push(`s.last_chapter_date >= $${paramIndex} AND s.last_chapter_date <= $${paramIndex + 1}`)
    params.push(dateFrom.toISOString())
    params.push(dateTo.toISOString())
    paramIndex += 2
  }

  if (originalLanguage && originalLanguage !== 'all') {
    conditions.push(`s.original_language = $${paramIndex}`)
    params.push(originalLanguage)
    paramIndex++
  }

  if (translatedLanguage && translatedLanguage !== 'all') {
    conditions.push(`$${paramIndex} = ANY(s.translated_languages)`)
    params.push(translatedLanguage)
    paramIndex++
  }

  if (cursor) {
    const cursorCondition = buildCursorConditionSQL(cursor, sortConfig, paramIndex)
    if (cursorCondition.sql) {
      conditions.push(cursorCondition.sql)
      params.push(...cursorCondition.params)
      paramIndex += cursorCondition.params.length
    }
  }

  const whereClause = `WHERE ${conditions.join(' AND ')}`

  const direction = ascending ? 'ASC' : 'DESC'
  const idDirection = ascending ? 'ASC' : 'DESC'
  let nullsClause = ''
  if (sortColumn === 'average_rating') {
    nullsClause = ascending ? ' NULLS FIRST' : ' NULLS LAST'
  }

  const orderClause = `ORDER BY s.${sortColumn} ${direction}${nullsClause}, s.id ${idDirection}`

  const sql = `
SELECT ${selectFields}
FROM series s
${whereClause}
${orderClause}
LIMIT ${limit + 1}
  `.trim()

  const countConditions = conditions.filter((_, i) => {
    const cond = conditions[i]
    return !cond?.includes('s.created_at <') && 
           !cond?.includes('s.created_at >') &&
           !cond?.includes('s.updated_at <') &&
           !cond?.includes('s.updated_at >') &&
           !cond?.includes('s.total_follows <') &&
           !cond?.includes('s.total_follows >') &&
           !cond?.includes('s.average_rating <') &&
           !cond?.includes('s.average_rating >') &&
           !cond?.includes('s.title <') &&
           !cond?.includes('s.title >') &&
           !cond?.includes('(s.id <') &&
           !cond?.includes('(s.id >')
  })

  const countWhereClause = `WHERE ${countConditions.join(' AND ')}`
  const countParams = params.slice(0, paramIndex - (cursor ? cursor.v !== null ? 2 : 1 : 0))

  const countSql = `
SELECT COUNT(*) AS total
FROM series s
${countWhereClause}
  `.trim()

  return {
    sql,
    params,
    countSql,
    countParams: countParams.length > 0 ? countParams : []
  }
}

function buildCursorConditionSQL(
  cursor: CursorData,
  config: PaginationConfig,
  startParamIndex: number
): { sql: string; params: any[] } {
  const { sortColumn } = config
  const { v: cursorValue, i: cursorId, d: direction } = cursor
  const isDescending = direction === 'desc'

  if (cursorValue === null) {
    if (isDescending) {
      return {
        sql: `(s.${sortColumn} IS NOT NULL OR (s.${sortColumn} IS NULL AND s.id < $${startParamIndex}))`,
        params: [cursorId]
      }
    } else {
      return {
        sql: `(s.${sortColumn} IS NOT NULL OR (s.${sortColumn} IS NULL AND s.id > $${startParamIndex}))`,
        params: [cursorId]
      }
    }
  }

  if (isDescending) {
    return {
      sql: `(
        s.${sortColumn} < $${startParamIndex}
        OR (s.${sortColumn} = $${startParamIndex} AND s.id < $${startParamIndex + 1})
        OR s.${sortColumn} IS NULL
      )`,
      params: [cursorValue, cursorId]
    }
  } else {
    return {
      sql: `(
        s.${sortColumn} > $${startParamIndex}
        OR (s.${sortColumn} = $${startParamIndex} AND s.id > $${startParamIndex + 1})
      )`,
      params: [cursorValue, cursorId]
    }
  }
}

export function getSortConfigForBrowse(sort: string): PaginationConfig {
  return SORT_CONFIG[sort] || SORT_CONFIG.newest
}
