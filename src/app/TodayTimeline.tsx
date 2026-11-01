import type { ComponentProps } from 'react'

import { TimelineView } from '@/components/timeline'
import { FirstTimeSetup } from '@/components/timeline'
import { loadDayExtras } from '@/lib/day-extras/day-extras'
import type { getHouseholdMembership } from '@/lib/household'
import { getTodayInTimezone, getUrgencyBucket, parseLocalDate } from '@/lib/meal-planning/dates'
import { getExpectedMealTypes } from '@/lib/meal-planning/expected-meal-types'
import { loadPantry } from '@/lib/meal-planning/load-pantry'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'
import { sumPortions } from '@/lib/meal-planning/servings'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'

type TimelineShoppingItem = ComponentProps<typeof TimelineView>['shoppingItems'][number]
type TimelineAtHomeItem = NonNullable<ComponentProps<typeof TimelineView>['atHomeItems']>[number]

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
  const [{ entries, planId }, pantry, shoppingList, extras] = await Promise.all([
    loadPlanEntries(household, range),
    loadPantry(household, { days: null }),
    loadShoppingList(household, { days: 7 }),
    loadDayExtras(household, range),
  ])

  // First-time user: no entries and no plan
  if (entries.length === 0 && !planId) {
    return <FirstTimeSetup userName={userName} />
  }

  const pantryItems = pantry.items
  // A row at 0 has run out, so the meal cards do not count it as at home: a
  // switch-off on the "At home" tab then changes the card's verdict (HON-1578).
  // It stays in the list, so the pantry still has data and the meal detail
  // can tick it back. A row whose need another form of the herb keeps at home
  // is not ran out, so the card and the panel agree (HON-1558).
  const atHomeIds = new Set(shoppingList.atHome.map((item) => item.ingredientId))
  const pantryIngredients = pantry.items.map((item) => ({
    ingredientId: item.ingredient.id,
    isStaple: item.isStaple,
    ...(item.quantity === 0 && !atHomeIds.has(item.ingredient.id) && { ranOut: true }),
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
      // Bucket against the household's day, not the server's (HON-762).
      urgency: getUrgencyBucket(item.neededByDate, new Date(todayParsed)),
    })),
  )

  // The needs the pantry covers (HON-1578), for the panel's "At home" tab.
  // The panel keeps today's and tomorrow's.
  const atHomeItems: TimelineAtHomeItem[] = shoppingList.atHome.map((item) => ({
    ingredientId: item.ingredientId,
    name: item.name,
    displayQuantity: item.displayQuantity,
    neededByDate: item.neededByDate,
    pantryRows: item.pantryRows,
    isStaple: item.isStaple,
    urgency: getUrgencyBucket(item.neededByDate, new Date(todayParsed)),
  }))

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
      atHomeItems={atHomeItems}
      openCustomItemCount={shoppingList.customItems.filter((item) => !item.checked).length}
      todayDate={todayDate}
      extras={extras}
    />
  )
}
