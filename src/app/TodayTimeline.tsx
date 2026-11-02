import type { ComponentProps } from 'react'

import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import type { getHouseholdMembership } from '@/lib/household'
import { loadCoverIds } from '@/lib/ingredient-form-cover-ids'
import { getTodayInTimezone, getUrgencyBucket, parseLocalDate } from '@/lib/meal-planning/dates'
import { getExpectedMealTypes } from '@/lib/meal-planning/expected-meal-types'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { sumPortions } from '@/lib/meal-planning/servings'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

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
  const range = { startDate: todayParsed, endDate: fourteenDaysAhead }
  const [{ entries, planId }, pantry, shoppingList, extras, coverIds] = await Promise.all([
    loadPlanEntries(household, range),
    loadPantry(household, { days: null }),
    loadShoppingList(household, { days: 7 }),
    loadDayExtras(household, range),
    loadCoverIds(),
  ])

  // First-time user: no entries and no plan
  if (entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={userName} />
  }

  const pantryItems = pantry.items
  // A row at 0 has run out, so the meal cards do not count it as at home: a
  // switch-off on the "At home" tab then changes the card's verdict (HON-1578).
  // It stays in the list, so the pantry still has data and the meal detail
  // can tick it back. A row that another form of the herb covers is not ran
  // out, as in `pantryShoppingLines`, so the card and the panel agree on
  // every day of the timeline (HON-1558, HON-1567).
  const coveredIds = new Set(
    pantry.items
      .filter((item) => item.quantity !== 0)
      .map((item) => coverIds.get(item.ingredientId)),
  )
  const pantryIngredients = pantry.items.map((item) => ({
    ingredientId: item.ingredient.id,
    isStaple: item.isStaple,
    ...(item.quantity === 0 && !coveredIds.has(item.ingredient.id) && { ranOut: true }),
  }))

  const shoppingItems: TimelineShoppingItem[] = shoppingList.groups.flatMap((group) =>
    group.items.map((item) => ({
      ingredientId: item.ingredientId,
      name: item.name,
      displayQuantity: item.displayQuantity,
      neededByDate: item.neededByDate,
      neededByRelative: item.neededByRelative,
      purchased: item.purchased,
      restock: item.restock,
      ranOut: item.ranOut,
      low: item.low,
      // Bucket against the household's day, not the server's (HON-762).
      urgency: getUrgencyBucket(item.neededByDate, new Date(todayParsed)),
    })),
  )

  const expectedMealTypes = getExpectedMealTypes(household.preferences)

  return (
    <TimelineView
      entries={entries}
      planId={planId ?? ''}
      expectedMealTypes={expectedMealTypes}
      householdServings={householdServings}
      pantryIngredients={pantryIngredients}
      pantryItems={pantryItems}
      shoppingItems={shoppingItems}
      check={shoppingList.check}
      openCustomItemCount={shoppingList.customItems.filter((item) => !item.checked).length}
      todayDate={todayDate}
      extras={extras}
    />
  )
}
