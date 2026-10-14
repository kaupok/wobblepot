/**
 * The `/account` tabs, in order (HON-1229). Each is a route, so the
 * verification link, docs/API.md and support replies can name one part.
 * Shared by the tab list (a client component) and each page's metadata.
 */
export const ACCOUNT_TABS = [
  { key: 'profile', href: '/account' },
  { key: 'connections', href: '/account/connections' },
  { key: 'data', href: '/account/data' },
] as const

export type AccountTab = (typeof ACCOUNT_TABS)[number]['key']
