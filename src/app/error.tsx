'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'
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
        <div className="mb-4">
          <Heading variant="h2">Oops! Something went wrong</Heading>
        </div>
        <div className="mb-2">
          <Body>We encountered an error while loading this page.</Body>
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 mb-4 text-left">
            <summary className="cursor-pointer font-semibold">Error details</summary>
            <Pre className="text-destructive mt-2 text-xs">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </Pre>
          </details>
        )}
        {error.digest && (
          <div className="mb-6">
            <Body variant="muted">Error ID: {error.digest}</Body>
          </div>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
