'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import type { MealType } from '@/generated/prisma/enums'
import type { PantryIngredient } from '@/components/meal-plan/types'

interface TimelineEmptySlotProps {
  planId: string
  date: string
  mealType: MealType
  householdSize: number
  pantryIngredients?: PantryIngredient[]
}

export function TimelineEmptySlot({
  planId,
  date,
  mealType,
  householdSize,
  pantryIngredients = [],
}: TimelineEmptySlotProps) {
  const router = useRouter()
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const hasSelectedRef = useRef(false)

  async function handlePickMeal() {
    setIsCreating(true)
    hasSelectedRef.current = false

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, mealType }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create entry')
      }

      const data = await response.json()
      setEntryId(data.id)
      setIsSelectorOpen(true)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add meal slot')
    } finally {
      setIsCreating(false)
    }
  }

  function handleSwapComplete() {
    hasSelectedRef.current = true
    router.refresh()
  }

  async function handleSelectorClose(open: boolean) {
    if (!open && entryId && !hasSelectedRef.current) {
      try {
        await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
          method: 'DELETE',
        })
      } catch {
        router.refresh()
      }
      setEntryId(null)
    }
    setIsSelectorOpen(open)
  }

  return (
    <>
      <div className="flex items-center justify-between rounded-lg border border-dashed px-3 py-2">
        <Body variant="caption">No meal planned</Body>
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handlePickMeal}
          disabled={isCreating}
        >
          {isCreating ? 'Adding...' : 'Pick a meal'}
        </Button>
      </div>
      {entryId && (
        <MealSelectorModal
          open={isSelectorOpen}
          onOpenChange={handleSelectorClose}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          householdSize={householdSize}
          onSwapComplete={handleSwapComplete}
          mode="add"
          pantryIngredients={pantryIngredients}
        />
      )}
    </>
  )
}
