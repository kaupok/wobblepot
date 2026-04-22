import { matchAcceptLanguage } from './accept-language'
import { DEFAULT_LOCALE, isKnownLocale, type Locale } from './locales'

interface ResolveLocaleInput {
  householdLocale?: string | null
  acceptLanguage?: string | null
}

/**
 * Priority order:
 *   1. household.locale (signed-in user with household)
 *   2. Accept-Language header (quality-weighted, primary-subtag fallback)
 *   3. DEFAULT_LOCALE ("en")
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  const { householdLocale, acceptLanguage } = input

  if (householdLocale && isKnownLocale(householdLocale)) {
    return householdLocale
  }

  const fromHeader = matchAcceptLanguage(acceptLanguage)
  if (fromHeader) return fromHeader

  return DEFAULT_LOCALE
}
