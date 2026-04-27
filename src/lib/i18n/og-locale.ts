import type { Locale } from './locales'

/**
 * Map an internal locale code to the BCP-47-with-region form Open Graph expects
 * (e.g. `en_US`, `et_EE`). Centralised so the layout's metadata stays a single
 * source of truth as new locales land.
 */
const OG_LOCALE: Record<Locale, string> = {
  en: 'en_US',
  et: 'et_EE',
}

export function toOgLocale(locale: Locale): string {
  return OG_LOCALE[locale]
}
