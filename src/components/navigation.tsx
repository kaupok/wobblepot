'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { BookOpen, Users, type LucideIcon } from 'lucide-react'
import { isNavItemActive } from '@/lib/navigation'
import { cn } from '@/lib/utils'

interface NavigationProps {
  isAuthenticated: boolean
  hasHousehold: boolean
}

/**
 * A header link that marks the current page by colour alone — foreground
 * against the muted rest — with `aria-current` carrying the signal to
 * assistive tech. No underline: inside the header's pill it read as a second
 * edge under the curve. Active-route matching is shared with `BottomTabBar`.
 *
 * The link is the pill's full height, so the hover zone is the whole band
 * rather than the line of text. The space between links is the links' own
 * padding, not a flex gap, so neighbours share an edge: a pointer sweeping
 * across the group is always over exactly one link, and a folded label never
 * closes in a gap only to reopen on the next link (HON-922). The pill's own
 * padding is cut by the same amount, so the outer inset is unchanged.
 *
 * With an `icon`, the link folds with the header (`HeaderChrome` sets
 * `data-scrolled` on its `group`): scrolled, the icon opens in as the label's
 * box narrows to nothing. Below `lg` it is folded at rest too: at 768px the
 * two pills with every label open no longer fit side by side once the first
 * link reads "Meal plan" (HON-924), and a tablet in portrait has no hover to
 * lose. Hovering a link, or focusing it from the keyboard, opens its own
 * label beside its icon (`group/link`), one at a time rather than the whole
 * group. The label is clipped, never `invisible` or `hidden`, so it stays the
 * link's accessible name while folded. Without hover (a tablet) the labels
 * stay folded until focus.
 */
function NavLink({
  href,
  alsoActiveOn = [],
  icon: Icon,
  children,
}: {
  href: string
  /** Other destinations that render this same page at desktop width. */
  alsoActiveOn?: string[]
  /** Shown in place of the label while the header is scrolled. */
  icon?: LucideIcon
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isActive = [href, ...alsoActiveOn].some((path) => isNavItemActive(path, pathname))

  return (
    <Link
      href={href}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'group/link flex h-14 items-center text-base font-medium transition-colors',
        // 12px a side keeps labels 24px apart. A folding link is 10px a side,
        // so folded it is the account button's 40px box (`size-10`) and the
        // three icons sit evenly; the label carries the other 2px at rest.
        Icon ? 'px-2.5' : 'px-3',
        isActive ? 'text-foreground' : 'text-muted-foreground hover:text-primary',
      )}
    >
      {Icon ? (
        <>
          {/* Folded when scrolled, and below `lg` at rest: the same classes
              under `max-lg:` as under `group-data-scrolled:`. */}
          <span className="max-w-0 overflow-hidden opacity-0 transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:max-w-5 group-data-scrolled:opacity-100 motion-reduce:transition-none max-lg:max-w-5 max-lg:opacity-100">
            <Icon className="size-5" />
          </span>
          <span className="max-w-40 overflow-hidden whitespace-nowrap transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:not-group-hover/link:not-group-focus-visible/link:max-w-0 group-data-scrolled:not-group-hover/link:not-group-focus-visible/link:opacity-0 motion-reduce:transition-none max-lg:not-group-hover/link:not-group-focus-visible/link:max-w-0 max-lg:not-group-hover/link:not-group-focus-visible/link:opacity-0">
            {/* The gap lives inside the clipped box, so it closes with the
                label instead of leaving 8px beside a lone icon. At rest the
                2px a side tops the link's 10px up to the 12px the left
                group's links have. */}
            <span className="px-0.5 group-data-scrolled:pr-0 group-data-scrolled:pl-2 max-lg:pr-0 max-lg:pl-2">
              {children}
            </span>
          </span>
        </>
      ) : (
        children
      )}
    </Link>
  )
}

/**
 * Left navigation - daily operational views
 * (Meal plan, Pantry & shopping)
 */
export function NavigationLeft({ isAuthenticated, hasHousehold }: NavigationProps) {
  const t = useTranslations('nav.primary')

  if (!isAuthenticated || !hasHousehold) return null

  return (
    <nav aria-label={t('ariaLabel')} className="hidden items-center md:flex">
      {/* `/past-meals` is the plan's history, reached from the account menu. */}
      <NavLink href="/" alsoActiveOn={['/past-meals']}>
        {t('mealPlan')}
      </NavLink>
      {/* From `md` up `/pantry` is the same two-column page as `/shopping`;
          they only differ on a phone, where each is its own tab (HON-776). */}
      <NavLink href="/shopping" alsoActiveOn={['/pantry']}>
        {t('pantryAndShopping')}
      </NavLink>
    </nav>
  )
}

/**
 * Right navigation - settings/configuration views
 * (My recipes, Household). Folds to icons once the page scrolls, and at rest
 * below `lg`.
 */
export function NavigationRight({ isAuthenticated, hasHousehold }: NavigationProps) {
  const t = useTranslations('nav.settings')

  if (!isAuthenticated || !hasHousehold) return null

  return (
    <nav aria-label={t('ariaLabel')} className="hidden items-center md:flex">
      {/* Recipes shares the tab bar's icon; Household is people, not the
          house the phone's Plan tab already uses. */}
      <NavLink href="/recipes" icon={BookOpen}>
        {t('myRecipes')}
      </NavLink>
      <NavLink href="/household" icon={Users}>
        {t('household')}
      </NavLink>
    </nav>
  )
}
