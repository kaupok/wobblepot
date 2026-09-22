/**
 * Whether a primary-nav destination is the current page. Shared by the desktop
 * header (`navigation.tsx`) and the mobile `BottomTabBar` so the two always
 * agree on which item is active.
 *
 * `/` matches only itself; every other destination also matches its sub-routes
 * (`/recipes/imagine` → `/recipes`), on a segment boundary so `/recipes-old`
 * would not. A `null` pathname (outside the app router) matches nothing.
 */
export function isNavItemActive(href: string, pathname: string | null): boolean {
  if (!pathname) return false
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
