'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { ErrorDetails } from '@/components/ErrorDetails'
import { useEffect } from 'react'
import { captureClientError } from '@/lib/errors-client'

// Renders inside the household layout, under its "Household" `h1` and the
// tabs, so the message is a section of the column, not a page of its own
// (HON-1257, as `src/app/account/error.tsx`).
export default function HouseholdError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.boundary')

  useEffect(() => {
    void captureClientError(error, { digest: error.digest })
  }, [error])

  return (
    <div>
      <div className="flex flex-col gap-3">
        <Heading as="h2" variant="section">
          {t('household.title')}
        </Heading>
        <Body>{t('household.body')}</Body>
        {error.digest && (
          <Body variant="muted">
            {t('errorIdLabel')} {error.digest}
          </Body>
        )}
      </div>
      <ErrorDetails error={error} className="mt-4 mb-4" />
      <Button onClick={reset}>{t('tryAgain')}</Button>
    </div>
  )
}
