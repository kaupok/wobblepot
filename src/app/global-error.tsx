'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { useEffect } from 'react'
import { clientEnv } from '@/lib/env'
import { decisionToGranted } from '@/lib/consent'
import { readConsentCookieClient } from '@/lib/consent.client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    void (async () => {
      try {
        // global-error renders outside layout providers — PostHogProvider never mounts, so init here.
        if (decisionToGranted(readConsentCookieClient()) !== true) return
        if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY || !clientEnv.NEXT_PUBLIC_POSTHOG_HOST) return
        const { default: posthog } = await import('posthog-js')
        if (!posthog.__loaded) {
          posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY as string, {
            api_host: clientEnv.NEXT_PUBLIC_POSTHOG_HOST as string,
            person_profiles: 'identified_only',
            capture_pageview: false,
            disable_session_recording: true,
          })
        }
        posthog.captureException(error, {
          $exception_source: 'app.global-error',
          digest: error.digest,
        })
      } catch {
        // Swallow — capture must never crash the error UI.
      }
    })()
  }, [error])

  return (
    <html lang="en">
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="max-w-md text-center">
            <div className="flex flex-col gap-3">
              <Heading>Something went wrong!</Heading>
              <Body>An unexpected error occurred. We apologize for the inconvenience.</Body>
              {error.digest && <Body variant="muted">Error ID: {error.digest}</Body>}
            </div>
            <Button onClick={reset}>Try again</Button>
          </div>
        </div>
      </body>
    </html>
  )
}
