/**
 * The `/account` tabs, in order (HON-1229; Reminders, HON-1256). Each is a
 * route, so the verification link, the reminder emails' pages, docs/API.md
 * and support replies can name one part. Shared by the tab list (a client
 * component) and each page's metadata.
 */
export const ACCOUNT_TABS = [
  { key: 'profile', href: '/account' },
  { key: 'reminders', href: '/account/reminders' },
  { key: 'connections', href: '/account/connections' },
  { key: 'data', href: '/account/data' },
] as const

export type AccountTab = (typeof ACCOUNT_TABS)[number]['key']
