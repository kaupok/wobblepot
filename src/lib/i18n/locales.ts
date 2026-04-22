export const KNOWN_LOCALES = ['en', 'et'] as const

export type Locale = (typeof KNOWN_LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'en'

export function isKnownLocale(value: string): value is Locale {
  return (KNOWN_LOCALES as readonly string[]).includes(value)
}
