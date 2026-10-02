'use client'

import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { useEffect, useSyncExternalStore } from 'react'
import { clientEnv } from '@/lib/env'
import { decisionToGranted } from '@/lib/consent'
import { readConsentCookieClient } from '@/lib/consent.client'
import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'
import { POSTHOG_URL_MASKING, postHogBeforeSend } from '@/lib/posthog-before-send'
import { POSTHOG_PROXY_PATH, POSTHOG_UI_HOST } from '@/lib/posthog-proxy'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { detectClientLocale, globalErrorTranslator } from '@/lib/i18n/global-error-messages'

// Nothing to subscribe to: the locale is read once per render from the DOM and
// `navigator`. `useSyncExternalStore` is used for its server snapshot, so a
// prerendered page hydrates as English and then re-renders in the detected
// locale instead of failing hydration.
const subscribe = () => () => {}
const serverLocale = () => DEFAULT_LOCALE
const isBrowser = () => true
const isServer = () => false

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const locale = useSyncExternalStore(subscribe, detectClientLocale, serverLocale)
  const rendered = useSyncExternalStore(subscribe, isBrowser, isServer) ? 'client' : 'server'
  const t = globalErrorTranslator(locale)

  useEffect(() => {
    void (async () => {
      try {
        // global-error renders outside layout providers — PostHogProvider never mounts, so init here.
        if (decisionToGranted(readConsentCookieClient()) !== true) return
        if (!clientEnv.NEXT_PUBLIC_POSTHOG_KEY || !clientEnv.NEXT_PUBLIC_POSTHOG_HOST) return
        const { default: posthog } = await import('posthog-js')
        if (!posthog.__loaded) {
          // Mirror PostHogProvider's init — once posthog-js initialises, re-init is a no-op,
          // so a minimal config here would silently drop the sanitiser for the rest of the session.
          posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY as string, {
            api_host: POSTHOG_PROXY_PATH,
            ui_host: POSTHOG_UI_HOST,
            person_profiles: 'identified_only',
            capture_pageview: false,
            capture_pageleave: true,
            disable_session_recording: true,
            defaults: '2026-01-30',
            before_send: postHogBeforeSend,
            ...POSTHOG_URL_MASKING,
          })
        }
        const properties: Record<string, unknown> = {
          $exception_source: 'app.global-error',
          digest: error.digest,
          errorType: errorTypeOf(error),
        }
        const fingerprint = fingerprintFor(error)
        if (fingerprint) {
          properties.$exception_fingerprint = fingerprint
        }
        posthog.captureException(error, properties)
      } catch {
        // Swallow — capture must never crash the error UI.
      }
    })()
  }, [error])

  return (
    // `data-global-error` tells `detectClientLocale` whether this `lang` was detected
    // in the browser or is only the server default.
    <html lang={locale} data-global-error={rendered}>
      <body>
        <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
          <div className="max-w-md text-center">
            <div className="flex flex-col gap-3">
              <Heading>{t('global.title')}</Heading>
              <Body>{t('global.body')}</Body>
              {error.digest && (
                <Body variant="muted">
                  {t('boundary.errorIdLabel')} {error.digest}
                </Body>
              )}
            </div>
            <div className="mt-4">
              <Body variant="muted">
                {t.rich('boundary.supportPrompt', {
                  email: SUPPORT_EMAIL,
                  link: (chunks) => (
                    <a className="underline" href={SUPPORT_EMAIL_HREF}>
                      {chunks}
                    </a>
                  ),
                })}
              </Body>
            </div>
            <Button onClick={reset}>{t('boundary.tryAgain')}</Button>
          </div>
        </div>
      </body>
    </html>
  )
}
