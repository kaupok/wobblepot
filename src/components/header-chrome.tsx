'use client'

import Link from 'next/link'
import { useScrolled } from '@/hooks/use-scrolled'
import type { Session } from '@/lib/auth'
import type { AdminMenuLink } from '@/lib/admin-links'
import { cn } from '@/lib/utils'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'
import { LogoMark, Wordmark } from './wordmark'

interface HeaderChromeProps {
  session: Session | null
  hasHousehold: boolean
  /**
   * The admin pages, labels resolved, for the beta admin only; empty for
   * everyone else. Non-empty adds them to both account menus (HON-1092).
   */
  adminLinks: AdminMenuLink[]
  /**
   * Past meals still to mark (`countPastMealsToMark`). Above 0, the account
   * icon and its "Past meals" row show a red dot (HON-1028).
   */
  pastMealsToMark: number
  /** The skip link's label, resolved by the server half. */
  skipToContentLabel: string
}

/**
 * The header as it renders, with the session already resolved. `Header` is
 * the server half that resolves it; this half is what the Storybook story
 * mounts, so the markup exists once rather than as a mirror kept in step by
 * hand.
 *
 * The header floats: the fixed bar itself is transparent and lets clicks
 * through, and the chrome sits in pills on it, 16px in from the viewport's
 * edges — the logo with the daily views in one, the settings views with the
 * account menu in the other, the page showing through the gap between them
 * (docs/DESIGN.md → Composition rules, "The header floats"). On a phone the
 * two collapse into one pill across the column, so the logo and the account
 * entry keep their corners.
 *
 * Scrolling folds the logo away (`useScrolled`): its box narrows to nothing
 * as it fades, so the daily views slide left and the pill closes around them;
 * on a phone the whole pill draws in to a disc around the account icon. It
 * unfolds the same way once the page is back at the top. From `md` the right
 * pill folds with it: the settings views close to icons, and hovering one
 * opens its label again (`NavigationRight`). Signed out, the two pills are
 * apart at every width, the menu's a 56px disc on a phone, and scrolling
 * folds the logo pill to the same disc around the wordmark's `w`; the right
 * pill stays as it is. During onboarding the logo-only pill fades out rather
 * than surviving as an empty ring. The transitions name their
 * properties and run at 300ms on the house curve; a reduced-motion preference
 * snaps them.
 *
 * Geometry: `pt-4` offset plus the `h-14` pill is a 4.5rem band. `main`'s
 * top padding (`src/app/layout.tsx`) and the `*-below-header` utilities in
 * `globals.css` hold a copy of that height: change them with it.
 */
export function HeaderChrome({
  session,
  hasHousehold,
  adminLinks,
  pastMealsToMark,
  skipToContentLabel,
}: HeaderChromeProps) {
  const scrolled = useScrolled()
  // The same test the nav groups apply. When it fails the left pill holds
  // only the logo, so the fold has to take the pill with it.
  const showsNav = Boolean(session) && hasHousehold
  // Signed out, the phone gets the two pills too, and the logo folds to its
  // own disc rather than into the menu's: there is no account to keep in
  // reach, so the menu pill never changes.
  const signedOut = !session
  // A group drawn as a pill of its own: always signed out, from `md` signed in.
  const pill = signedOut
    ? 'bg-background shadow-float pointer-events-auto h-14 rounded-full border'
    : 'md:bg-background md:shadow-float md:h-14 md:rounded-full md:border'

  return (
    <header
      data-scrolled={scrolled || undefined}
      className="group pointer-events-none fixed top-0 right-0 left-0 z-50 pt-[env(safe-area-inset-top,0px)]"
    >
      <a
        href="#main-content"
        className="focus:bg-background focus:text-foreground pointer-events-auto sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:ring-2 focus:ring-offset-2"
      >
        {skipToContentLabel}
      </a>
      <div className="flex w-full justify-between px-4 pt-4">
        {/* One pill on a phone; from `md` it dissolves (`contents`) and the
            two groups inside become pills of their own. Each pill is opaque
            and bordered, with the faint `shadow-float` lift that DESIGN.md →
            Elevation allows floating chrome and nothing else in the page.
            Scrolled, the phone pill draws in from the left to the 56px disc
            around the account icon: `max-w-full` → `max-w-14`, its left
            padding closing to match the right. Signed out there is no phone
            pill: it is `contents` at every width, so the groups are the two
            pills from the start. */}
        <div
          className={cn(
            signedOut
              ? 'contents'
              : 'bg-background shadow-float pointer-events-auto ml-auto flex h-14 w-full max-w-full items-center justify-between rounded-full border pr-1.25 pl-5 transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:max-w-14 group-data-scrolled:pl-1.25 motion-reduce:transition-none md:contents',
          )}
        >
          <div
            className={cn(
              'flex items-center',
              pill,
              signedOut ? 'px-4' : 'md:px-4',
              // Signed out, the pill closes to the disc: the 44px mark with
              // 5px of padding inside the border, as the account disc has.
              signedOut &&
                'transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:px-1.25 motion-reduce:transition-none',
              !showsNav &&
                !signedOut &&
                'transition-opacity duration-300 ease-out group-data-scrolled:pointer-events-none group-data-scrolled:opacity-0 motion-reduce:transition-none',
            )}
          >
            {/* The fold. `max-w-32` clears the wordmark at rest; scrolled, the
                box narrows to nothing behind `overflow-hidden` while the text
                fades, and its margin closes with it so the nav meets the
                pill's padding. The pill's padding is 16px, and the nav links
                carry 12px of their own (`NavLink`); the logo's 12px margin is
                the same top-up, putting it 28px in from the edge and 24px
                from Meal plan. `invisible` at the end takes the hidden
                link out of the tab order; visibility only flips once the
                transition ends, so it is not seen. The link's own focus
                outline is inset for the same clipping reason. */}
            {signedOut ? (
              // Signed out the link stays: the wordmark folds as above but
              // stays in the accessibility tree, so it still names the link,
              // and the `w` opens beside it to fill the 44px disc.
              <Link
                href="/"
                className="focus-visible:outline-ring flex items-center rounded-full transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <span className="mx-3 max-w-32 overflow-hidden transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:mx-0 group-data-scrolled:max-w-0 group-data-scrolled:opacity-0 motion-reduce:transition-none">
                  <Wordmark className="block" />
                </span>
                <span className="flex size-11 max-w-0 shrink-0 items-center justify-center overflow-hidden opacity-0 transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:max-w-11 group-data-scrolled:opacity-100 motion-reduce:transition-none">
                  <LogoMark className="shrink-0" />
                </span>
              </Link>
            ) : (
              <div className="max-w-32 overflow-hidden transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:invisible group-data-scrolled:mx-0 group-data-scrolled:max-w-0 group-data-scrolled:opacity-0 motion-reduce:transition-none md:mx-3">
                <Link
                  href="/"
                  className="focus-visible:outline-ring block rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:-outline-offset-2"
                >
                  {/* An image, not a heading: the wordmark is a link home, not a
                      section of the page, and a heading here would open every
                      page's outline ahead of its own `h1` (HON-806). Its
                      `aria-label` is the link's accessible name. `block` drops
                      the inline baseline gap under the SVG. */}
                  <Wordmark className="block" />
                </Link>
              </div>
            )}
            <NavigationLeft isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
          </div>
          {/* No gap: the last nav link meets the account button. With the
              nav present, the pill's 16px plus the first link's own 12px
              (`NavLink`) put its label 28px in. Without it (signed out,
              onboarding) the first control is a button whose box carries its
              own padding, so the pill's 8px meets that box, the same as the
              right end meets the last disc. */}
          <div
            className={cn(
              'flex items-center md:pr-2',
              pill,
              // Folded to icons (scrolled, and below `lg` at rest, as in
              // `NavLink`), the first link is an icon box like the account
              // disc, so the left padding drops to the right's 8px.
              showsNav
                ? 'transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out motion-reduce:transition-none md:pl-4 md:group-data-scrolled:pl-2 md:max-lg:pl-2'
                : 'md:pl-2',
              // Signed out on a phone, the menu's pill is a disc: the 44px
              // trigger with 5px inside the border, as the account disc has.
              signedOut && 'max-md:p-1.25',
            )}
          >
            <NavigationRight isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
            <HeaderActions
              session={session}
              hasHousehold={hasHousehold}
              adminLinks={adminLinks}
              pastMealsToMark={pastMealsToMark}
            />
            <MobileNav
              session={session}
              hasHousehold={hasHousehold}
              adminLinks={adminLinks}
              pastMealsToMark={pastMealsToMark}
            />
          </div>
        </div>
      </div>
    </header>
  )
}
