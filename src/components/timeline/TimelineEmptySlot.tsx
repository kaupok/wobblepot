'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { MealTypeBadge } from '@/components/meal-plan/MealTypeBadge'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { apiFetch } from '@/lib/api'
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
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const hasSelectedRef = useRef(false)

  const createEntryMutation = useMutation({
    mutationFn: () =>
      apiFetch<{ id: string }>(
        `/api/meal-plans/${planId}/entries`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ date, mealType }),
        },
        tCard('createEntryFailed'),
      ),
    onSuccess: (data) => {
      setEntryId(data.id)
      setIsSelectorOpen(true)
    },
    onError: (err) => toast.error(err.message),
  })
  const isCreating = createEntryMutation.isPending

  // Drops the placeholder entry `handlePickMeal` created when the selector
  // closes without a pick. Only a network failure refreshes the page — an
  // error status is ignored, as before.
  const discardEntryMutation = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/meal-plans/${planId}/entries/${id}`, {
        method: 'DELETE',
      }),
    onError: () => router.refresh(),
    // Here rather than in `mutate()`'s options, which are skipped once the
    // component unmounts. Guarded so a slow discard cannot clear a newer
    // placeholder.
    onSettled: (_data, _error, id) => setEntryId((current) => (current === id ? null : current)),
  })
  const isDiscarding = discardEntryMutation.isPending

  function handlePickMeal() {
    hasSelectedRef.current = false
    createEntryMutation.mutate()
  }

  function handleSwapComplete() {
    hasSelectedRef.current = true
    // Filling this slot adds a meal to the plan's `recentMealIds`, so every
    // other card's cached suggestion list now offers a meal that is planned
    // (HON-682) — see `useDropPlanSuggestions`.
    dropSuggestionCache()
    router.refresh()
  }

  function handleSelectorClose(open: boolean) {
    // Close first: the modal's `reset()` has just dropped this entry's
    // suggestions query, and while `open` is still true the re-render the
    // pending discard causes would recreate and refetch it for the entry being
    // deleted (HON-799).
    setIsSelectorOpen(open)
    if (!open && entryId && !hasSelectedRef.current) {
      discardEntryMutation.mutate(entryId)
    }
  }

  return (
    <>
      <div className="flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <MealTypeBadge mealType={mealType} />
          <Body variant="caption">{tCard('noMealPlanned')}</Body>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handlePickMeal}
          // No second placeholder while the last one is still being deleted.
          disabled={isCreating || isDiscarding}
        >
          {isCreating ? tCard('adding') : tCard('pickMeal')}
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
