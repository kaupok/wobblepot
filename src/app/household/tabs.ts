/**
 * The `/household` tabs, in order (HON-1257). Each is a route, so a link or a
 * support reply can name one part, as on `/account`. Shared by the tab list
 * (a client component) and each page's metadata.
 */
export const HOUSEHOLD_TABS = [
  { key: 'members', href: '/household' },
  { key: 'mealPreferences', href: '/household/meal-preferences' },
  { key: 'ingredients', href: '/household/ingredients' },
  { key: 'settings', href: '/household/settings' },
] as const

export type HouseholdTab = (typeof HOUSEHOLD_TABS)[number]['key']
