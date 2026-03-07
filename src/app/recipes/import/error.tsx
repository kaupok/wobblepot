'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'
import { useEffect } from 'react'

export default function RecipeImportError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error('Recipe import error:', error)
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">Couldn&apos;t load recipe import</Heading>
          <Body>We had trouble loading the recipe import page. Please try again.</Body>
          {error.digest && <Body variant="muted">Error ID: {error.digest}</Body>}
        </div>
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-4 mb-4">
            <details className="text-left">
              <summary className="cursor-pointer font-semibold">Error details</summary>
              <Pre className="text-destructive text-xs">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </Pre>
            </details>
          </div>
        )}
        <Button onClick={reset}>Try again</Button>
      </div>
    </div>
  )
}
