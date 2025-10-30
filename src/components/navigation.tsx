import Link from 'next/link'
import type { Session } from '@/lib/auth'

interface NavigationProps {
  session: Session | null
}

export function Navigation({ session }: NavigationProps) {
  return (
    <nav className="hidden md:flex items-center gap-6">
      <Link
        href="/"
        className="text-sm font-medium transition-colors hover:text-primary"
      >
        Home
      </Link>
      <Link
        href="/about"
        className="text-sm font-medium transition-colors hover:text-primary"
      >
        About
      </Link>
      {session && (
        <Link
          href="/profile"
          className="text-sm font-medium transition-colors hover:text-primary"
        >
          Profile
        </Link>
      )}
    </nav>
  )
}
