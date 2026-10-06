import 'server-only'

/**
 * The admin pages the account menus link to, desktop and mobile alike
 * (HON-1092). Each `labelKey` is a key under `nav.admin` in both catalogs.
 *
 * Server-only on purpose, like the `nav.admin` labels, which the root layout
 * keeps out of the client catalog: an `/admin` href or label in a non-admin
 * page's HTML or bundle names the hidden admin route (HON-830). `Header`
 * resolves these to `AdminMenuLink`s only for the admin session.
 */
export const ADMIN_LINKS = [{ href: '/admin/signup-codes', labelKey: 'signupCodes' }] as const

/** An admin link with its label resolved, as the client menus receive it. */
export interface AdminMenuLink {
  href: string
  label: string
}
