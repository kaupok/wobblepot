import Link from 'next/link'
import type { Session } from '@/lib/auth'

interface NavigationProps {
  session: Session | null
}

export function Navigation({ session }: NavigationProps) {
  return (
    <nav className="hidden items-center gap-6 md:flex">
      <Link href="/" className="hover:text-primary text-sm font-medium transition-colors">
        Home
      </Link>
      <Link href="/about" className="hover:text-primary text-sm font-medium transition-colors">
        About
      </Link>
      {session && (
        <>
          <Link
            href="/profile"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Profile
          </Link>
          <Link
            href="/settings/household"
            className="hover:text-primary text-sm font-medium transition-colors"
          >
            Settings
          </Link>
        </>
      )}
    </nav>
  )
}
