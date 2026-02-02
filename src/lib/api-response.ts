import { NextResponse } from 'next/server'

/**
 * P2-10 FIX: Standardized API Response Format
 * All API responses should use this consistent format
 */

export interface ApiErrorResponse {
  error: {
    message: string
    code: string
    requestId?: string
    retryAfter?: number
    details?: Record<string, unknown>
  }
}

export interface PaginationMeta {
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export interface ResponseMeta {
  pagination?: PaginationMeta
  cached?: boolean
  timestamp?: number
}

export interface ApiSuccessResponse<T> {
  data: T
  meta?: ResponseMeta
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse

// Standard error codes
export const ERROR_CODES = {
  // Client errors (4xx)
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  
  // Server errors (5xx)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
} as const

export type ErrorCode = typeof ERROR_CODES[keyof typeof ERROR_CODES]

/**
 * Create a success response with consistent format
 */
export function apiSuccess<T>(
  data: T,
  options?: {
    status?: number
    pagination?: PaginationMeta
    cached?: boolean
    headers?: HeadersInit
  }
): NextResponse<ApiSuccessResponse<T>> {
  const meta: ResponseMeta = {
    timestamp: Date.now(),
  }
  
  if (options?.pagination) {
    meta.pagination = options.pagination
  }
  
  if (options?.cached !== undefined) {
    meta.cached = options.cached
  }

  const response: ApiSuccessResponse<T> = {
    data,
    meta,
  }

  return NextResponse.json(response, {
    status: options?.status ?? 200,
    headers: options?.headers,
  })
}

/**
 * Create an error response with consistent format
 */
export function apiError(
  message: string,
  code: ErrorCode,
  options?: {
    status?: number
    requestId?: string
    retryAfter?: number
    details?: Record<string, unknown>
    headers?: HeadersInit
  }
): NextResponse<ApiErrorResponse> {
  const status = options?.status ?? getStatusFromCode(code)
  
  const response: ApiErrorResponse = {
    error: {
      message,
      code,
      ...(options?.requestId && { requestId: options.requestId }),
      ...(options?.retryAfter && { retryAfter: options.retryAfter }),
      ...(options?.details && { details: options.details }),
    },
  }

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
    ...options?.headers,
  }

  if (options?.retryAfter) {
    (headers as Record<string, string>)['Retry-After'] = String(options.retryAfter)
  }

  return NextResponse.json(response, { status, headers })
}

/**
 * Map error codes to HTTP status codes
 */
function getStatusFromCode(code: ErrorCode): number {
  switch (code) {
    case ERROR_CODES.BAD_REQUEST:
    case ERROR_CODES.VALIDATION_ERROR:
      return 400
    case ERROR_CODES.UNAUTHORIZED:
      return 401
    case ERROR_CODES.FORBIDDEN:
      return 403
    case ERROR_CODES.NOT_FOUND:
      return 404
    case ERROR_CODES.CONFLICT:
      return 409
    case ERROR_CODES.RATE_LIMITED:
      return 429
    case ERROR_CODES.PAYLOAD_TOO_LARGE:
      return 413
    case ERROR_CODES.SERVICE_UNAVAILABLE:
      return 503
    case ERROR_CODES.INTERNAL_ERROR:
    case ERROR_CODES.DATABASE_ERROR:
    case ERROR_CODES.EXTERNAL_SERVICE_ERROR:
    default:
      return 500
  }
}

/**
 * Convenience methods for common errors
 */
export const ApiErrors = {
  badRequest: (message: string, requestId?: string, details?: Record<string, unknown>) =>
    apiError(message, ERROR_CODES.BAD_REQUEST, { requestId, details }),

  unauthorized: (message = 'Authentication required', requestId?: string) =>
    apiError(message, ERROR_CODES.UNAUTHORIZED, { requestId }),

  forbidden: (message = 'Access denied', requestId?: string) =>
    apiError(message, ERROR_CODES.FORBIDDEN, { requestId }),

  notFound: (message = 'Resource not found', requestId?: string) =>
    apiError(message, ERROR_CODES.NOT_FOUND, { requestId }),

  conflict: (message: string, requestId?: string, details?: Record<string, unknown>) =>
    apiError(message, ERROR_CODES.CONFLICT, { requestId, details }),

  validation: (message: string, requestId?: string, details?: Record<string, unknown>) =>
    apiError(message, ERROR_CODES.VALIDATION_ERROR, { requestId, details }),

  rateLimited: (retryAfter: number, requestId?: string) =>
    apiError('Too many requests. Please wait a moment.', ERROR_CODES.RATE_LIMITED, {
      requestId,
      retryAfter,
    }),

  internal: (message = 'An unexpected error occurred', requestId?: string) =>
    apiError(message, ERROR_CODES.INTERNAL_ERROR, { requestId }),

  serviceUnavailable: (message = 'Service temporarily unavailable', requestId?: string) =>
    apiError(message, ERROR_CODES.SERVICE_UNAVAILABLE, { requestId }),

  database: (message = 'Database operation failed', requestId?: string) =>
    apiError(message, ERROR_CODES.DATABASE_ERROR, { requestId }),

  externalService: (service: string, requestId?: string) =>
    apiError(`External service error: ${service}`, ERROR_CODES.EXTERNAL_SERVICE_ERROR, {
      requestId,
      details: { service },
    }),
}

/**
 * Type guard to check if response is an error
 */
export function isApiError(response: ApiResponse<unknown>): response is ApiErrorResponse {
  return 'error' in response
}

/**
 * Type guard to check if response is success
 */
export function isApiSuccess<T>(response: ApiResponse<T>): response is ApiSuccessResponse<T> {
  return 'data' in response
}
