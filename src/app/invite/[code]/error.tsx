'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'
import { useEffect } from 'react'
import { captureClientError } from '@/lib/errors-client'

export default function InviteError({
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
          <Heading variant="h2">{t('invite.title')}</Heading>
          <Body>{t('invite.body')}</Body>
          {error.digest && (
            <Body variant="muted">
              {t('errorIdLabel')} {error.digest}
            </Body>
          )}
        </div>
        {process.env.NODE_ENV === 'development' && (
          <div className="mt-4 mb-4">
            <details className="text-left">
              <summary className="cursor-pointer font-semibold">{t('detailsLabel')}</summary>
              <Pre className="text-destructive text-xs">
                {error.message}
                {error.stack && `\n\n${error.stack}`}
              </Pre>
            </details>
          </div>
        )}
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </div>
  )
}
