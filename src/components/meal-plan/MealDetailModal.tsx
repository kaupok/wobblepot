'use client'

import { useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
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
import { NoteEditor } from './NoteEditor'
import type { MealData, PantryIngredient } from './types'

interface MealDetailModalProps {
  meal: MealData
  householdSize: number
  open: boolean
  onOpenChange: (open: boolean) => void
  pantryIngredients?: PantryIngredient[]
  planId: string
  entryId: string
  note?: string | null
  onNoteChange?: (note: string | null) => void
  servingOverride?: number | null
  onServingOverrideChange?: (servingOverride: number | null) => void
}

export function MealDetailModal({
  meal,
  householdSize,
  open,
  onOpenChange,
  pantryIngredients = [],
  planId,
  entryId,
  note,
  onNoteChange,
  servingOverride,
  onServingOverrideChange,
}: MealDetailModalProps) {
  const router = useRouter()
  const [localServings, setLocalServings] = useState(servingOverride ?? householdSize)
  const { togglingIngredientIds, optimisticOverrides, handleToggleAvailability } =
    useIngredientAvailability({
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

  // Sync local state when prop changes
  const effectiveServings = servingOverride ?? householdSize
  if (localServings !== effectiveServings && !open) {
    setLocalServings(effectiveServings)
  }

  const handleServingsChange = useCallback(
    async (newServings: number | null): Promise<boolean> => {
      const previousServings = localServings

      // Optimistic update
      const displayServings = newServings ?? householdSize
      setLocalServings(displayServings)

      try {
        const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ servingOverride: newServings }),
        })

        if (!response.ok) {
          setLocalServings(previousServings)
          toast.error('Failed to update servings')
          return false
        }

        // Notify parent of change
        onServingOverrideChange?.(newServings)
        return true
      } catch {
        setLocalServings(previousServings)
        toast.error('Failed to update servings')
        return false
      }
    },
    [planId, entryId, householdSize, localServings, onServingOverrideChange],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md md:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          <DialogDescription className="sr-only">Details for {meal.name}</DialogDescription>
        </DialogHeader>
        {/* Note section at top of modal */}
        <div className="border-muted mb-2 border-b pb-3">
          <NoteEditor
            planId={planId}
            entryId={entryId}
            note={note ?? null}
            onNoteChange={onNoteChange}
          />
        </div>
        <MealDetail
          meal={meal}
          householdSize={householdSize}
          servings={localServings}
          onServingsChange={handleServingsChange}
          pantryIngredients={pantryIngredients}
          onToggleAvailability={handleToggleAvailability}
          togglingIds={togglingIngredientIds}
          optimisticOverrides={optimisticOverrides}
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
