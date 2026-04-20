'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { useAnalyticsConsent } from '@/components/ConsentProvider'

export function CookieBanner() {
  const { grant, withdraw } = useAnalyticsConsent()

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-4">
      <Card
        role="region"
        aria-label="Cookie consent"
        className="pointer-events-auto w-full max-w-lg"
      >
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Body variant="small">We use cookies</Body>
            <Body variant="muted">
              Essential cookies keep you signed in. Analytics cookies help us understand how the app
              is used so we can improve it. You can change this any time from the footer.
            </Body>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="outline" onClick={withdraw}>
              Essential only
            </Button>
            <Button onClick={grant}>Accept all</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
