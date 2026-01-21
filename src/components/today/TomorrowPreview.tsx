'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { MealDetailModal } from '@/components/meal-plan/MealDetailModal'
import { MealLibraryModal } from '@/components/meal-plan/MealLibraryModal'
import {
  AvailabilityIndicator,
  computeMealAvailability,
} from '@/components/meal-plan/AvailabilityIndicator'
import type { PlanEntry, PantryIngredient, MealData } from '@/components/meal-plan/types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface TomorrowPreviewProps {
  entries: PlanEntry[]
  planId: string | null
  householdSize: number
  pantryIngredients: PantryIngredient[]
}

export function TomorrowPreview({
  entries,
  planId,
  householdSize,
  pantryIngredients,
}: TomorrowPreviewProps) {
  const router = useRouter()
  const [selectedMeal, setSelectedMeal] = useState<MealData | null>(null)
  // Track which entry is having a meal added
  const [addingMealEntryId, setAddingMealEntryId] = useState<string | null>(null)
  const addingEntry = addingMealEntryId ? entries.find((e) => e.id === addingMealEntryId) : null

  if (entries.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Tomorrow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <Body variant="muted">No meals planned for tomorrow</Body>
            <Button variant="outline" asChild>
              <Link href="/dashboard">View meal plan</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Tomorrow</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {entries.map((entry) => (
              <TomorrowMealItem
                key={entry.id}
                entry={entry}
                pantryIngredients={pantryIngredients}
                onViewDetails={() => entry.meal && setSelectedMeal(entry.meal)}
                onAddMeal={() => setAddingMealEntryId(entry.id)}
              />
            ))}
          </div>
        </CardContent>
        <CardFooter>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/dashboard?week=current">View full week</Link>
          </Button>
        </CardFooter>
      </Card>
      {selectedMeal && (
        <MealDetailModal
          meal={selectedMeal}
          householdSize={householdSize}
          open={true}
          onOpenChange={(open) => !open && setSelectedMeal(null)}
          pantryIngredients={pantryIngredients}
        />
      )}
      {addingEntry && planId && (
        <MealLibraryModal
          open={true}
          onOpenChange={(open) => !open && setAddingMealEntryId(null)}
          planId={planId}
          entryId={addingEntry.id}
          mealType={addingEntry.mealType}
          onSwapComplete={() => {
            setAddingMealEntryId(null)
            router.refresh()
          }}
        />
      )}
    </>
  )
}

interface TomorrowMealItemProps {
  entry: PlanEntry
  pantryIngredients: PantryIngredient[]
  onViewDetails: () => void
  onAddMeal: () => void
}

function TomorrowMealItem({
  entry,
  pantryIngredients,
  onViewDetails,
  onAddMeal,
}: TomorrowMealItemProps) {
  const availability = useMemo(() => {
    if (!entry.meal) return null
    return computeMealAvailability(entry.meal, pantryIngredients)
  }, [entry.meal, pantryIngredients])

  if (!entry.meal) {
    return (
      <div className="bg-muted/50 flex items-center justify-between rounded-lg px-3 py-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            {mealTypeLabels[entry.mealType]}
          </span>
          <Body variant="muted" className="text-sm">
            No meal planned
          </Body>
        </div>
        <Button variant="outline" size="sm" onClick={onAddMeal}>
          Add
        </Button>
      </div>
    )
  }

  return (
    <button
      onClick={onViewDetails}
      className="hover:bg-muted/50 flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition-colors"
    >
      <div className="flex flex-col gap-0.5">
        <span className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
          {mealTypeLabels[entry.mealType]}
        </span>
        <span className="text-sm font-medium">{entry.meal.name}</span>
        {availability && <AvailabilityIndicator availability={availability} />}
      </div>
      <div className="flex items-center gap-2">
        {entry.meal.timeMinutes && (
          <span className="text-muted-foreground text-xs">{entry.meal.timeMinutes} min</span>
        )}
      </div>
    </button>
  )
}
