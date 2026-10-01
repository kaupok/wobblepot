import { createTranslator, type Messages } from 'next-intl'
import { matchAcceptLanguage } from './accept-language'
import { DEFAULT_LOCALE, isKnownLocale, type Locale } from './locales'

/**
 * Catalog access and locale detection for `src/app/global-error.tsx`.
 *
 * Global error replaces the root layout, so it renders outside
 * `NextIntlClientProvider` and cannot call `useTranslations`.
 */

/**
 * Set on global error's own `<html>`: `server` when it was rendered without a
 * browser (prerendered or server-rendered, so its `lang` is just the default),
 * `client` once it has rendered in the browser with a detected locale.
 */
const GLOBAL_ERROR_ROOT_ATTRIBUTE = 'data-global-error'

/**
 * The catalog strings global error renders, copied from `messages/{en,et}.json`
 * at the same key paths: `errors.global`, plus the route boundaries'
 * `errors.boundary` copy.
 *
 * Copied, not imported: global error is in the client bundle of every page, and
 * Turbopack does not tree-shake JSON, so importing both catalogs here added
 * ~30 KB gzip to every page load for five strings (HON-919). The catalogs stay
 * the source of truth. `global-error-messages.test.ts` fails when a copy here
 * differs from its catalog key, so edit the catalog, then this.
 */
export const GLOBAL_ERROR_MESSAGES = {
  en: {
    errors: {
      global: {
        title: 'Something went wrong!',
        body: 'An unexpected error occurred. We apologize for the inconvenience.',
      },
      boundary: {
        tryAgain: 'Try again',
        errorIdLabel: 'Error ID:',
        supportPrompt: 'Need help? Email <link>{email}</link>.',
      },
    },
  },
  et: {
    errors: {
      global: {
        title: 'Midagi läks valesti!',
        body: 'Tekkis ootamatu viga. Vabandame ebamugavuste pärast.',
      },
      boundary: {
        tryAgain: 'Proovi uuesti',
        errorIdLabel: 'Vea ID:',
        supportPrompt: 'Vajad abi? Kirjuta <link>{email}</link>.',
      },
    },
  },
} satisfies Record<Locale, Messages>

export function globalErrorTranslator(locale: Locale) {
  return createTranslator({ locale, messages: GLOBAL_ERROR_MESSAGES[locale], namespace: 'errors' })
}

/**
 * The locale to render global error in, in the browser.
 *
 * 1. The document's `<html lang>`, unless global error rendered that `<html>`
 *    without a browser. On a client-side error the root layout's `<html>` is
 *    still in the DOM while global error first renders, and its `lang` is the
 *    household / Accept-Language locale the server resolved. After global
 *    error commits, its own `<html lang>` holds the locale detected here, so
 *    re-reading it returns the same answer.
 * 2. `navigator.languages`, matched like an Accept-Language header. This
 *    covers a prerendered or server-rendered global error, whose `lang` is
 *    only the default it was rendered with.
 * 3. `DEFAULT_LOCALE`.
 *
 * The app sets no locale cookie, so there is none to read.
 */
export function detectClientLocale(): Locale {
  const root = document.documentElement
  if (root.getAttribute(GLOBAL_ERROR_ROOT_ATTRIBUTE) !== 'server' && isKnownLocale(root.lang)) {
    return root.lang
  }
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language]
  return matchAcceptLanguage(languages.join(',')) ?? DEFAULT_LOCALE
}
