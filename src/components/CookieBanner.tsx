'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { useAnalyticsConsent } from '@/components/ConsentProvider'

export function CookieBanner() {
  const t = useTranslations('consent.banner')
  const { grant, withdraw } = useAnalyticsConsent()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-4">
      <Card
        role="region"
        aria-label={t('ariaLabel')}
        className="pointer-events-auto w-full max-w-lg"
      >
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Body variant="small">{t('header')}</Body>
            <Body variant="muted">{t('body')}</Body>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={withdraw}>
              {t('essentialOnly')}
            </Button>
            <Button onClick={grant}>{t('acceptAll')}</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
