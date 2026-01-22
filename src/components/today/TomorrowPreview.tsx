'use client'

import Link from 'next/link'
import { CardTitle } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { Button } from '@/components/ui/button'
import { CollapsibleMealCard } from './CollapsibleMealCard'
import type { PlanEntry, PantryIngredient } from '@/components/meal-plan/types'

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
  if (entries.length === 0 || !planId) {
    return (
      <div className="flex flex-col gap-4">
        <CardTitle>Tomorrow</CardTitle>
        <div className="flex flex-col items-center gap-4 py-6 text-center">
          <Body variant="muted">No meals planned for tomorrow</Body>
          <Button variant="outline" asChild>
            <Link href="/meal-plan">View meal plan</Link>
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <CardTitle>Tomorrow</CardTitle>
      {entries.map((entry) => (
        <CollapsibleMealCard
          key={entry.id}
          entryId={entry.id}
          planId={planId}
          meal={entry.meal}
          mealType={entry.mealType}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
          defaultExpanded={false}
        />
      ))}
      <Button variant="ghost" size="sm" className="self-start" asChild>
        <Link href="/meal-plan?week=current">View full week</Link>
      </Button>
    </div>
  )
}
