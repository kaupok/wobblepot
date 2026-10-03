import { redirect } from 'next/navigation'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getServerFlag } from '@/lib/feature-flags'
import { getHouseholdMembership } from '@/lib/household'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { getTodayInTimezone, getUrgencyBucket, parseLocalDate } from '@/lib/meal-planning/dates'
import { getLocale } from '@/lib/i18n/get-locale'
import { DEMO_TIMEZONE, loadDemoDay } from '@/lib/landing/load-demo-day'
import { LandingPage } from './LandingPage'
import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import type { ComponentProps } from 'react'
import type { ExpectedMealTypes } from '@/components/meal-plan/types'

type TimelineShoppingItem = ComponentProps<typeof TimelineView>['shoppingItems'][number]

export default async function Home() {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  // Landing page for unauthenticated users
  if (!session) {
    const [inviteRequired, locale] = await Promise.all([
      getServerFlag('invite_code_required', 'anonymous'),
      getLocale(),
    ])
    const demo = await loadDemoDay({ locale, date: getTodayInTimezone(DEMO_TIMEZONE) })
    // Awaited here rather than rendered as `<LandingPage />`: it is an async
    // Server Component, and `page.test.tsx` renders `await Home()` in a client
    // renderer, which cannot resolve a nested async component.
    return await LandingPage({ inviteRequired, locale, demo })
  }

  // Check household membership
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    redirect('/onboarding')
  }

  const { household } = membership

  // Get today's date in household timezone
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)

  // Compute date range: -7 to +14 from today. Today renders no past day; the
  // past 7 feed only the count on its past-meals notice (HON-1007).
  const sevenDaysAgo = new Date(todayParsed)
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
  const fourteenDaysAhead = new Date(todayParsed)
  fourteenDaysAhead.setDate(fourteenDaysAhead.getDate() + 15) // +15 because endDate is exclusive

  // Rode along on the membership query's `_count` — no round-trip of its own.
  const householdSize = household._count.members

  // Read straight from the loaders the API routes wrap, not over HTTP into our
  // own deployment (HON-789). A loader that throws is not caught here: it
  // reaches `src/app/error.tsx` rather than rendering Today as if the plan,
  // pantry or shopping list were empty, and a failed entries load can never be
  // mistaken for a first-time household.
  const [{ entries, planId }, pantry, shoppingList] = await Promise.all([
    loadPlanEntries(household, { startDate: sevenDaysAgo, endDate: fourteenDaysAhead }),
    loadPantry(household, { days: null }),
    loadShoppingList(household, { days: 7 }),
  ])

  // First-time user: no entries and no plan
  if (entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={session.user.name} />
  }

  const pantryItems = pantry.items
  const pantryIngredients = pantry.items.map((item) => ({
    ingredientId: item.ingredient.id,
    isStaple: item.isStaple,
  }))

  const shoppingItems: TimelineShoppingItem[] = shoppingList.groups.flatMap((group) =>
    group.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      displayQuantity: item.displayQuantity,
      neededByDate: item.neededByDate,
      neededByRelative: item.neededByRelative,
      purchased: item.purchased,
      // Bucket against the household's day, not the server's (HON-762).
      urgency: getUrgencyBucket(item.neededByDate, new Date(todayParsed)),
    })),
  )

  // Expected meal types come off the membership row, which already eager-loads
  // `preferences` — no request to /api/households/me/preferences (HON-676).
  // A household with no `household_preferences` row has `preferences: null`
  // and keeps the dinner-only defaults (HON-672).
  const expectedMealTypes: ExpectedMealTypes = {
    weekdayMealTypes: ['dinner'],
    weekendMealTypes: ['dinner'],
  }
  if (household.preferences?.weekdayMealTypes.length) {
    expectedMealTypes.weekdayMealTypes = household.preferences.weekdayMealTypes
  }
  if (household.preferences?.weekendMealTypes.length) {
    expectedMealTypes.weekendMealTypes = household.preferences.weekendMealTypes
  }

  return (
    <TimelineView
      entries={entries}
      planId={planId ?? ''}
      expectedMealTypes={expectedMealTypes}
      householdSize={householdSize}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
      openCustomItemCount={shoppingList.customItems.filter((item) => !item.checked).length}
      todayDate={todayDate}
    />
  )
}
