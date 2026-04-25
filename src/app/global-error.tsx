'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { useEffect } from 'react'
import { captureClientError } from '@/lib/errors-client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    void captureClientError(error, { digest: error.digest, $exception_source: 'app.global-error' })
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="max-w-md text-center">
            <div className="flex flex-col gap-3">
              <Heading>Something went wrong!</Heading>
              <Body>An unexpected error occurred. We apologize for the inconvenience.</Body>
              {error.digest && <Body variant="muted">Error ID: {error.digest}</Body>}
            </div>
            <Button onClick={reset}>Try again</Button>
          </div>
        </div>
      </body>
    </html>
  )
}
