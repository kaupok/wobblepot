'use client'

import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Body } from '@/components/ui/typography'
import { AlternativeCard } from './AlternativeCard'
import { MealLibraryModal } from './MealLibraryModal'
import type { AlternativeMeal, PantryIngredient } from './types'
import type { MealType } from '@/generated/prisma/enums'

interface RegenerateModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  planId: string
  entryId: string
  mealType: MealType
  householdSize: number
  currentMealName?: string
  onSwapComplete: () => void
}

function AlternativeSkeleton() {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-4 w-20" />
          </div>
          <Skeleton className="h-8 w-16" />
        </div>
        <Skeleton className="h-4 w-40" />
      </CardContent>
    </Card>
  )
}

export function RegenerateModal({
  open,
  onOpenChange,
  planId,
  entryId,
  mealType,
  householdSize,
  currentMealName,
  onSwapComplete,
}: RegenerateModalProps) {
  const [alternatives, setAlternatives] = useState<AlternativeMeal[]>([])
  const [pantryIngredients, setPantryIngredients] = useState<PantryIngredient[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)

  useEffect(() => {
    if (!open) {
      // Reset state when modal closes
      // Note: Don't reset isLibraryOpen here - it may have been set to true
      // by handleBrowseLibrary before the modal closed
      setAlternatives([])
      setPantryIngredients([])
      setError(null)
      setSelectingId(null)
      return
    }

    async function fetchData() {
      setIsLoading(true)
      setError(null)

      try {
        // Fetch alternatives and pantry in parallel
        const [alternativesResponse, pantryResponse] = await Promise.all([
          fetch(`/api/meal-plans/${planId}/entries/${entryId}/regenerate`, {
            method: 'POST',
          }),
          fetch('/api/pantry'),
        ])

        if (!alternativesResponse.ok) {
          const data = await alternativesResponse.json()
          throw new Error(data.error || 'Failed to fetch alternatives')
        }

        const alternativesData = await alternativesResponse.json()
        setAlternatives(alternativesData.alternatives)

        // Parse pantry response
        if (pantryResponse.ok) {
          const pantryData = await pantryResponse.json()
          const ingredients: PantryIngredient[] = pantryData.items.map(
            (item: { ingredient: { id: string }; isStaple: boolean }) => ({
              ingredientId: item.ingredient.id,
              isStaple: item.isStaple,
            }),
          )
          setPantryIngredients(ingredients)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch alternatives')
      } finally {
        setIsLoading(false)
      }
    }

    fetchData()
  }, [open, planId, entryId])

  async function handleSelect(mealId: string) {
    setSelectingId(mealId)

    try {
      const response = await fetch(`/api/meal-plans/${planId}/entries/${entryId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mealId }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update meal')
      }

      onSwapComplete()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update meal')
      setSelectingId(null)
    }
  }

  function handleBrowseLibrary() {
    onOpenChange(false)
    setIsLibraryOpen(true)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Choose a different meal</DialogTitle>
            <DialogDescription>
              Select one of these alternatives that match your preferences
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {isLoading && (
              <>
                <AlternativeSkeleton />
                <AlternativeSkeleton />
                <AlternativeSkeleton />
              </>
            )}

            {error && !isLoading && (
              <Body variant="muted" className="text-center">
                {error}
              </Body>
            )}

            {!isLoading &&
              !error &&
              alternatives.map((meal) => (
                <AlternativeCard
                  key={meal.id}
                  meal={meal}
                  householdSize={householdSize}
                  onSelect={handleSelect}
                  isSelecting={selectingId === meal.id}
                  pantryIngredients={pantryIngredients}
                />
              ))}

            {!isLoading && !error && alternatives.length === 0 && (
              <Body variant="muted" className="text-center">
                No alternatives available
              </Body>
            )}

            {!isLoading && (
              <div className="border-t pt-3">
                <Button variant="outline" className="w-full" onClick={handleBrowseLibrary}>
                  Browse full library
                </Button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <MealLibraryModal
        open={isLibraryOpen}
        onOpenChange={setIsLibraryOpen}
        planId={planId}
        entryId={entryId}
        mealType={mealType}
        currentMealName={currentMealName}
        onSwapComplete={onSwapComplete}
      />
    </>
  )
}
