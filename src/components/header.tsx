import Link from 'next/link'
import { headers } from 'next/headers'
import { Heading } from '@/components/ui/typography'
import { auth } from '@/lib/auth'
import { HeaderActions } from './header-actions'
import { Navigation } from './navigation'
import { MobileNav } from './mobile-nav'

export async function Header() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  return (
    <header className="bg-background fixed top-0 right-0 left-0 z-50 border-b">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="transition-opacity hover:opacity-70">
          <Heading variant="h4">Honkadori</Heading>
        </Link>
        <div className="flex items-center gap-6">
          <Navigation session={session} />
          <div className="flex items-center gap-4">
            <MobileNav session={session} />
            <HeaderActions session={session} />
          </div>
        </div>
      </div>
    </header>
  )
}
