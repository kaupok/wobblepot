'use client'

import { useMemo } from 'react'
import { TodayMeals } from './TodayMeals'
import { TomorrowPreview } from './TomorrowPreview'
import { UrgentShopping } from './UrgentShopping'
import { CatchUpSection } from './CatchUpSection'
import type {
  MealPlanWithContext,
  PantryIngredient,
  PantryItemFull,
  PlanEntry,
} from '@/components/meal-plan/types'
import type { UrgencyBucket } from '@/lib/meal-planning/dates'

interface ShoppingItem {
  ingredientId: string
  name: string
  displayQuantity: string
  neededByDate: string
  neededByRelative: string
  purchased: boolean
  urgency: UrgencyBucket
}

interface CatchUpEntry extends PlanEntry {
  label: string
}

interface TodayPageProps {
  todayDate: string
  tomorrowDate: string
  plan: MealPlanWithContext | null
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  shoppingItems: ShoppingItem[]
  catchUpEntries: CatchUpEntry[]
  timezone: string
}

export function TodayPage({
  todayDate,
  tomorrowDate,
  plan,
  householdSize,
  pantryIngredients,
  pantryItems,
  shoppingItems,
  catchUpEntries,
  timezone,
}: TodayPageProps) {
  // Filter entries for today and tomorrow
  const { todayEntries, tomorrowEntries } = useMemo(() => {
    if (!plan) {
      return { todayEntries: [], tomorrowEntries: [] }
    }

    const today = plan.entries.filter((entry) => entry.date === todayDate)
    const tomorrow = plan.entries.filter((entry) => entry.date === tomorrowDate)

    return { todayEntries: today, tomorrowEntries: tomorrow }
  }, [plan, todayDate, tomorrowDate])

  // Get the plan ID for catch-up section (may come from a different plan)
  const catchUpPlanId = catchUpEntries.length > 0 ? plan?.id : null

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left column: Meals */}
        <div className="flex flex-col gap-6">
          {catchUpEntries.length > 0 && catchUpPlanId && (
            <CatchUpSection
              entries={catchUpEntries}
              planId={catchUpPlanId}
              pantryItems={pantryItems}
              householdSize={householdSize}
            />
          )}
          <TodayMeals
            entries={todayEntries}
            planId={plan?.id ?? null}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            timezone={timezone}
          />
          <TomorrowPreview
            entries={tomorrowEntries}
            planId={plan?.id ?? null}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
          />
        </div>

        {/* Right column: Shopping */}
        <div className="flex flex-col gap-6">
          <UrgentShopping items={shoppingItems} />
        </div>
      </div>
    </div>
  )
}
