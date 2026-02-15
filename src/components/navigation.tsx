import Link from 'next/link'
import type { Session } from '@/lib/auth'

interface NavigationProps {
  session: Session | null
  hasHousehold: boolean
}

/**
 * Left navigation - daily operational views
 * (Today, Meal plan, Pantry & shopping)
 */
export function NavigationLeft({ session, hasHousehold }: NavigationProps) {
  if (!session || !hasHousehold) return null

  return (
    <nav className="hidden items-center gap-6 md:flex">
      <Link href="/" className="hover:text-primary text-sm font-medium transition-colors">
        Today
      </Link>
      <Link href="/meal-plan" className="hover:text-primary text-sm font-medium transition-colors">
        Meal plan
      </Link>
      <Link href="/shopping" className="hover:text-primary text-sm font-medium transition-colors">
        Pantry & shopping
      </Link>
    </nav>
  )
}

/**
 * Right navigation - settings/configuration views
 * (My recipes, Household)
 */
export function NavigationRight({ session, hasHousehold }: NavigationProps) {
  if (!session || !hasHousehold) return null

  return (
    <nav className="hidden items-center gap-6 md:flex">
      <Link href="/recipes" className="hover:text-primary text-sm font-medium transition-colors">
        My recipes
      </Link>
      <Link href="/household" className="hover:text-primary text-sm font-medium transition-colors">
        Household
      </Link>
    </nav>
  )
}
