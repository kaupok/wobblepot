'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log error to error reporting service
    // eslint-disable-next-line no-console
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="max-w-md text-center">
            <div className="mb-4">
              <Heading>Something went wrong!</Heading>
            </div>
            <div className="mb-2">
              <Body>An unexpected error occurred. We apologize for the inconvenience.</Body>
            </div>
            {error.digest && (
              <div className="mb-6">
                <Body variant="muted">Error ID: {error.digest}</Body>
              </div>
            )}
            <Button onClick={reset}>Try again</Button>
          </div>
        </div>
      </body>
    </html>
  )
}
