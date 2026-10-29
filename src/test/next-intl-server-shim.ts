import { createTranslator, type Messages } from 'next-intl'

import { isKnownLocale, type Locale } from '@/lib/i18n/locales'

import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'

// Vitest alias target for `next-intl/server` in the `unit-db` project only
// (HON-1208). Under Vitest the package resolves to its client build, whose
// `getTranslations` throws, so a `src/lib` function that formats copy could
// not run in a `*.db.test.ts`. The `src/lib` callers pass the household's
// locale explicitly, and for an explicit locale `src/lib/i18n/request.ts`
// answers with that locale's catalog; this does the same over the real
// catalogs, so a test asserts the strings a household sees. A call without a
// locale would need the request, so it throws instead of guessing one.

const CATALOGUES: Record<Locale, Messages> = { en: enMessages, et: etMessages }

export async function getTranslations({
  locale,
  namespace,
}: {
  locale?: string
  namespace?: string
} = {}) {
  if (!locale || !isKnownLocale(locale)) {
    throw new Error(`next-intl-server-shim: pass a known locale, got ${locale}`)
  }
  return createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: namespace as never,
  })
}
