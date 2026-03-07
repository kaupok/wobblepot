'use client'

import Link from 'next/link'
import { TodayMealCard } from './TodayMealCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { hasMealTimePassed } from '@/lib/meal-planning/dates'
import type { PlanEntry, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

interface TodayMealsProps {
  entries: PlanEntry[]
  planId: string | null
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
  timezone: string
}

export function TodayMeals({
  entries,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
  timezone,
}: TodayMealsProps) {
  // Show empty state if no entries or no plan
  if (entries.length === 0 || !planId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Body variant="muted">No meals planned for today</Body>
            <Button variant="outline" asChild>
              <Link href="/meal-plan">View meal plan</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <CardTitle>Today</CardTitle>
      {entries.map((entry) => {
        // Show status prompt if meal time has passed and status is still planned
        const showStatusPrompt =
          entry.status === 'planned' && hasMealTimePassed(entry.mealType as MealType, timezone)

        return (
          <TodayMealCard
            key={entry.id}
            entryId={entry.id}
            planId={planId}
            meal={entry.meal}
            mealType={entry.mealType}
            status={entry.status}
            initialRating={entry.rating}
            householdSize={householdSize}
            pantryIngredients={pantryIngredients}
            pantryItems={pantryItems}
            showStatusPrompt={showStatusPrompt}
            initialTips={entry.preparationTips}
            initialNote={entry.note}
            initialServingOverride={entry.servingOverride}
          />
        )
      })}
    </div>
  )
}
