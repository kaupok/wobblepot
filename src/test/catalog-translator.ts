import { type AbstractIntlMessages, createTranslator } from 'next-intl'

import type { Locale } from '@/lib/i18n/locales'

import enMessages from '../../messages/en.json'
import etMessages from '../../messages/et.json'

/**
 * A `getTranslations` stand-in that reads the real catalogs in the locale a
 * test picks, so a page's `generateMetadata` can be asserted for an English
 * and an Estonian household (HON-1464):
 *
 *   vi.mock('next-intl/server', async () => ({
 *     getTranslations: vi.fn((await import('@/test/catalog-translator')).catalogTranslator),
 *   }))
 *
 *   setCatalogLocale('et')
 */
// Typed loosely, because a test passes the namespace as a plain string.
const catalogs: Record<Locale, AbstractIntlMessages> = { en: enMessages, et: etMessages }

let locale: Locale = 'en'

export function setCatalogLocale(next: Locale) {
  locale = next
}

export async function catalogTranslator(namespace: string) {
  return createTranslator({ locale, messages: catalogs[locale], namespace })
}
