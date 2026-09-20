import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import type { Locale } from '@/lib/i18n/locales'

/**
 * Catalog access for email templates.
 *
 * Templates cannot use `getTranslations()` from `next-intl/server`: that
 * resolves the locale through `getRequestConfig` → `getLocale()` → `headers()`,
 * and the Better Auth `sendResetPassword` hook has no guaranteed request scope.
 * `createTranslator` takes the locale and the catalog explicitly instead, which
 * also keeps each template a pure synchronous function that is trivial to test
 * in both locales.
 *
 * Both catalogs are imported statically — `src/app/opengraph-image.tsx` already
 * reads `messages/en.json` this way outside a React tree.
 */

/**
 * The two catalogs, typed as `Messages` (next-intl's own default catalog type)
 * rather than as their literal shapes. Handing `createTranslator` the literal
 * shape of a ~700-key JSON catalog makes it derive every nested message key,
 * which trips `TS2589: Type instantiation is excessively deep`. Email copy is a
 * closed set covered by both template test files plus `catalogue-parity.test.ts`,
 * so per-key typing buys little here.
 */
const CATALOGUES: Record<Locale, Messages> = {
  en: enMessages,
  et: etMessages,
}

/** Namespaces under `emails` in the catalog — one per template. */
export type EmailNamespace = 'resetPassword' | 'accountDeletionRequested'

/**
 * Builds a translator scoped to a namespace under `emails` in the catalog.
 *
 * @param locale - the resolved recipient locale
 * @param namespace - key under `emails`, one per template
 */
export function emailTranslator(locale: Locale, namespace: EmailNamespace) {
  return createTranslator({
    locale,
    messages: CATALOGUES[locale],
    namespace: `emails.${namespace}`,
  })
}
