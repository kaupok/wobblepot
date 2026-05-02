'use client'

import { useEffect } from 'react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Heading, Body, Pre } from '@/components/ui/typography'
import { captureClientError } from '@/lib/errors-client'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('errors.boundary')

  useEffect(() => {
    void captureClientError(error, { digest: error.digest, $exception_source: 'app.error' })
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <div className="max-w-md text-center">
        <div className="flex flex-col gap-3">
          <Heading variant="h2">{t('generic.title')}</Heading>
          <Body>{t('generic.body')}</Body>
          {error.digest && (
            <Body variant="muted">
              {t('errorIdLabel')} {error.digest}
            </Body>
          )}
        </div>
        {process.env.NODE_ENV === 'development' && (
          <details className="mt-4 mb-4 text-left">
            <summary className="cursor-pointer font-semibold">{t('detailsLabel')}</summary>
            <Pre className="text-destructive text-xs">
              {error.message}
              {error.stack && `\n\n${error.stack}`}
            </Pre>
          </details>
        )}
        <div className="mt-4">
          <Body variant="muted">
            {t.rich('supportPrompt', {
              email: SUPPORT_EMAIL,
              link: (chunks) => (
                <a className="underline" href={SUPPORT_EMAIL_HREF}>
                  {chunks}
                </a>
              ),
            })}
          </Body>
        </div>
        <Button onClick={reset}>{t('tryAgain')}</Button>
      </div>
    </div>
  )
}
