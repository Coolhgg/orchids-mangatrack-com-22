import { redis } from './redis'

const METRICS_PREFIX = 'metrics:'
const METRICS_WINDOW_MS = 60000

interface MetricData {
  count: number
  total_ms: number
  min_ms: number
  max_ms: number
  cache_hits: number
  cache_misses: number
}

export async function recordApiMetric(
  endpoint: string,
  durationMs: number,
  cacheHit: boolean = false
): Promise<void> {
  if (!redis) return

  try {
    const key = `${METRICS_PREFIX}api:${endpoint}`
    const windowKey = `${key}:${Math.floor(Date.now() / METRICS_WINDOW_MS)}`

    const multi = redis.multi()
    multi.hincrby(windowKey, 'count', 1)
    multi.hincrbyfloat(windowKey, 'total_ms', durationMs)
    multi.hincrby(windowKey, cacheHit ? 'cache_hits' : 'cache_misses', 1)
    multi.expire(windowKey, 300)
    await multi.exec()
  } catch (e) {
  }
}

export async function recordCacheMetric(
  operation: string,
  hit: boolean
): Promise<void> {
  if (!redis) return

  try {
    const key = `${METRICS_PREFIX}cache:${operation}`
    const windowKey = `${key}:${Math.floor(Date.now() / METRICS_WINDOW_MS)}`

    const multi = redis.multi()
    multi.hincrby(windowKey, hit ? 'hits' : 'misses', 1)
    multi.expire(windowKey, 300)
    await multi.exec()
  } catch (e) {
  }
}

export async function recordDbQueryMetric(
  queryType: string,
  durationMs: number,
  isReplica: boolean = false
): Promise<void> {
  if (!redis) return

  try {
    const key = `${METRICS_PREFIX}db:${queryType}:${isReplica ? 'replica' : 'primary'}`
    const windowKey = `${key}:${Math.floor(Date.now() / METRICS_WINDOW_MS)}`

    const multi = redis.multi()
    multi.hincrby(windowKey, 'count', 1)
    multi.hincrbyfloat(windowKey, 'total_ms', durationMs)
    multi.expire(windowKey, 300)
    await multi.exec()
  } catch (e) {
  }
}

export async function getMetricsSummary(): Promise<Record<string, any>> {
  if (!redis) return {}

  try {
    const currentWindow = Math.floor(Date.now() / METRICS_WINDOW_MS)
    const keys = await redis.keys(`${METRICS_PREFIX}*:${currentWindow}`)
    
    const summary: Record<string, any> = {}
    
    for (const key of keys) {
      const data = await redis.hgetall(key)
      const name = key.replace(`:${currentWindow}`, '').replace(METRICS_PREFIX, '')
      summary[name] = {
        count: parseInt(data.count || '0'),
        avg_ms: data.count && data.total_ms 
          ? (parseFloat(data.total_ms) / parseInt(data.count)).toFixed(2)
          : null,
        cache_hit_rate: data.cache_hits || data.cache_misses
          ? ((parseInt(data.cache_hits || '0') / 
             (parseInt(data.cache_hits || '0') + parseInt(data.cache_misses || '0'))) * 100).toFixed(1) + '%'
          : null
      }
    }
    
    return summary
  } catch (e) {
    return {}
  }
}

export function withMetrics<T>(
  endpoint: string,
  fn: () => Promise<T>,
  options?: { cacheHit?: boolean }
): Promise<T> {
  const start = Date.now()
  return fn().finally(() => {
    recordApiMetric(endpoint, Date.now() - start, options?.cacheHit)
  })
}
