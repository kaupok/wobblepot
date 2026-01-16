'use client'

import { useState, useMemo } from 'react'
import { ChevronDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { IngredientList } from './IngredientList'
import { NutritionSummary } from './NutritionSummary'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import type { AlternativeMeal, PantryIngredient } from './types'

interface AlternativeCardProps {
  meal: AlternativeMeal
  householdSize: number
  onSelect: (mealId: string) => void
  isSelecting: boolean
  pantryIngredients?: PantryIngredient[]
}

export function AlternativeCard({
  meal,
  householdSize,
  onSelect,
  isSelecting,
  pantryIngredients = [],
}: AlternativeCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  // AlternativeMeal has a similar structure to MealData, but we need to adapt it
  const availability = useMemo(() => {
    const mealForAvailability = {
      id: meal.id,
      name: meal.name,
      kidFriendly: meal.kidFriendly,
      timeMinutes: meal.timeMinutes,
      components: meal.components,
      nutrition: meal.nutrition,
    }
    return computeMealAvailability(mealForAvailability, pantryIngredients)
  }, [meal, pantryIngredients])

  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3">
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-col gap-1">
              <span className="font-medium">{meal.name}</span>
              <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
                {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
                {meal.kidFriendly && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Kid-friendly
                  </span>
                )}
                <AvailabilityIndicator availability={availability} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                  <span className="sr-only">{isExpanded ? 'Collapse' : 'Expand'} details</span>
                </Button>
              </CollapsibleTrigger>
              <Button size="sm" onClick={() => onSelect(meal.id)} disabled={isSelecting}>
                {isSelecting ? 'Selecting...' : 'Select'}
              </Button>
            </div>
          </div>
          <Body variant="muted">{meal.reason}</Body>
          <CollapsibleContent className="pt-3">
            <div className="flex flex-col gap-4 border-t pt-3">
              <IngredientList components={meal.components} householdSize={householdSize} />
              <NutritionSummary nutrition={meal.nutrition} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}
