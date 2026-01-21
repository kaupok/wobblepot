'use client'

import { useState } from 'react'
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

  async function handleAddMeal() {
    // First create an empty entry, then open the library modal
    setIsCreating(true)

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
    router.refresh()
  }

  function handleLibraryClose(open: boolean) {
    if (!open && entryId) {
      // If modal was closed without selecting a meal, we still want to refresh
      // to show the empty entry (user can fill it later)
      router.refresh()
    }
    setIsLibraryOpen(open)
  }

  return (
    <>
      <Card className="border-dashed">
        <CardHeader className="pb-1">
          <div className="text-muted-foreground text-[10px] font-medium tracking-wide uppercase">
            {mealTypeLabels[mealType]}
          </div>
        </CardHeader>
        <CardContent className="pb-2">
          <Body variant="muted">No meal selected</Body>
        </CardContent>
        <CardFooter className="pt-1">
          <Button variant="outline" size="sm" onClick={handleAddMeal} disabled={isCreating}>
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
