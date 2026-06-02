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

// Locales the locale selector and onboarding clamp expose to general users.
// Today this is identical to `KNOWN_LOCALES`; the distinction is kept so a new
// locale can be added to `KNOWN_LOCALES` (DB + API + translations land) before
// being made selectable in the UI. New locales should not be added here until
// transactional email templates exist in that locale (see HON-513) — otherwise
// users land in localized UI but receive English emails.
export const PUBLIC_LOCALES = ['en', 'et'] as const

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
