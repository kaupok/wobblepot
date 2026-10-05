'use client'

// This document replaces the root layout, so the layout's `globals.css` import
// does not cover it. The failing route's CSS usually loads anyway, but the
// prerendered `_global-error` page carries only what this file imports (HON-1047).
import './globals.css'
import { Button } from '@/components/ui/button'
import { Heading, Body } from '@/components/ui/typography'
import { useEffect, useSyncExternalStore } from 'react'
import { clientEnv } from '@/lib/env'
import { decisionToGranted } from '@/lib/consent'
import { readConsentCookieClient } from '@/lib/consent.client'
import { errorTypeOf, fingerprintFor } from '@/lib/errors-shared'
import { POSTHOG_INIT_OPTIONS } from '@/lib/posthog-init-options'
import { markPostHogLoaded } from '@/lib/posthog-client-state'
import { SUPPORT_EMAIL, SUPPORT_EMAIL_HREF } from '@/lib/support'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import { geistMono, geistSans } from '@/lib/fonts'
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
          // The same options as PostHogProvider's init — once posthog-js initialises, re-init is
          // a no-op, so a minimal config here would silently drop the sanitiser for the session.
          posthog.init(clientEnv.NEXT_PUBLIC_POSTHOG_KEY as string, { ...POSTHOG_INIT_OPTIONS })
          markPostHogLoaded()
        }
        const properties: Record<string, unknown> = {
          $exception_source: 'app.global-error',
          digest: error.digest,
          error_type: errorTypeOf(error),
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
    // in the browser or is only the server default. The root layout's font
    // classes do not reach this document, so it sets its own (HON-1047).
    <html
      lang={locale}
      data-global-error={rendered}
      className={`${geistSans.variable} ${geistMono.variable}`}
    >
      <body className="antialiased">
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
