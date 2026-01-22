'use client'

import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { RegenerateModal } from './RegenerateModal'
import { PantryDeductionModal } from './PantryDeductionModal'
import { MealLibraryModal } from './MealLibraryModal'
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import { IngredientList } from './IngredientList'
import { NutritionSummary } from './NutritionSummary'
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
  const [isExpanded, setIsExpanded] = useState(false)
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
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)

  if (!meal) {
    const canEdit = !isReadOnly && !isPast

    return (
      <>
        <Card className="gap-2 py-2">
          <CardHeader className="px-3 pb-0">
            <div className="text-muted-foreground text-[9px] font-medium tracking-wide uppercase">
              {typeStyle.label}
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-1">
            <Body variant="muted" className="text-xs">
              No meal planned
            </Body>
          </CardContent>
          {canEdit && (
            <CardFooter className="px-3 pt-0">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setIsLibraryOpen(true)}
              >
                Add meal
              </Button>
            </CardFooter>
          )}
        </Card>
        {canEdit && (
          <MealLibraryModal
            open={isLibraryOpen}
            onOpenChange={setIsLibraryOpen}
            planId={planId}
            entryId={entryId}
            mealType={mealType}
            onSwapComplete={() => router.refresh()}
          />
        )}
      </>
    )
  }

  return (
    <>
      <Card className="gap-2 py-2">
        <CardHeader className="px-3 pb-0">
          <div className="text-muted-foreground text-[9px] font-medium tracking-wide uppercase">
            {typeStyle.label}
          </div>
          <CardTitle className="text-xs leading-tight font-semibold">{meal.name}</CardTitle>
          {!isPast && shouldShowAvailability && availability && (
            <AvailabilityIndicator availability={availability} />
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-1.5 px-3 pb-1">
          <div className="text-muted-foreground flex flex-wrap items-center gap-1 text-[10px]">
            {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
          </div>
          {!isReadOnly && isPast && (
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          )}
          {isExpanded && (
            <div className="mt-1.5 flex flex-col gap-2">
              <IngredientList
                components={meal.components}
                householdSize={householdSize}
                pantryIngredients={pantryIngredients}
                hideAvailability={status === 'completed' || status === 'skipped'}
                compact
              />
              {meal.nutrition && <NutritionSummary nutrition={meal.nutrition} compact />}
            </div>
          )}
        </CardContent>
        <CardFooter className="gap-1.5 px-3 pt-0">
          {!isReadOnly && !isPast && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => setIsRegenerateModalOpen(true)}
            >
              Swap
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setIsExpanded(!isExpanded)}
          >
            {isExpanded ? 'Hide' : 'Details'}
          </Button>
        </CardFooter>
      </Card>
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
