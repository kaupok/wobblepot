'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { IngredientList } from './IngredientList'
import { NutritionSummary } from './NutritionSummary'
import type { MealData } from './types'

interface MealDetailModalProps {
  meal: MealData
  householdSize: number
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MealDetailModal({ meal, householdSize, open, onOpenChange }: MealDetailModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-2">
              {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
              {meal.kidFriendly && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  Kid-friendly
                </span>
              )}
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
