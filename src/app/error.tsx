'use client'

import { useEffect } from 'react'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to error reporting service (e.g., Sentry, LogRocket)
    // eslint-disable-next-line no-console
    console.error('Route error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <h2 className="mb-4 text-3xl font-bold">Oops! Something went wrong</h2>
        <p className="mb-2 text-gray-600">We encountered an error while loading this page.</p>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 mb-4 rounded-lg bg-gray-100 p-4 text-left">
            <summary className="cursor-pointer font-semibold">Error details</summary>
            <pre className="mt-2 overflow-auto text-xs text-red-600">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
        {error.digest && <p className="mb-6 text-sm text-gray-500">Error ID: {error.digest}</p>}
        <button
          onClick={reset}
          className="rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white transition-colors hover:bg-blue-700"
        >
          Try again
        </button>
      </div>
    </div>
  )
}
