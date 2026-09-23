'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { ErrorDetails } from '@/components/ErrorDetails'
import { useEffect } from 'react'
import { captureClientError } from '@/lib/errors-client'

export default function ShoppingError({
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">{t('shopping.title')}</Heading>
          <Body>{t('shopping.body')}</Body>
          {error.digest && (
            <Body variant="muted">
              {t('errorIdLabel')} {error.digest}
            </Body>
          )}
        </div>
        <ErrorDetails error={error} className="mt-4 mb-4" />
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </div>
  )
}
