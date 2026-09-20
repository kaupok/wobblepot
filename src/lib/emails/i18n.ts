import { createTranslator, type Messages } from 'next-intl'
import enMessages from '../../../messages/en.json'
import etMessages from '../../../messages/et.json'
import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales'

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
 * The catalogs, typed as `Messages` (next-intl's own default catalog type)
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Recursively overlays `locale` onto `fallback`, keeping the fallback's value
 * for any key the locale catalog does not define.
 */
function withFallback(
  fallback: Record<string, unknown>,
  locale: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fallback }
  for (const [key, value] of Object.entries(locale)) {
    const base = fallback[key]
    merged[key] = isPlainObject(base) && isPlainObject(value) ? withFallback(base, value) : value
  }
  return merged
}

/**
 * The `emails` namespace per locale, with English underneath as a fallback.
 *
 * Without this, a key missing from a locale's catalog renders next-intl's
 * default fallback — the literal key path — so a password-reset button would
 * read `emails.resetPassword.cta`. Overlaying English means a half-translated
 * catalog degrades to a mixed-language email instead, which is recoverable copy
 * rather than visible breakage. `catalogue-parity.test.ts` is still the thing
 * that should catch the gap first; this is the floor under it.
 *
 * Note the limit: a key that is *present* but whose ICU syntax is malformed
 * still renders the key path, because next-intl only falls back on a missing
 * message, not on a parse error.
 *
 * `?? {}` covers a catalog with no `emails` key at all — the likeliest shape
 * when a new locale's catalog first lands. This runs at module scope, and
 * `i18n.ts` is in the static import graph of `reset-password.ts` → `auth.ts`,
 * so throwing here would fail Better Auth initialisation and 500 every auth
 * route rather than degrading to English.
 */
const EMAIL_MESSAGES = (Object.keys(CATALOGUES) as Locale[]).reduce(
  (accumulator, locale) => {
    accumulator[locale] = {
      emails: withFallback(
        (CATALOGUES[DEFAULT_LOCALE].emails as Record<string, unknown> | undefined) ?? {},
        (CATALOGUES[locale].emails as Record<string, unknown> | undefined) ?? {},
      ),
    }
    return accumulator
  },
  {} as Record<Locale, Messages>,
)

/**
 * Builds a translator scoped to a namespace under `emails` in the catalog.
 *
 * @param locale - the resolved recipient locale
 * @param namespace - key under `emails`, one per template
 */
export function emailTranslator(locale: Locale, namespace: EmailNamespace) {
  return createTranslator({
    locale,
    messages: EMAIL_MESSAGES[locale],
    namespace: `emails.${namespace}`,
  })
}
