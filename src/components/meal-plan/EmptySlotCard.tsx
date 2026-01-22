'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealLibraryModal } from './MealLibraryModal'
import type { MealType } from '@/generated/prisma/enums'

const mealTypeLabels: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

interface EmptySlotCardProps {
  planId: string
  date: string
  mealType: MealType
}

export function EmptySlotCard({ planId, date, mealType }: EmptySlotCardProps) {
  const router = useRouter()
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
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
      setIsLibraryOpen(true)
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

  async function handleLibraryClose(open: boolean) {
    if (!open && entryId && !hasSelectedRef.current) {
      // Modal was closed without selecting a meal - delete the empty entry
      try {
        await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
          method: 'DELETE',
        })
      } catch {
        // Silently ignore delete errors - the entry will be orphaned but harmless
      }
      setEntryId(null)
    }
    setIsLibraryOpen(open)
  }

  return (
    <>
      <Card className="gap-2 border-dashed py-2">
        <CardHeader className="px-3 pb-0">
          <div className="text-muted-foreground text-[9px] font-medium tracking-wide uppercase">
            {mealTypeLabels[mealType]}
          </div>
        </CardHeader>
        <CardContent className="px-3 pb-1">
          <Body variant="muted" className="text-xs">
            No meal selected
          </Body>
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
        <MealLibraryModal
          open={isLibraryOpen}
          onOpenChange={handleLibraryClose}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          onSwapComplete={handleSwapComplete}
        />
      )}
    </>
  )
}
