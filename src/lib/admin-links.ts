import 'server-only'

/**
 * The admin pages the account menus link to, desktop and mobile alike
 * (HON-1092). The labels are inline English: the admin pages are an
 * English-only operator console and stay out of the catalogs (HON-1093,
 * `scripts/check-admin-untranslated.ts`).
 *
 * Server-only on purpose: an `/admin` href or label in a non-admin page's HTML
 * or bundle names the hidden admin route (HON-830). `Header` passes these to
 * the client menus only for the admin session.
 */
export const ADMIN_LINKS: readonly AdminMenuLink[] = [
  { href: '/admin/signup-codes', label: 'Signup codes' },
  { href: '/admin/waitlist', label: 'Waitlist' },
]

/** An admin link, as the client menus receive it. */
export interface AdminMenuLink {
  href: string
  label: string
}
