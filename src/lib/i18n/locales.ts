import { z } from 'zod'

/**
 * Both `en` and `et` are LTR languages — no RTL handling is wired in the app.
 * Adding a future RTL locale (Arabic, Hebrew, Persian, …) requires:
 *   1. Add the locale to `KNOWN_LOCALES`.
 *   2. Add a `direction` field to a parallel map (`'ltr' | 'rtl'`).
 *   3. Set `<html dir>` from that map in `src/app/layout.tsx` alongside `lang`.
 *   4. Audit Tailwind utility usage for direction-sensitive classes
 *      (`mr-`, `ml-`, `pl-`, `pr-`, …) and switch to logical equivalents
 *      (`ms-`, `me-`, `ps-`, `pe-`).
 *
 * Tracked as deferred work — punted intentionally per HON-511 scope.
 */
export const KNOWN_LOCALES = ['en', 'et'] as const

// Subset of KNOWN_LOCALES that general users may pick in the locale selector.
// DB + API still accept every KNOWN_LOCALES value — this gates the UI path only,
// so a household whose persisted locale is outside this list (e.g. via a direct
// DB write, or Accept-Language auto-resolution at onboarding) still round-trips:
// the selector renders the current value as disabled rather than clamping state
// on load. Keep this narrower than KNOWN_LOCALES until the matching transactional
// email templates are localized and the partner-test iteration has closed,
// otherwise the selector lands users in a half-finished experience (localized UI,
// English emails). Lift by widening to `['en', 'et'] as const` once both
// conditions are met.
export const PUBLIC_LOCALES = ['en'] as const

export type Locale = (typeof KNOWN_LOCALES)[number]
export type PublicLocale = (typeof PUBLIC_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LocaleSchema = z.enum(KNOWN_LOCALES)

export function isKnownLocale(value: string): value is Locale {
  return (KNOWN_LOCALES as readonly string[]).includes(value)
}

export function isPublicLocale(value: string): value is PublicLocale {
  return (PUBLIC_LOCALES as readonly string[]).includes(value)
}

export function isDefaultLocale(locale: string | null | undefined): boolean {
  // Treat missing/null/undefined as default — callers may pass `household.locale`
  // before the field is hydrated in tests, and the safe behaviour is "no translation".
  return !locale || locale === DEFAULT_LOCALE
}
