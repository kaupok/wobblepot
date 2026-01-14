'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { useRouter } from 'next/navigation'
import { StatusSelect, type MealStatus } from './StatusSelect'
import { MealDetailModal } from './MealDetailModal'
import { RegenerateModal } from './RegenerateModal'
import type { MealData } from './types'
import type { MealType } from '@/generated/prisma/enums'

interface MealCardProps {
  entryId: string
  planId: string
  meal: MealData | null
  mealType: MealType
  status: MealStatus
  householdSize: number
  isReadOnly?: boolean
}

export function MealCard({
  entryId,
  planId,
  meal,
  mealType,
  status: initialStatus,
  householdSize,
  isReadOnly,
}: MealCardProps) {
  const router = useRouter()
  const [status, setStatus] = useState<MealStatus>(initialStatus)
  const [isUpdating, setIsUpdating] = useState(false)
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false)
  const [isRegenerateModalOpen, setIsRegenerateModalOpen] = useState(false)

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

  if (!meal) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center">
          <Body variant="muted">No meal planned</Body>
        </CardContent>
      </Card>
    )
  }

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{meal.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 pb-2">
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
            {meal.timeMinutes && <span>{meal.timeMinutes} min</span>}
            {meal.kidFriendly && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Kid-friendly
              </span>
            )}
          </div>
          {!isReadOnly && (
            <StatusSelect value={status} onChange={handleStatusChange} disabled={isUpdating} />
          )}
        </CardContent>
        <CardFooter className="gap-2 pt-2">
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
