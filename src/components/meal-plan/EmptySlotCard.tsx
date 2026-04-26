'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from './MealSelectorModal'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { MealType } from '@/generated/prisma/enums'

interface EmptySlotCardProps {
  planId: string
  date: string
  mealType: MealType
  householdSize: number
}

export function EmptySlotCard({ planId, date, mealType, householdSize }: EmptySlotCardProps) {
  const router = useRouter()
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  // Track if a meal was selected (onSwapComplete called)
  const hasSelectedRef = useRef(false)

  async function handleAddMeal() {
    // First create an empty entry, then open the library modal
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
      // Modal was closed without selecting a meal - delete the empty entry
      try {
        await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
          method: 'DELETE',
        })
      } catch {
        // Delete failed - refresh to ensure UI reflects actual state.
        // The orphaned entry (mealId=null) will be treated as empty by fill-empty.
        router.refresh()
      }
      setEntryId(null)
    }
    setIsSelectorOpen(open)
  }

  return (
    <>
      <Card className="gap-2 border-dashed py-2">
        <CardHeader className="px-3 pb-0">
          <Body variant="caption" className="tracking-wide uppercase">
            {mealTypeLabel}
          </Body>
        </CardHeader>
        <CardContent className="px-3 pb-1">
          <Body variant="caption">No meal selected</Body>
        </CardContent>
        <CardFooter className="px-3 pt-0">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full text-xs"
            onClick={handleAddMeal}
            disabled={isCreating}
          >
            {isCreating ? 'Adding...' : 'Add meal'}
          </Button>
        </CardFooter>
      </Card>
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
        />
      )}
    </>
  )
}
