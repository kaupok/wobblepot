'use client'

import { useTranslations } from 'next-intl'
import { useEffect } from 'react'

import { ErrorDetails } from '@/components/ErrorDetails'
import { Button } from '@/components/ui/button'
import { Body, Heading } from '@/components/ui/typography'
import { captureClientError } from '@/lib/errors-client'

// Renders inside the account layout, under its "My account" `h1` and the tabs,
// so the message is a section of the column, not a page of its own (HON-1229).
export default function AccountError({
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
          {t('profile.title')}
        </Heading>
        <Body>{t('profile.body')}</Body>
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
