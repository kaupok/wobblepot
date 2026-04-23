import { z } from 'zod'

export const KNOWN_LOCALES = ['en', 'et'] as const

export type Locale = (typeof KNOWN_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export const LocaleSchema = z.enum(KNOWN_LOCALES)

export function isKnownLocale(value: string): value is Locale {
  return (KNOWN_LOCALES as readonly string[]).includes(value)
}

export function isDefaultLocale(locale: string | null | undefined): boolean {
  // Treat missing/null/undefined as default — callers may pass `household.locale`
  // before the field is hydrated in tests, and the safe behaviour is "no translation".
  return !locale || locale === DEFAULT_LOCALE
}
