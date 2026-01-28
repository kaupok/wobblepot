'use client'

import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { useIngredientAvailability } from '@/hooks/use-ingredient-availability'
import { useMealTips } from '@/hooks/use-meal-tips'
import { MealDetail } from './MealDetail'
import type { MealData, PantryIngredient } from './types'

interface MealDetailModalProps {
  meal: MealData
  householdSize: number
  open: boolean
  onOpenChange: (open: boolean) => void
  pantryIngredients?: PantryIngredient[]
  planId: string
  entryId: string
}

export function MealDetailModal({
  meal,
  householdSize,
  open,
  onOpenChange,
  pantryIngredients = [],
  planId,
  entryId,
}: MealDetailModalProps) {
  const router = useRouter()
  const { togglingIngredientIds, handleToggleAvailability } = useIngredientAvailability({
    onRefresh: () => router.refresh(),
  })
  const {
    tips,
    isLoadingTips,
    tipsError,
    isTipsExpanded,
    fetchTips,
    handleHowToPrepare,
    hideTips,
  } = useMealTips({ planId, entryId })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription className="sr-only">Details for {meal.name}</DialogDescription>
        </DialogHeader>
        <MealDetail
          meal={meal}
          householdSize={householdSize}
          pantryIngredients={pantryIngredients}
          onToggleAvailability={handleToggleAvailability}
          togglingIds={togglingIngredientIds}
          tips={tips}
          isLoadingTips={isLoadingTips}
          tipsError={tipsError}
          onRetryTips={fetchTips}
          isTipsExpanded={isTipsExpanded}
          onHowToPrepare={handleHowToPrepare}
          onHideTips={hideTips}
        />
      </DialogContent>
    </Dialog>
  )
}
