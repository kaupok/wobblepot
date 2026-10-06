/**
 * The admin pages the account menus link to, desktop and mobile alike
 * (HON-1092). Each `labelKey` is a key under `nav.actions` in both catalogs.
 *
 * No secrets and no `serverEnv` here, so the client menus can import it. The
 * menus render these only when the server half resolved the session as admin
 * (`isAdminIfConfigured`); the routes keep their own gate either way.
 */
export const ADMIN_LINKS = [{ href: '/admin/signup-codes', labelKey: 'adminSignupCodes' }] as const

export type AdminLink = (typeof ADMIN_LINKS)[number]
