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
import { AvailabilityIndicator, computeMealAvailability } from './AvailabilityIndicator'
import type { MealData, PantryIngredient } from './types'
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
  pantryIngredients?: PantryIngredient[]
}

export function MealCard({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  householdSize,
  isReadOnly,
  pantryIngredients = [],
}: MealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)

  const availability = useMemo(() => {
    if (!meal) return null
    return computeMealAvailability(meal, pantryIngredients)
  }, [meal, pantryIngredients])

  async function handleStatusChange(newStatus: MealStatus) {
    const previousStatus = status
    // Optimistic update
    setStatus(newStatus)
    setIsUpdating(true)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })

      if (!response.ok) {
        // Revert on error
        setStatus(previousStatus)
        toast.error('Failed to update status. Please try again.')
      }
    } catch {
      // Revert on error
      setStatus(previousStatus)
      toast.error('Failed to update status. Please try again.')
    } finally {
      setIsUpdating(false)
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
        </CardHeader>
        <CardContent className="flex flex-col gap-2 pb-2">
          <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-xs">
            {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
            {meal.kidFriendly && (
              <span className="rounded-full bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Kid-friendly
              </span>
            )}
            {availability && !availability.isReady && (
              <AvailabilityIndicator availability={availability} />
            )}
          </div>
          {availability?.isReady && <AvailabilityIndicator availability={availability} />}
          {!isReadOnly && (
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          )}
        </CardContent>
        <CardFooter className="gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => setIsDetailModalOpen(true)}>
            View
          </Button>
          {!isReadOnly && (
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
    </>
  )
}
