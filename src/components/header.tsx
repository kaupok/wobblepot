import { getTranslations } from 'next-intl/server'
import { getSession, getCachedMembership } from '@/lib/session'
import { isAdminIfConfigured } from '@/lib/auth-helpers'
import { countPastMealsToMark } from '@/lib/meal-planning/past-meals'
import { HeaderChrome } from './header-chrome'

/**
 * Resolves the session and hands it to `HeaderChrome`, which owns the markup.
 * Split this way because `getSession()` and `getCachedMembership()` import
 * Prisma transitively, so the chrome could not otherwise be mounted in
 * Storybook.
 *
 * It also counts the past meals still to mark, for the account menu's dot
 * (HON-1028). It lives in the layout, so the `router.refresh()` after a status
 * change re-runs the count and the dot clears without a client query.
 *
 * Admin status is resolved here too, so only a boolean reaches the client and
 * neither `ADMIN_EMAIL` nor the comparison does (HON-1092).
 */
export async function Header() {
  const session = await getSession()
  const membership = session ? await getCachedMembership(session.user.id) : null
  const hasHousehold = membership !== null
  const isAdmin = isAdminIfConfigured(session)
  const [pastMealsToMark, t] = await Promise.all([
    membership
      ? countPastMealsToMark({
          id: membership.householdId,
          timezone: membership.household.timezone,
        })
      : 0,
    getTranslations('nav'),
  ])

  return (
    <HeaderChrome
      session={session}
      hasHousehold={hasHousehold}
      isAdmin={isAdmin}
      pastMealsToMark={pastMealsToMark}
      skipToContentLabel={t('skipToContent')}
    />
  )
}
