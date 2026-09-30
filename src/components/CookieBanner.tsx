'use client'

import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { useAnalyticsConsent } from '@/components/ConsentProvider'

interface CookieBannerProps {
  /**
   * Whether the mobile bottom tab bar is on screen (signed in with a household).
   * Below `md` the banner lifts above it; otherwise it keeps the plain 16px inset,
   * so a signed-out visitor does not get 80px of empty page under it (HON-845).
   */
  hasTabBar?: boolean
}

export function CookieBanner({ hasTabBar = false }: CookieBannerProps) {
  const t = useTranslations('consent.banner')
  const { grant, withdraw } = useAnalyticsConsent()

  return (
    <div
      className={
        hasTabBar
          ? 'pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-4'
          : 'pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4'
      }
    >
      <Card
        role="region"
        aria-label={t('ariaLabel')}
        className="pointer-events-auto w-full max-w-lg"
      >
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Body variant="small">{t('header')}</Body>
            <Body variant="muted">
              {t('body')}{' '}
              {t.rich('policyLink', {
                // Informed consent (GDPR/ePrivacy): the banner must link the
                // policy it asks consent for — the cookies section of the
                // privacy policy (HON-457; gap left open by HON-462).
                link: (chunks) => (
                  <Link href="/privacy#cookies" className="underline">
                    {chunks}
                  </Link>
                ),
              })}
            </Body>
          </div>
          {/* One row at every width: half each on a phone, label width from `sm` up. */}
          <div className="flex gap-2 sm:justify-end">
            <Button variant="outline" onClick={withdraw} className="flex-1 sm:flex-none">
              {t('essentialOnly')}
            </Button>
            <Button onClick={grant} className="flex-1 sm:flex-none">
              {t('acceptAll')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
