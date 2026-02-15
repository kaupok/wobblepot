'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'
import { useEffect } from 'react'

export default function HouseholdError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Household error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">Couldn&apos;t load household settings</Heading>
          <Body>We had trouble loading your household settings. Please try again.</Body>
          {error.digest && <Body variant="muted">Error ID: {error.digest}</Body>}
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 mb-4 text-left">
            <summary className="cursor-pointer font-semibold">Error details</summary>
            <Pre className="text-destructive text-xs">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </Pre>
          </details>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
