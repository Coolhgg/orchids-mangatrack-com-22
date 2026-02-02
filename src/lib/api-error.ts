/**
 * API Error Handling Utilities
 */

export class APIError extends Error {
  status: number
  code?: string

  constructor(message: string, status: number, code?: string) {
    super(message)
    this.name = "APIError"
    this.status = status
    this.code = code
  }
}

export function isAPIError(error: unknown): error is APIError {
  return error instanceof APIError
}

export async function fetchWithErrorHandling<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  try {
    const response = await fetch(url, options)

    if (!response.ok) {
      let errorMessage = `HTTP error ${response.status}`
      let errorCode: string | undefined

      try {
        const errorData = await response.json()
        errorMessage = errorData.error || errorData.message || errorMessage
        errorCode = errorData.code
      } catch {
        // Response is not JSON
      }

      throw new APIError(errorMessage, response.status, errorCode)
    }

    return response.json()
  } catch (error) {
    if (error instanceof APIError) {
      throw error
    }

    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new APIError(
        "Network error. Please check your connection.",
        0,
        "NETWORK_ERROR"
      )
    }

    throw new APIError(
      error instanceof Error ? error.message : "An unexpected error occurred",
      500,
      "UNKNOWN_ERROR"
    )
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof APIError) {
    switch (error.status) {
      case 400:
        return error.message || "Invalid request"
      case 401:
        return "Please sign in to continue"
      case 403:
        return "You don't have permission to do this"
      case 404:
        return error.message || "Not found"
      case 409:
        return error.message || "This action conflicts with existing data"
      case 429:
        return "Too many requests. Please wait a moment."
      case 500:
        return "Server error. Please try again later."
      default:
        return error.message || "Something went wrong"
    }
  }

  if (error instanceof Error) {
    return error.message
  }

  return "An unexpected error occurred"
}

export function handleAPIError(error: unknown, fallback?: string): never {
  const message = getErrorMessage(error)
  throw new Error(fallback || message)
}

/**
 * Retry utility for failed requests
 */
export async function fetchWithRetry<T>(
  url: string,
  options?: RequestInit & { retries?: number; retryDelay?: number }
): Promise<T> {
  const { retries = 3, retryDelay = 1000, ...fetchOptions } = options || {}

  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fetchWithErrorHandling<T>(url, fetchOptions)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      // Don't retry on client errors (4xx) except 429
      if (error instanceof APIError) {
        if (error.status >= 400 && error.status < 500 && error.status !== 429) {
          throw error
        }
      }

      if (attempt < retries) {
        // Exponential backoff
        await new Promise((resolve) =>
          setTimeout(resolve, retryDelay * Math.pow(2, attempt))
        )
      }
    }
  }

  throw lastError
}

/**
 * Optimistic update helper
 */
export function createOptimisticUpdate<T, U>(
  currentState: T,
  optimisticValue: T,
  apiCall: () => Promise<U>,
  onSuccess?: (result: U) => void,
  onError?: (error: Error, rollback: () => void) => void
): {
  execute: () => Promise<void>
  rollback: () => T
} {
  let rolledBack = false

  return {
    execute: async () => {
      try {
        const result = await apiCall()
        if (!rolledBack) {
          onSuccess?.(result)
        }
      } catch (error) {
        onError?.(
          error instanceof Error ? error : new Error(String(error)),
          () => {
            rolledBack = true
          }
        )
      }
    },
    rollback: () => currentState,
  }
}
