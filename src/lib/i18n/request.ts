import { getRequestConfig } from 'next-intl/server'
import { getLocale } from './get-locale'
import { isKnownLocale } from './locales'

/**
 * next-intl request configuration.
 *
 * We don't use [locale] route segments — the locale is resolved per-request
 * from session/household/Accept-Language via `getLocale()`, so `requestLocale`
 * is always undefined here.
 *
 * An explicit `getTranslations({ locale, namespace })` reaches this as
 * `params.locale` and wins: next-intl uses the locale and messages returned
 * here, not the one it was passed, so ignoring the override would silently
 * translate with `getLocale()`'s locale instead. Routes that already hold the
 * household pass `resolveHouseholdLocale(household)` this way, which also
 * skips `getLocale()`'s session and membership reads (HON-921).
 */
export default getRequestConfig(async ({ locale: override }) => {
  const locale = override && isKnownLocale(override) ? override : await getLocale()
  const messages = (await import(`../../../messages/${locale}.json`)).default

  return {
    locale,
    messages,
  }
})
