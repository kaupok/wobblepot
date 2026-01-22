import Link from 'next/link'
import { headers } from 'next/headers'
import { Heading } from '@/components/ui/typography'
import { auth } from '@/lib/auth'
import { HeaderActions } from './header-actions'
import { NavigationLeft, NavigationRight } from './navigation'
import { MobileNav } from './mobile-nav'

export async function Header() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  return (
    <header className="bg-background fixed top-0 right-0 left-0 z-50 border-b">
      <a
        href="#main-content"
        className="focus:bg-background focus:text-foreground sr-only focus:not-sr-only focus:absolute focus:z-50 focus:px-4 focus:py-2 focus:ring-2 focus:ring-offset-2"
      >
        Skip to content
      </a>
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <div className="flex items-center gap-8">
          <Link href="/" className="transition-opacity hover:opacity-70">
            <Heading variant="h4">Honkadori</Heading>
          </Link>
          <NavigationLeft session={session} />
        </div>
        <div className="flex items-center gap-8">
          <NavigationRight session={session} />
          <HeaderActions session={session} />
          <MobileNav session={session} />
        </div>
      </div>
    </header>
  )
}
