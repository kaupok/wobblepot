import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { listHouseholdMeals } from '@/lib/household-meals'
import { getQueryClient } from '@/lib/get-query-client'
import { RecipesPageClient } from './RecipesPageClient'
import {
  getNextMealsPageParam,
  mealsInitialPageParam,
  mealsQueryKey,
  type MealsPage,
} from './meals-query'

export default async function RecipesPage() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    redirect('/sign-in')
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    redirect('/')
  }

  // Prefetch the first page so the list is in the first HTML response instead
  // of behind a second client round trip (HON-770). A failed prefetch is not
  // dehydrated, so the client falls back to fetching the list itself; no
  // retries here, since the default two would hold the render for seconds.
  const queryClient = getQueryClient()
  await queryClient.prefetchInfiniteQuery({
    queryKey: mealsQueryKey(undefined),
    retry: false,
    initialPageParam: mealsInitialPageParam,
    queryFn: async () => {
      const page = await listHouseholdMeals({
        householdId: membership.household.id,
        locale: membership.household.locale,
      })
      // Round-trip through JSON so the cached page has the wire shape the
      // client's `apiFetch` produces (dates as ISO strings, not `Date`).
      return JSON.parse(JSON.stringify(page)) as MealsPage
    },
    getNextPageParam: getNextMealsPageParam,
    pages: 1,
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <RecipesPageClient />
    </HydrationBoundary>
  )
}
