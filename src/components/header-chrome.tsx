'use client'

import Link from 'next/link'
import { Heading } from '@/components/ui/typography'
import { useScrolled } from '@/hooks/use-scrolled'
import type { Session } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'

interface HeaderChromeProps {
  session: Session | null
  hasHousehold: boolean
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
 * unfolds the same way once the page is back at the top. A pill that holds
 * only the logo (signed out, onboarding) fades out instead of surviving as an
 * empty ring. The transitions name their properties and run at 300ms on the
 * house curve; a reduced-motion preference snaps them.
 *
 * Geometry: `pt-4` offset plus the `h-12` pill is the same 4rem the old
 * full-width bar took, so `main`'s top padding and the
 * `*-below-header` utilities in `globals.css` are unchanged.
 */
export function HeaderChrome({ session, hasHousehold, skipToContentLabel }: HeaderChromeProps) {
  const scrolled = useScrolled()
  // The same test the nav groups apply. When it fails the left pill holds
  // only the logo, so the fold has to take the pill with it.
  const showsNav = Boolean(session) && hasHousehold

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
            Scrolled, the phone pill draws in from the left to the 48px disc
            the account icon needs: `max-w-full` → `max-w-12`, its left
            padding closing to match the right. */}
        <div className="bg-background shadow-float pointer-events-auto ml-auto flex h-12 w-full max-w-full items-center justify-between rounded-full border pr-0.5 pl-4 transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:max-w-12 group-data-scrolled:pl-0.5 motion-reduce:transition-none md:contents">
          <div
            className={cn(
              'md:bg-background md:shadow-float flex items-center gap-6 md:h-12 md:rounded-full md:border md:px-5',
              !showsNav &&
                'transition-opacity duration-300 ease-out group-data-scrolled:pointer-events-none group-data-scrolled:opacity-0 motion-reduce:transition-none',
            )}
          >
            {/* The fold. `max-w-32` clears the wordmark at rest; scrolled, the
                box narrows to nothing behind `overflow-hidden` while the text
                fades, and the negative margin eats the pill's gap so the nav
                closes up against the padding. `invisible` at the end takes the
                hidden link out of the tab order; visibility only flips once
                the transition ends, so it is not seen. The link's own focus
                outline is inset for the same clipping reason. */}
            <div className="max-w-32 overflow-hidden transition-[max-width,padding,margin,opacity,visibility] duration-300 ease-out group-data-scrolled:invisible group-data-scrolled:-mr-6 group-data-scrolled:max-w-0 group-data-scrolled:opacity-0 motion-reduce:transition-none">
              <Link
                href="/"
                className="focus-visible:outline-ring block rounded-sm transition-opacity hover:opacity-70 focus-visible:outline-2 focus-visible:-outline-offset-2"
              >
                <Heading variant="h4">Wobblepot</Heading>
              </Link>
            </div>
            <NavigationLeft isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
          </div>
          <div className="md:bg-background md:shadow-float flex items-center gap-6 md:h-12 md:rounded-full md:border md:pr-1 md:pl-5">
            <NavigationRight isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
            <HeaderActions session={session} hasHousehold={hasHousehold} />
            <MobileNav session={session} hasHousehold={hasHousehold} />
          </div>
        </div>
      </div>
    </header>
  )
}
