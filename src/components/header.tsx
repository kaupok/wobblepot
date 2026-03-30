import Link from 'next/link'
import { Heading } from '@/components/ui/typography'
import { getSession, getHasHousehold } from '@/lib/session'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'

export async function Header() {
  const session = await getSession()
  const hasHousehold = session ? await getHasHousehold(session.user.id) : false

  return (
    <header className="bg-background fixed top-0 right-0 left-0 z-50 border-b pt-[env(safe-area-inset-top,0px)]">
      <a
        href="#main-content"
        className="focus:bg-background focus:text-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:ring-2 focus:ring-offset-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 w-full max-w-[1152px] items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="transition-opacity hover:opacity-70">
            <Heading variant="h4">Honkadori</Heading>
          </Link>
          <NavigationLeft session={session} hasHousehold={hasHousehold} />
        </div>
        <div className="flex items-center gap-8">
          <NavigationRight session={session} hasHousehold={hasHousehold} />
          <HeaderActions session={session} hasHousehold={hasHousehold} />
          <MobileNav session={session} hasHousehold={hasHousehold} />
        </div>
      </div>
    </header>
  )
}
