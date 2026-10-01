import { matchAcceptLanguage } from './accept-language'
import { DEFAULT_LOCALE, isKnownLocale, type Locale } from './locales'

interface ResolveLocaleInput {
  householdLocale?: string | null
  acceptLanguage?: string | null
}

/**
 * Priority order:
 *   1. household.locale (signed-in user with household), validated through
 *      `resolveHouseholdLocale`: an unknown value resolves to DEFAULT_LOCALE
 *      and never reaches Accept-Language
 *   2. Accept-Language header (quality-weighted, primary-subtag fallback),
 *      only when there is no household
 *   3. DEFAULT_LOCALE ("en")
 *
 * A household whose locale has been removed from `KNOWN_LOCALES` (the rollback
 * lever, docs/LOCALIZATION.md) gets English rather than whatever its browser
 * asks for, so chrome agrees with the content and AI paths, which resolve the
 * same household through `resolveHouseholdLocale` and have no header to read.
 */
export function resolveLocale(input: ResolveLocaleInput): Locale {
  const { householdLocale, acceptLanguage } = input

  if (householdLocale != null) {
    return resolveHouseholdLocale({ locale: householdLocale })
  }

  const fromHeader = matchAcceptLanguage(acceptLanguage)
  if (fromHeader) return fromHeader

  return DEFAULT_LOCALE
}

/**
 * The household's locale as a `Locale`: the stored value when it is in
 * `KNOWN_LOCALES`, `DEFAULT_LOCALE` otherwise (and when there is no household).
 * Every server read of `household.locale` that feeds display, translation
 * overlays or AI prompts goes through here, so removing a locale from
 * `KNOWN_LOCALES` reverts all of them at once (HON-921).
 */
export function resolveHouseholdLocale(
  household: { locale: string | null } | null | undefined,
): Locale {
  const locale = household?.locale
  return locale && isKnownLocale(locale) ? locale : DEFAULT_LOCALE
}
