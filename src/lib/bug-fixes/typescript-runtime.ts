/**
 * F. TYPESCRIPT / LINT / RUNTIME (Bugs 86-100)
 * 
 * Comprehensive fixes for TypeScript safety and runtime issues.
 */

import { z } from 'zod';

// Bug 86: any used in metadata payload paths
export type MetadataPayload = {
  title: string;
  description?: string;
  cover_url?: string;
  genres?: string[];
  tags?: string[];
  status?: 'ongoing' | 'completed' | 'hiatus' | 'cancelled';
  type?: 'manga' | 'manhwa' | 'manhua' | 'comic' | 'novel';
  year?: number;
  alternative_titles?: string[];
  external_links?: Record<string, string>;
};

export function isMetadataPayload(value: unknown): value is MetadataPayload {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return typeof obj.title === 'string';
}

// Bug 87: Type narrowing relies on runtime assumptions
export function assertDefined<T>(
  value: T | null | undefined,
  errorMessage: string
): asserts value is T {
  if (value === null || value === undefined) {
    throw new Error(errorMessage);
  }
}

export function assertString(value: unknown, fieldName: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new Error(`Expected ${fieldName} to be a string, got ${typeof value}`);
  }
}

export function assertNumber(value: unknown, fieldName: string): asserts value is number {
  if (typeof value !== 'number' || isNaN(value)) {
    throw new Error(`Expected ${fieldName} to be a number, got ${typeof value}`);
  }
}

// Bug 88: Non-exhaustive enum handling in switches
export type MetadataStatus = 'pending' | 'enriched' | 'unavailable' | 'failed';
export type LibraryStatus = 'reading' | 'completed' | 'on_hold' | 'dropped' | 'plan_to_read';
export type SyncPriority = 'HOT' | 'WARM' | 'COLD' | 'FROZEN';

export function assertExhaustive(value: never, message: string = 'Unexpected value'): never {
  throw new Error(`${message}: ${JSON.stringify(value)}`);
}

export function handleMetadataStatus(status: MetadataStatus): string {
  switch (status) {
    case 'pending': return 'Awaiting enrichment';
    case 'enriched': return 'Successfully enriched';
    case 'unavailable': return 'No match found';
    case 'failed': return 'Enrichment failed';
    default: return assertExhaustive(status, 'Unknown metadata status');
  }
}

export function handleLibraryStatus(status: LibraryStatus): string {
  switch (status) {
    case 'reading': return 'Currently reading';
    case 'completed': return 'Finished reading';
    case 'on_hold': return 'Temporarily paused';
    case 'dropped': return 'No longer following';
    case 'plan_to_read': return 'Planning to read';
    default: return assertExhaustive(status, 'Unknown library status');
  }
}

// Bug 89: Promise rejections not always awaited
export async function safeAwait<T>(
  promise: Promise<T>
): Promise<[T, null] | [null, Error]> {
  try {
    const result = await promise;
    return [result, null];
  } catch (error) {
    return [null, error instanceof Error ? error : new Error(String(error))];
  }
}

export async function safeAwaitAll<T>(
  promises: Promise<T>[]
): Promise<{ results: T[]; errors: Error[] }> {
  const settled = await Promise.allSettled(promises);
  const results: T[] = [];
  const errors: Error[] = [];

  for (const result of settled) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      errors.push(result.reason instanceof Error ? result.reason : new Error(String(result.reason)));
    }
  }

  return { results, errors };
}

// Bug 90: Silent catch blocks exist
export interface CaughtError {
  error: Error;
  context: string;
  timestamp: Date;
  handled: boolean;
}

const caughtErrors: CaughtError[] = [];

export function logCaughtError(
  error: unknown,
  context: string,
  shouldRethrow: boolean = false
): void {
  const err = error instanceof Error ? error : new Error(String(error));
  
  caughtErrors.push({
    error: err,
    context,
    timestamp: new Date(),
    handled: !shouldRethrow
  });

  console.error(`[${context}] Caught error: ${err.message}`);

  if (shouldRethrow) {
    throw err;
  }
}

export function getCaughtErrors(): CaughtError[] {
  return [...caughtErrors];
}

export function clearCaughtErrors(): void {
  caughtErrors.length = 0;
}

// Bug 91: Optional chaining hides nullability bugs
export function requireProperty<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  errorMessage?: string
): NonNullable<T[K]> {
  if (obj === null || obj === undefined) {
    throw new Error(errorMessage || `Object is ${obj}`);
  }
  
  const value = obj[key];
  if (value === null || value === undefined) {
    throw new Error(errorMessage || `Property ${String(key)} is ${value}`);
  }
  
  return value as NonNullable<T[K]>;
}

export function safeGet<T, K extends keyof T>(
  obj: T | null | undefined,
  key: K,
  defaultValue: NonNullable<T[K]>
): NonNullable<T[K]> {
  if (obj === null || obj === undefined) {
    return defaultValue;
  }
  
  const value = obj[key];
  if (value === null || value === undefined) {
    return defaultValue;
  }
  
  return value as NonNullable<T[K]>;
}

// Bug 92: as casts bypass type safety
export function safeCast<T>(
  value: unknown,
  validator: (v: unknown) => v is T,
  errorMessage?: string
): T {
  if (validator(value)) {
    return value;
  }
  throw new Error(errorMessage || `Invalid cast: value does not match expected type`);
}

export function createTypeGuard<T>(schema: z.ZodType<T>): (value: unknown) => value is T {
  return (value: unknown): value is T => {
    return schema.safeParse(value).success;
  };
}

// Bug 93: Inconsistent Date handling (UTC vs local)
export function toUTC(date: Date | string | number): Date {
  const d = new Date(date);
  return new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds()
  ));
}

export function formatUTCDate(date: Date): string {
  return date.toISOString();
}

export function parseUTCDate(dateString: string): Date {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  return date;
}

export function isValidDate(date: unknown): date is Date {
  return date instanceof Date && !isNaN(date.getTime());
}

// Bug 94: Floating-point math used for ordering
export const CHAPTER_NUMBER_PRECISION = 2;

export function normalizeChapterFloat(value: number): number {
  const multiplier = Math.pow(10, CHAPTER_NUMBER_PRECISION);
  return Math.round(value * multiplier) / multiplier;
}

export function compareChapterFloats(a: number, b: number): number {
  const normA = normalizeChapterFloat(a);
  const normB = normalizeChapterFloat(b);
  const diff = normA - normB;
  
  if (Math.abs(diff) < 0.001) return 0;
  return diff < 0 ? -1 : 1;
}

export function chapterToSortKey(chapterNumber: number): string {
  const normalized = normalizeChapterFloat(chapterNumber);
  const intPart = Math.floor(normalized);
  const decPart = Math.round((normalized - intPart) * 100);
  return `${String(intPart).padStart(6, '0')}.${String(decPart).padStart(2, '0')}`;
}

// Bug 95: Implicit undefined treated as valid state
export type Defined<T> = Exclude<T, undefined>;

export function isDefined<T>(value: T | undefined): value is Defined<T> {
  return value !== undefined;
}

export function requireDefined<T>(
  value: T | undefined,
  fieldName: string
): Defined<T> {
  if (value === undefined) {
    throw new Error(`${fieldName} is undefined`);
  }
  return value as Defined<T>;
}

// Bug 96: Missing ESLint rules for async misuse
export function wrapAsync<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  errorHandler?: (error: Error) => void
): (...args: T) => Promise<R | undefined> {
  return async (...args: T): Promise<R | undefined> => {
    try {
      return await fn(...args);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      if (errorHandler) {
        errorHandler(err);
      } else {
        console.error('Unhandled async error:', err);
      }
      return undefined;
    }
  };
}

// Bug 97: No strict typing for external API responses
export const MangaDexResponseSchema = z.object({
  result: z.literal('ok'),
  data: z.object({
    id: z.string(),
    type: z.string(),
    attributes: z.object({
      title: z.record(z.string()).optional(),
      description: z.record(z.string()).optional(),
      status: z.string().optional(),
      year: z.number().nullable().optional(),
      contentRating: z.string().optional(),
      tags: z.array(z.object({
        id: z.string(),
        attributes: z.object({
          name: z.record(z.string()),
          group: z.string()
        })
      })).optional()
    })
  })
});

export type MangaDexResponse = z.infer<typeof MangaDexResponseSchema>;

export function validateApiResponse<T>(
  data: unknown,
  schema: z.ZodType<T>,
  apiName: string
): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const errors = result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
    throw new Error(`Invalid ${apiName} response: ${errors}`);
  }
  return result.data;
}

// Bug 98: TS types drift from DB schema
export interface DbSchemaValidation {
  tableName: string;
  expectedColumns: string[];
  actualColumns: string[];
  mismatches: string[];
}

export const LIBRARY_ENTRY_EXPECTED_COLUMNS = [
  'id', 'user_id', 'series_id', 'source_url', 'source_name',
  'imported_title', 'metadata_status', 'status', 'last_read_chapter',
  'last_read_at', 'needs_review', 'metadata_retry_count',
  'last_metadata_error', 'last_metadata_attempt_at', 'sync_status',
  'last_sync_error', 'last_sync_at', 'deleted_at', 'added_at', 'updated_at'
];

export const SERIES_EXPECTED_COLUMNS = [
  'id', 'mangadex_id', 'title', 'alternative_titles', 'description',
  'cover_url', 'type', 'status', 'genres', 'content_rating',
  'total_follows', 'metadata_source', 'metadata_confidence',
  'deleted_at', 'created_at', 'updated_at'
];

// Bug 99: Runtime validation missing for critical inputs
export function validateCriticalInput<T>(
  input: unknown,
  schema: z.ZodType<T>,
  inputName: string
): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    const errors = result.error.errors
      .map(e => `${e.path.join('.') || inputName}: ${e.message}`)
      .join('; ');
    throw new Error(`Invalid ${inputName}: ${errors}`);
  }
  return result.data;
}

export const UuidSchema = z.string().uuid();
export const PositiveIntSchema = z.number().int().positive();
export const NonEmptyStringSchema = z.string().min(1);
export const UrlSchema = z.string().url();
export const EmailSchema = z.string().email();

// Bug 100: Build passes but runtime invariants not enforced
export interface RuntimeInvariant {
  name: string;
  check: () => boolean;
  message: string;
  critical: boolean;
}

const runtimeInvariants: RuntimeInvariant[] = [];

export function registerInvariant(invariant: RuntimeInvariant): void {
  runtimeInvariants.push(invariant);
}

export function checkAllInvariants(): { passed: boolean; failures: string[] } {
  const failures: string[] = [];
  
  for (const invariant of runtimeInvariants) {
    try {
      if (!invariant.check()) {
        failures.push(`${invariant.name}: ${invariant.message}`);
        if (invariant.critical) {
          throw new Error(`Critical invariant failed: ${invariant.name}`);
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      failures.push(`${invariant.name}: Exception - ${err.message}`);
      if (invariant.critical) {
        throw err;
      }
    }
  }
  
  return {
    passed: failures.length === 0,
    failures
  };
}

export function assertInvariant(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`Invariant violation: ${message}`);
  }
}

// Environment variable validation
export const RequiredEnvVarsSchema = z.object({
  DATABASE_URL: z.string().min(1),
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1)
});

export function validateEnvVars(): void {
  const result = RequiredEnvVarsSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.errors.map(e => e.path.join('.')).join(', ');
    console.warn(`Missing or invalid environment variables: ${missing}`);
  }
}
