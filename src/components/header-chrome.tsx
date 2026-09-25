import Link from 'next/link'
import { Heading } from '@/components/ui/typography'
import type { Session } from '@/lib/auth'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'

interface HeaderChromeProps {
  session: Session | null
  hasHousehold: boolean
  /** The skip link's label, resolved by the caller so this stays hook-free. */
  skipToContentLabel: string
}

/**
 * The header as it renders, with the session already resolved. `Header` is
 * the server half that resolves it; this half is what the Storybook story
 * mounts, so the markup exists once rather than as a mirror kept in step by
 * hand.
 *
 * The header floats: the fixed bar itself is transparent and lets clicks
 * through, and the chrome sits in pills on it — the logo with the daily views
 * in one, the settings views with the account menu in the other, the page
 * showing through the gap between them (docs/DESIGN.md → Composition rules,
 * "The header floats"). On a phone the two collapse into one pill across the
 * column, so the logo and the account entry keep their corners.
 *
 * Geometry: `pt-4` offset plus the `h-12` pill is the same 4rem the old
 * full-width bar took, so `main`'s top padding and the
 * `*-below-header` utilities in `globals.css` are unchanged.
 */
export function HeaderChrome({ session, hasHousehold, skipToContentLabel }: HeaderChromeProps) {
  return (
    <header className="pointer-events-none fixed top-0 right-0 left-0 z-50 pt-[env(safe-area-inset-top,0px)]">
      <a
        href="#main-content"
        className="focus:bg-background focus:text-foreground pointer-events-auto sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:ring-2 focus:ring-offset-2"
      >
        {skipToContentLabel}
      </a>
      <div className="max-w-page mx-auto flex w-full justify-between px-4 pt-4">
        {/* One pill on a phone; from `md` it dissolves (`contents`) and the
            two groups inside become pills of their own. Each pill is opaque
            and bordered, not shadowed: only overlays cast a shadow
            (DESIGN.md → Elevation), and the border is the edge. */}
        <div className="bg-background pointer-events-auto flex h-12 w-full items-center justify-between rounded-full border pr-1 pl-4 md:contents">
          <div className="md:bg-background flex items-center gap-6 md:h-12 md:rounded-full md:border md:px-5">
            <Link href="/" className="transition-opacity hover:opacity-70">
              <Heading variant="h4">Wobblepot</Heading>
            </Link>
            <NavigationLeft isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
          </div>
          <div className="md:bg-background flex items-center gap-6 md:h-12 md:rounded-full md:border md:pr-2 md:pl-5">
            <NavigationRight isAuthenticated={Boolean(session)} hasHousehold={hasHousehold} />
            <HeaderActions session={session} hasHousehold={hasHousehold} />
            <MobileNav session={session} hasHousehold={hasHousehold} />
          </div>
        </div>
      </div>
    </header>
  )
}
