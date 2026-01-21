'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { MealDetailModal } from './MealDetailModal'
import { RegenerateModal } from './RegenerateModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import type { MealData, PantryIngredient, PantryItemFull } from './types'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeStyles: Record<MealType, { label: string }> = {
  breakfast: {
    label: 'Breakfast',
  },
  lunch: {
    label: 'Lunch',
  },
  dinner: {
    label: 'Dinner',
  },
}

interface MealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  status: MealStatus
  householdSize: number
  isReadOnly?: boolean
  isPast?: boolean
  pantryIngredients?: PantryIngredient[]
  pantryItems?: PantryItemFull[]
}

export function MealCard({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  householdSize,
  isReadOnly,
  isPast,
  pantryIngredients = [],
  pantryItems = [],
}: MealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)
  const [isDeductionModalOpen, setIsDeductionModalOpen] = useState(false)

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  // Hide availability badge for completed/skipped meals (ingredient status no longer relevant)
  const shouldShowAvailability = status !== 'completed' && status !== 'skipped'

  async function updateStatus(newStatus: MealStatus, deductPantry: boolean = false) {
    const previousStatus = status
    // Optimistic update
    setStatus(newStatus)
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, deductPantry }),
      })

      if (!response.ok) {
        // Revert on error
        setStatus(previousStatus)
        toast.error('Failed to update status. Please try again.')
        return false
      }
      return true
    } catch {
      // Revert on error
      setStatus(previousStatus)
      toast.error('Failed to update status. Please try again.')
      return false
    } finally {
      setIsUpdating(false)
    }
  }

  function handleStatusChange(newStatus: MealStatus) {
    // Intercept "completed" status to show deduction modal
    if (newStatus === 'completed' && meal) {
      setIsDeductionModalOpen(true)
      return
    }

    // For other statuses, update directly
    updateStatus(newStatus)
  }

  async function handleDeductionConfirm() {
    const success = await updateStatus('completed', true)
    if (success) {
      setIsDeductionModalOpen(false)
      // Refresh to update pantry data
      router.refresh()
    }
  }

  const typeStyle = mealTypeStyles[mealType]

  if (!meal) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-4">
          <Body variant="muted">No meal planned</Body>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-1">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            {typeStyle.label}
          </div>
          <CardTitle className="text-sm leading-tight font-semibold">{meal.name}</CardTitle>
          {!isPast && shouldShowAvailability && availability && (
            <AvailabilityIndicator availability={availability} />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pb-2">
          <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
            {meal.nutrition && (
              <span>
                {meal.timeMinutes && '• '}
                {Math.round(meal.nutrition.calories)} kcal
              </span>
            )}
          </div>
          {!isReadOnly && (
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          )}
        </CardContent>
        <CardFooter className="gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setIsDetailModalOpen(true)}>
            View
          </Button>
          {!isReadOnly && !isPast && (
            <Button variant="outline" size="sm" onClick={() => setIsRegenerateModalOpen(true)}>
              Swap
            </Button>
          )}
        </CardFooter>
      </Card>
      <MealDetailModal
        meal={meal}
        householdSize={householdSize}
        open={isDetailModalOpen}
        onOpenChange={setIsDetailModalOpen}
        pantryIngredients={pantryIngredients}
      />
      <RegenerateModal
        open={isRegenerateModalOpen}
        onOpenChange={setIsRegenerateModalOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        householdSize={householdSize}
        currentMealName={meal?.name}
        onSwapComplete={() => router.refresh()}
      />
      <PantryDeductionModal
        open={isDeductionModalOpen}
        onOpenChange={setIsDeductionModalOpen}
        mealName={meal.name}
        components={meal.components}
        householdSize={householdSize}
        pantryItems={pantryItems}
        onConfirm={handleDeductionConfirm}
        isLoading={isUpdating}
      />
    </>
  )
}
