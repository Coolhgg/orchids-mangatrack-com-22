"use client"

import React, { Component, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log error to console in development
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error:', error, errorInfo)
    }
    
    // Call custom error handler if provided
    this.props.onError?.(error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
          <div className="size-16 rounded-full bg-red-50 dark:bg-red-950/30 flex items-center justify-center">
            <AlertCircle className="size-8 text-red-500" />
          </div>
          <div className="space-y-2">
            <h3 className="text-lg font-semibold">Something went wrong</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md">
              An error occurred while rendering this component. Please try again.
            </p>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 text-left max-w-md">
                <summary className="cursor-pointer text-xs text-zinc-400 hover:text-zinc-600">
                  Error details
                </summary>
                <pre className="mt-2 text-xs bg-zinc-100 dark:bg-zinc-900 p-2 rounded overflow-auto max-h-32">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
          <Button
            onClick={this.handleReset}
            variant="outline"
            className="rounded-full"
          >
            <RefreshCw className="size-4 mr-2" />
            Try again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}

// Hook for wrapping async operations with error handling
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)

  const handleAsync = React.useCallback(async <T,>(
    asyncFn: () => Promise<T>,
    options?: {
      onError?: (error: Error) => void
      onSuccess?: (result: T) => void
      showToast?: boolean
    }
  ): Promise<T | undefined> => {
    setIsLoading(true)
    setError(null)
    
    try {
      const result = await asyncFn()
      options?.onSuccess?.(result)
      return result
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      setError(error)
      options?.onError?.(error)
      
      if (process.env.NODE_ENV === 'development') {
        console.error('useErrorHandler caught:', error)
      }
      
      return undefined
    } finally {
      setIsLoading(false)
    }
  }, [])

  const clearError = React.useCallback(() => {
    setError(null)
  }, [])

  return {
    error,
    isLoading,
    handleAsync,
    clearError,
  }
}

export default ErrorBoundary
