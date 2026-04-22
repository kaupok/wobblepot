import { getRequestConfig } from 'next-intl/server'
import { getLocale } from './get-locale'

/**
 * next-intl request configuration.
 *
 * We don't use [locale] route segments — the locale is resolved per-request
 * from session/household/Accept-Language via `getLocale()`, so `requestLocale`
 * is always undefined here.
 */
export default getRequestConfig(async () => {
  const locale = await getLocale()
  const messages = (await import(`../../../messages/${locale}.json`)).default

  return {
    locale,
    messages,
  }
})
