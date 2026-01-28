'use client'

import { useState, useCallback } from 'react'
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
  const [tips, setTips] = useState<string | null>(null)
  const [isLoadingTips, setIsLoadingTips] = useState(false)
  const [tipsError, setTipsError] = useState<string | null>(null)
  const [isTipsExpanded, setIsTipsExpanded] = useState(false)

  const fetchTips = useCallback(async () => {
    setIsLoadingTips(true)
    setTipsError(null)
    setIsTipsExpanded(true)

    try {
      const response = await fetch(
        `/api/meal-plans/${planId}/entries/${entryId}/preparation-tips`,
        {
          method: 'POST',
        },
      )

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || "Couldn't generate tips")
      }

      const data = await response.json()
      setTips(data.tips)
    } catch (error) {
      setTipsError(error instanceof Error ? error.message : "Couldn't generate tips. Try again.")
    } finally {
      setIsLoadingTips(false)
    }
  }, [planId, entryId])

  function handleHowToPrepare() {
    if (tips) {
      setIsTipsExpanded((prev) => !prev)
    } else {
      fetchTips()
    }
  }

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
          tips={tips}
          isLoadingTips={isLoadingTips}
          tipsError={tipsError}
          onRetryTips={fetchTips}
          isTipsExpanded={isTipsExpanded}
          onHowToPrepare={handleHowToPrepare}
          onHideTips={() => setIsTipsExpanded(false)}
        />
      </DialogContent>
    </Dialog>
  )
}
