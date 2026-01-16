'use client'

import Link from 'next/link'
import { MealCard } from '@/components/meal-plan/MealCard'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import type { PlanEntry, PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'

interface TodayMealsProps {
  entries: PlanEntry[]
  planId: string | null
  householdSize: number
  pantryIngredients: PantryIngredient[]
  pantryItems: PantryItemFull[]
}

export function TodayMeals({
  entries,
  planId,
  householdSize,
  pantryIngredients,
  pantryItems,
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
              <Link href="/dashboard">View meal plan</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Today</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {entries.map((entry) => (
            <MealCard
              key={entry.id}
              entryId={entry.id}
              planId={planId}
              meal={entry.meal}
              mealType={entry.mealType}
              status={entry.status}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              pantryItems={pantryItems}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
