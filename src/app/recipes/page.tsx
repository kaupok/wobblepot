import { dehydrate, HydrationBoundary } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { auth } from '@/lib/auth'
import { getQueryClient } from '@/lib/get-query-client'
import { getHouseholdMembership } from '@/lib/household'
import { listHouseholdMeals } from '@/lib/household-meals-read'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { getTodayInTimezone } from '@/lib/meal-planning/dates'
import { sumPortions } from '@/lib/meal-planning/servings'

import {
  getNextMealsPageParam,
  mealsInitialPageParam,
  type MealsPage,
  mealsQueryKey,
} from './meals-query'
import { RecipesPageClient } from './RecipesPageClient'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('recipes')
  return { title: t('metaTitle') }
}

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
        locale: resolveHouseholdLocale(membership.household),
        today: getTodayInTimezone(membership.household.timezone),
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
      <RecipesPageClient householdServings={sumPortions(membership.household.members)} />
    </HydrationBoundary>
  )
}
