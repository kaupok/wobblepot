import { isKnownLocale, type Locale } from './locales'

interface ParsedAcceptLanguage {
  locale: string
  q: number
}

export function parseAcceptLanguage(header: string | null | undefined): ParsedAcceptLanguage[] {
  if (!header) return []

  const entries: ParsedAcceptLanguage[] = []
  for (const part of header.split(',')) {
    const [langToken, ...params] = part.trim().split(';')
    const locale = (langToken ?? '').trim().toLowerCase()
    if (!locale || locale === '*') continue

    let q = 1.0
    for (const param of params) {
      const trimmed = param.trim()
      if (trimmed.startsWith('q=')) {
        const value = Number.parseFloat(trimmed.slice(2))
        if (!Number.isNaN(value)) q = value
      }
    }

    // `q=0` means "not acceptable" (RFC 9110 §12.4.2): a refusal, not a
    // low-priority preference, so `fr, et;q=0` must not resolve to `et`.
    if (q <= 0) continue

    entries.push({ locale, q })
  }

  return entries.sort((a, b) => b.q - a.q)
}

export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  const entries = parseAcceptLanguage(header)
  for (const { locale } of entries) {
    if (isKnownLocale(locale)) return locale
    const primary = locale.split('-')[0]
    if (primary && isKnownLocale(primary)) return primary
  }
  return null
}
