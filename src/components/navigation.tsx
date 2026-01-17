import Link from 'next/link'
import type { Session } from '@/lib/auth'

interface NavigationProps {
  session: Session | null
}

export function Navigation({ session }: NavigationProps) {
  return (
    <nav className="hidden items-center gap-6 md:flex">
      {session && (
        <Link href="/" className="hover:text-primary text-sm font-medium transition-colors">
          Today
        </Link>
      )}
      <Link href="/dashboard" className="hover:text-primary text-sm font-medium transition-colors">
        Meals
      </Link>
      {session && (
        <>
          <Link
            href="/shopping"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Pantry & shopping
          </Link>
          <Link
            href="/household/household"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Household
          </Link>
        </>
      )}
    </nav>
  )
}
