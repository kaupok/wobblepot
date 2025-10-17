'use client'

import { Button } from '@/components/ui/button'
import { H2, P, Muted } from '@/components/ui/typography'
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
        <H2>Oops! Something went wrong</H2>
        <P>We encountered an error while loading this page.</P>
        {process.env.NODE_ENV === 'development' && (
          <details className="bg-muted mt-4 mb-4 rounded-lg p-4 text-left">
            <summary className="cursor-pointer font-semibold">Error details</summary>
            <pre className="text-destructive mt-2 overflow-auto text-xs">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </pre>
          </details>
        )}
        {error.digest && (
          <div className="mb-6">
            <Muted>Error ID: {error.digest}</Muted>
          </div>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
