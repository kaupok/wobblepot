import Link from 'next/link'
import type { Session } from '@/lib/auth'

interface NavigationProps {
  session: Session | null
}

export function Navigation({ session }: NavigationProps) {
  return (
    <nav className="hidden items-center gap-6 md:flex">
      <Link href="/" className="hover:text-primary text-sm font-medium transition-colors">
        Plan
      </Link>
      {session && (
        <>
          <Link
            href="/shopping"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Shopping
          </Link>
          <Link
            href="/household/household"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Household
          </Link>
          <Link
            href="/profile"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Profile
          </Link>
        </>
      )}
    </nav>
  )
}
