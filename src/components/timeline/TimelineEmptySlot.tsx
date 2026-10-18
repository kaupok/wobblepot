'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AddMealMenu,
  type AddMealChoice,
  type AddMealView,
} from '@/components/meal-plan/AddMealMenu'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { usePickForMe } from '@/components/meal-plan/use-pick-for-me'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { ApiError, apiFetch } from '@/lib/api'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import type { MealType } from '@/generated/prisma/enums'
import type { PantryIngredient } from '@/components/meal-plan/types'

interface TimelineEmptySlotProps {
  planId: string
  date: string
  /** The day as its heading reads it, e.g. "Saturday Oct 3" or "Tomorrow". */
  dayLabel: string
  /** Set on Today and Tomorrow, whose selector title says the word rather than the date. */
  relativeDay?: 'today' | 'tomorrow'
  mealType: MealType
  householdServings: number
  pantryIngredients?: PantryIngredient[]
  /**
   * Take focus on mount: this slot replaces a card whose meal was just
   * cleared, and focus fell to the page body with that card (HON-1123).
   */
  autoFocus?: boolean
  /** Called once the mount has acted on `autoFocus`, so the page can drop it. */
  onAutoFocused?: () => void
  /**
   * "Pick for me" placed a meal. This slot unmounts when the refresh lands,
   * taking focus with it, so the page moves focus to the day (HON-1248).
   */
  onPicked?: () => void
}

export function TimelineEmptySlot({
  planId,
  date,
  dayLabel,
  relativeDay,
  mealType,
  householdServings,
  pantryIngredients = [],
  autoFocus = false,
  onAutoFocused,
  onPicked,
}: TimelineEmptySlotProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
  const mealTypeLabel = useEnumLabel('MealType', mealType)
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [view, setView] = useState<AddMealView>('library')
  const hasSelectedRef = useRef(false)
  const pickButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!autoFocus) return
    // Only from the body: a user who moved on before the refresh landed keeps
    // their place.
    if (!document.activeElement || document.activeElement === document.body) {
      pickButtonRef.current?.focus()
    }
    onAutoFocused?.()
  }, [autoFocus, onAutoFocused])

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
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      // A 409 means another tab or member already filled this slot, which a
      // refresh shows; nothing else the route sends gives the user a next step.
      console.error(
        '[timeline-empty-slot] create entry failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(
        err instanceof ApiError && err.status === 409
          ? tCard('entryAlreadyExists')
          : tCard('createEntryFailed'),
      )
    },
  })
  const isCreating = createEntryMutation.isPending

  // Drops the placeholder entry `handleChoose` created when the selector
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
  const { pick, isPicking } = usePickForMe({ planId, date, mealType, onPicked })
  // The slot is filling while a placeholder or a pick is in flight.
  const isAdding = isCreating || isPicking
  // No second placeholder while the last one is still being created or deleted.
  const isPending = isAdding || isDiscarding

  function handleChoose(chosen: AddMealChoice) {
    // The menu stays closed while pending; this guards an item chosen in the
    // same tick as the first.
    if (isPending) return
    // "Pick for me" places the meal in one request, with no placeholder.
    if (chosen === 'pick') {
      pick()
      return
    }
    hasSelectedRef.current = false
    setView(chosen)
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

  // Radix hands focus back to a `DialogTrigger`, and the selector has none, so
  // return it to the slot's button ourselves (HON-803). The button is still pending
  // here — the discard is in flight — which is why it is `aria-disabled` rather
  // than `disabled`: a disabled button cannot take focus.
  function handleCloseAutoFocus(event: Event) {
    event.preventDefault()
    pickButtonRef.current?.focus()
  }

  // The meal type alone is the visible text ("+ Dinner"), so Estonian needs no
  // declension of it (HON-807). Every empty day has a "Dinner" button, so the
  // name adds the action and the day after the visible text, which a voice
  // user can still say (WCAG 2.5.3).
  const buttonText = isAdding ? tCard('adding') : mealTypeLabel
  const accessibleName = isAdding
    ? tCard('slotActionLabel', { action: buttonText, day: dayLabel, mealType: mealTypeLabel })
    : tCard('emptySlotLabel', { mealType: mealTypeLabel, day: dayLabel })

  return (
    <>
      {/* The button opens the routes to a meal; a selector route creates the
          placeholder, then opens the selector in its view (HON-1247). */}
      <AddMealMenu onChoose={handleChoose} disabled={isPending}>
        <Button
          ref={pickButtonRef}
          variant="ghost"
          size="sm"
          // Not `disabled`: a disabled button drops focus and cannot take it
          // back when the selector closes (HON-803).
          aria-disabled={isPending || undefined}
          aria-label={accessibleName}
        >
          <Plus aria-hidden="true" />
          {buttonText}
        </Button>
      </AddMealMenu>
      {entryId && (
        <MealSelectorModal
          open={isSelectorOpen}
          onOpenChange={handleSelectorClose}
          planId={planId}
          entryId={entryId}
          mealType={mealType}
          date={date}
          relativeDay={relativeDay}
          householdServings={householdServings}
          onSwapComplete={handleSwapComplete}
          mode="add"
          initialView={view}
          pantryIngredients={pantryIngredients}
          onCloseAutoFocus={handleCloseAutoFocus}
        />
      )}
    </>
  )
}
