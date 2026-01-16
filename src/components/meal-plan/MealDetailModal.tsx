'use client'

import { useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { IngredientList } from './IngredientList'
import { NutritionSummary } from './NutritionSummary'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import type { MealData, PantryIngredient } from './types'

interface MealDetailModalProps {
  meal: MealData
  householdSize: number
  open: boolean
  onOpenChange: (open: boolean) => void
  pantryIngredients?: PantryIngredient[]
}

export function MealDetailModal({
  meal,
  householdSize,
  open,
  onOpenChange,
  pantryIngredients = [],
}: MealDetailModalProps) {
  const availability = useMemo(() => {
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
                {meal.kidFriendly && (
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Kid-friendly
                  </span>
                )}
              </div>
              <AvailabilityIndicator availability={availability} />
            </div>
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-6">
          <IngredientList components={meal.components} householdSize={householdSize} />
          <NutritionSummary nutrition={meal.nutrition} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
