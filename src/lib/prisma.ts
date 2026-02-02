import { PrismaClient, Prisma } from '@prisma/client'
import { logger } from './logger'

const SOFT_DELETE_MODELS = ['User', 'Series', 'Chapter', 'LibraryEntry']

// P1-5 FIX: Increased default timeout for complex operations
// 10s was too short for library operations with many entries
export const DEFAULT_TRANSACTION_TIMEOUT = 15000  // 15 seconds (was 10s)
export const LONG_TRANSACTION_TIMEOUT = 45000     // 45 seconds (was 30s)

type ExtendedPrismaClient = ReturnType<typeof prismaClientSingleton>

// TransactionClient type that works with both PrismaClient and $transaction callback
// The Omit removes methods not available in transaction context
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
> | Omit<any, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export interface TransactionOptions {
  maxWait?: number
  timeout?: number
  isolationLevel?: Prisma.TransactionIsolationLevel
}

export const DEFAULT_TX_OPTIONS: TransactionOptions = {
  maxWait: 5000,
  timeout: DEFAULT_TRANSACTION_TIMEOUT,
}

export const LONG_TX_OPTIONS: TransactionOptions = {
  maxWait: 10000,
  timeout: LONG_TRANSACTION_TIMEOUT,
}

export function createTxOptions(timeoutMs: number): TransactionOptions {
  return {
    maxWait: Math.min(timeoutMs / 2, 10000),
    timeout: timeoutMs,
  };
}

const globalForPrisma = global as unknown as { 
  prisma: ExtendedPrismaClient | undefined
  prismaRead: ExtendedPrismaClient | undefined
}

export const hasReadReplica = !!process.env.DATABASE_READ_URL

type ModelKey = Uncapitalize<Prisma.ModelName>

function toModelKey(modelName: string): ModelKey {
  return (modelName.charAt(0).toLowerCase() + modelName.slice(1)) as ModelKey
}

const prismaClientSingleton = (url?: string) => {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' 
      ? ['error', 'warn'] 
      : ['error'],
    datasources: url ? { db: { url } } : undefined
  })

  return client.$extends({
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (SOFT_DELETE_MODELS.includes(model)) {
            // P2-14 FIX: Handle count operations properly for soft delete
            if (
              operation === 'findUnique' || 
              operation === 'findUniqueOrThrow' ||
              operation === 'findFirst' || 
              operation === 'findFirstOrThrow' ||
              operation === 'findMany' ||
              operation === 'count' ||
              operation === 'aggregate' ||
              operation === 'groupBy'
            ) {
              // Ensure args.where exists
              if (!args.where) {
                args.where = {}
              }
              args.where = { ...args.where, deleted_at: null }
            }

              if (operation === 'delete') {
                const modelDelegate = client[toModelKey(model)] as { update: (args: unknown) => Promise<unknown> }
                return modelDelegate.update({
                  ...args,
                  data: { deleted_at: new Date() }
                })
              }

              if (operation === 'deleteMany') {
                const modelDelegate = client[toModelKey(model)] as { updateMany: (args: unknown) => Promise<unknown> }
                return modelDelegate.updateMany({
                  ...args,
                  data: { deleted_at: new Date() }
                })
              }

            if (operation === 'update' || operation === 'updateMany') {
              if (args.where) {
                args.where = { ...args.where, deleted_at: null }
              }
            }

            if (operation === 'upsert') {
              args.update = { ...args.update, deleted_at: null }
            }
          }
          return query(args)
        },
      },
    },
  })
}

// Primary write client (always uses DATABASE_URL)
export const prisma = globalForPrisma.prisma ?? prismaClientSingleton()

// Read replica client (falls back to primary if not configured)
export const prismaRead = globalForPrisma.prismaRead ?? (
  process.env.DATABASE_READ_URL 
    ? prismaClientSingleton(process.env.DATABASE_READ_URL) 
    : prisma
)

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaRead = prismaRead === prisma ? undefined : prismaRead
}

interface PrismaLikeError {
  message?: string
  code?: string
  name?: string
  constructor?: { name?: string }
}

export function isTransientError(error: unknown): boolean {
  if (!error) return false
  
  const prismaError = error as PrismaLikeError
  const errorMessage = (prismaError.message || '').toLowerCase()
  const errorCode = prismaError.code || ''
  const errorName = prismaError.constructor?.name || (prismaError.name !== 'Error' ? prismaError.name : '') || ''
  
  // SECURITY FIX: Check non-transient errors FIRST
  const nonTransientPatterns = [
    'password authentication failed',
    'authentication failed',
    'invalid password',
    'access denied',
    'permission denied',
    'role .* does not exist',
    'database .* does not exist',
    'invalid credentials',
  ]

  for (const pattern of nonTransientPatterns) {
    if (pattern.includes('.*')) {
      if (new RegExp(pattern, 'i').test(errorMessage)) return false
    } else if (errorMessage.includes(pattern)) {
      return false
    }
  }

  const nonTransientCodes = ['P1000', 'P1003']
  if (nonTransientCodes.includes(errorCode)) return false

  const transientPatterns = [
    'circuit breaker',
    "can't reach database",
    'connection refused',
    'connection reset',
    'connection timed out',
    'econnrefused',
    'econnreset',
    'etimedout',
    'unable to establish connection',
    'connection pool timeout',
    'too many connections',
    'tenant or user not found',
    'pool_timeout',
    'server closed the connection unexpectedly',
    'prepared statement',
    'ssl connection has been closed unexpectedly',
  ]
  
  const transientCodes = ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', '40001', '40P01', '57P01']
  
  const directName = prismaError.name || ''
  const isInitError = 
    errorName.includes('PrismaClientInitializationError') ||
    errorName.includes('PrismaClientKnownRequestError') ||
    directName.includes('PrismaClientInitializationError') ||
    directName.includes('PrismaClientKnownRequestError') ||
    (errorMessage.includes('prisma') && (errorMessage.includes('initialization') || errorMessage.includes('invocation')))
  
  const patternMatch = transientPatterns.some(pattern => errorMessage.includes(pattern))
  const codeMatch = transientCodes.includes(errorCode)
  
  return isInitError || patternMatch || codeMatch
}

/**
 * v5 Audit Bug 13: Check database health - FAIL FAST
 * Returns health status with latency measurement
 */
export interface DatabaseHealthResult {
  healthy: boolean;
  latencyMs: number;
  error?: string;
}

export async function checkDatabaseHealth(timeoutMs: number = 5000): Promise<DatabaseHealthResult> {
  const startTime = Date.now();
  
  try {
    // Create a promise that rejects after timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Database health check timed out')), timeoutMs);
    });
    
    // Simple SELECT 1 query to verify connection
    const queryPromise = prisma.$queryRaw`SELECT 1 as health_check`;
    
    await Promise.race([queryPromise, timeoutPromise]);
    
    const latencyMs = Date.now() - startTime;
    return { healthy: true, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    logger.error('[Database] Health check failed', { error: errorMessage, latencyMs });
    
    return {
      healthy: false,
      latencyMs,
      error: errorMessage,
    };
  }
}

/**
 * v5 Audit Bug 13: Wait for database to be ready
 * Retries with backoff until database is available or max attempts reached
 */
export async function waitForDatabase(
  maxAttempts: number = 5, 
  baseDelayMs: number = 1000
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const health = await checkDatabaseHealth(5000);
    
    if (health.healthy) {
      logger.info(`[Database] Connected successfully (latency: ${health.latencyMs}ms)`);
      return true;
    }
    
    if (attempt < maxAttempts) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      logger.warn(`[Database] Connection attempt ${attempt}/${maxAttempts} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  logger.error(`[Database] Failed to connect after ${maxAttempts} attempts`);
  return false;
}

/**
 * Wrapper for Prisma queries with retry logic
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 200
): Promise<T> {
  let lastError: unknown = null
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation()
    } catch (error: unknown) {
      lastError = error
      if (!isTransientError(error) || attempt === maxRetries - 1) throw error
      
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 100
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }
  throw lastError
}

/**
 * Safe query wrapper
 */
export async function safeQuery<T>(
  operation: () => Promise<T>,
  fallback?: T
): Promise<{ data: T | null; error: Error | null }> {
  try {
    const data = await withRetry(operation)
    return { data, error: null }
  } catch (error: unknown) {
    const errorObj = error instanceof Error ? error : new Error(String(error))
    logger.error('Database query error', { error: errorObj.message?.slice(0, 200) })
    return { data: fallback ?? null, error: errorObj }
  }
}

/**
 * SECURITY WARNING: Raw queries bypass soft delete middleware.
 * Use this helper to log when raw queries are used on soft-delete models.
 * Always add "deleted_at IS NULL" to WHERE clauses for soft-delete models.
 */
export function rawQueryWithSoftDeleteWarning<T>(
  queryFn: () => Promise<T>,
  tableName: string
): Promise<T> {
  const isSoftDeleteModel = SOFT_DELETE_MODELS.some(
    model => tableName.toLowerCase().includes(model.toLowerCase())
  );
  
  if (isSoftDeleteModel) {
    logger.warn(
      `[Prisma] Raw query on soft-delete table "${tableName}". Ensure deleted_at IS NULL in WHERE clause.`,
      { table: tableName }
    );
  }
  
  return queryFn();
}

/**
 * Safe raw SQL query builder for soft-delete tables.
 * Automatically adds deleted_at IS NULL condition to WHERE clauses.
 * 
 * @param baseQuery - The SQL query string (must contain WHERE clause or we add one)
 * @param tableName - The table being queried (for soft-delete check)
 * @returns Modified query with soft-delete filter
 */
export function buildSoftDeleteSafeQuery(
  baseQuery: string,
  tableName: string
): string {
  const isSoftDeleteModel = SOFT_DELETE_MODELS.some(
    model => tableName.toLowerCase().includes(model.toLowerCase())
  );
  
  if (!isSoftDeleteModel) {
    return baseQuery;
  }
  
  const upperQuery = baseQuery.toUpperCase();
  const hasWhere = upperQuery.includes('WHERE');
  const hasDeletedAtFilter = baseQuery.toLowerCase().includes('deleted_at');
  
  if (hasDeletedAtFilter) {
    return baseQuery;
  }
  
  if (hasWhere) {
    const whereIndex = upperQuery.indexOf('WHERE');
    const afterWhere = whereIndex + 6;
    return `${baseQuery.slice(0, afterWhere)} ${tableName}.deleted_at IS NULL AND ${baseQuery.slice(afterWhere)}`;
  } else {
    const orderByIndex = upperQuery.indexOf('ORDER BY');
    const limitIndex = upperQuery.indexOf('LIMIT');
    const groupByIndex = upperQuery.indexOf('GROUP BY');
    
    const insertPoint = Math.min(
      orderByIndex > -1 ? orderByIndex : baseQuery.length,
      limitIndex > -1 ? limitIndex : baseQuery.length,
      groupByIndex > -1 ? groupByIndex : baseQuery.length
    );
    
    return `${baseQuery.slice(0, insertPoint)} WHERE ${tableName}.deleted_at IS NULL ${baseQuery.slice(insertPoint)}`;
  }
}

/**
 * Execute a raw query with automatic soft-delete filtering for supported tables.
 * This is the PREFERRED method for raw queries on soft-delete models.
 */
export async function executeRawWithSoftDelete<T>(
  queryTemplate: TemplateStringsArray,
  tableName: string,
  ...values: unknown[]
): Promise<T> {
  const isSoftDeleteModel = SOFT_DELETE_MODELS.some(
    model => tableName.toLowerCase().includes(model.toLowerCase())
  );
  
  if (isSoftDeleteModel) {
    logger.debug(`[Prisma] Executing soft-delete-aware raw query on "${tableName}"`);
  }
  
  return prisma.$queryRaw(queryTemplate, ...values) as Promise<T>;
}

const handleShutdown = async () => {
  if (prisma && prisma.$disconnect) await prisma.$disconnect()
  if (prismaRead && prismaRead.$disconnect) await prismaRead.$disconnect()
}

if (typeof process !== 'undefined' && process.on) {
  process.on('beforeExit', handleShutdown)
  process.on('SIGINT', handleShutdown)
  process.on('SIGTERM', handleShutdown)
}
