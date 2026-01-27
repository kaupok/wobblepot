'use client'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { MealDetail } from './MealDetail'
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
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription className="sr-only">Details for {meal.name}</DialogDescription>
        </DialogHeader>
        <MealDetail
          meal={meal}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
        />
      </DialogContent>
    </Dialog>
  )
}
