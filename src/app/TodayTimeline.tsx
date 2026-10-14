import type { getHouseholdMembership } from '@/lib/household'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { sumPortions } from '@/lib/meal-planning/servings'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { getTodayInTimezone, getUrgencyBucket, parseLocalDate } from '@/lib/meal-planning/dates'
import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import type { ComponentProps } from 'react'
import type { ExpectedMealTypes } from '@/components/meal-plan/types'

type TimelineShoppingItem = ComponentProps<typeof TimelineView>['shoppingItems'][number]

type Household = NonNullable<Awaited<ReturnType<typeof getHouseholdMembership>>>['household']

/**
 * Today for a signed-in member: the plan, pantry and shopping list reads, then
 * `FirstTimeSetup` or `TimelineView`. `src/app/page.tsx` renders it inside a
 * Suspense boundary with `TodaySkeleton` as the fallback, after the session
 * and membership checks, so the onboarding redirect still happens before
 * anything streams (HON-1223).
 */
export async function TodayTimeline({
  household,
  userName,
}: {
  household: Household
  userName: string
}) {
  // Get today's date in household timezone
  const todayDate = getTodayInTimezone(household.timezone)
  const todayParsed = parseLocalDate(todayDate)

  // Compute date range: today to +14. Past days have their own page
  // (`/past-meals`), and the header counts the ones still to mark (HON-1028).
  const fourteenDaysAhead = new Date(todayParsed)
  fourteenDaysAhead.setDate(fourteenDaysAhead.getDate() + 15) // +15 because endDate is exclusive

  // The members' portions rode along on the membership query — no round-trip
  // of their own. Servings, not the member count: a toddler is half (HON-1040).
  const householdServings = sumPortions(household.members)

  // Read straight from the loaders the API routes wrap, not over HTTP into our
  // own deployment (HON-789). A loader that throws is not caught here: it
  // reaches `src/app/error.tsx` rather than rendering Today as if the plan,
  // pantry or shopping list were empty, and a failed entries load can never be
  // mistaken for a first-time household.
  const [{ entries, planId }, pantry, shoppingList] = await Promise.all([
    loadPlanEntries(household, { startDate: todayParsed, endDate: fourteenDaysAhead }),
    loadPantry(household, { days: null }),
    loadShoppingList(household, { days: 7 }),
  ])

  // First-time user: no entries and no plan
  if (entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={userName} />
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
      householdServings={householdServings}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
      openCustomItemCount={shoppingList.customItems.filter((item) => !item.checked).length}
      todayDate={todayDate}
    />
  )
}
