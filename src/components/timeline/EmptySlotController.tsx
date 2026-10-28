'use client'

import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { AddMealChoice, AddMealView } from '@/components/meal-plan/AddMealMenu'
import { MealSelectorModal } from '@/components/meal-plan/MealSelectorModal'
import { FridgeMealPicker } from '@/components/meal-plan/fridge-meal/FridgeMealPicker'
import { LogMealPicker } from './LogMealPicker'
import { usePickForMe } from '@/components/meal-plan/use-pick-for-me'
import { useDropPlanSuggestions } from '@/hooks/use-drop-plan-suggestions'
import { ApiError, apiFetch } from '@/lib/api'
import type { MealType } from '@/generated/prisma/enums'
import type { PantryIngredient, PantryItemFull } from '@/components/meal-plan/types'
import type { FrequentMeal } from '@/lib/meal-plans/past-logging'

/**
 * A log on Past meals (HON-1383): the household already ate the meal, so the
 * slot is filled as cooked, from a recipe or a fridge meal only.
 */
export interface LogMode {
  /** The day as its heading reads it, for the recipe picker's description. */
  dayLabel: string
  /** The meals the household cooked most in the last 30 days, most first. */
  frequentMeals: FrequentMeal[]
  /** The fridge meals' own words of the last 30 days, as chips. */
  recentLabels: string[]
}

/** What the day's "+ Add" menu calls on a slot's controller. */
export interface EmptySlotHandle {
  /** Run a route for this slot: a selector view, `pick`, or `fridge`. */
  choose: (choice: AddMealChoice) => void
}

/** A slot's requests in flight, which keep the day's menu closed. */
export interface EmptySlotPending {
  /** A placeholder is being created or a pick is in flight. */
  isAdding: boolean
  /** `isAdding`, or a placeholder is being discarded. */
  isPending: boolean
}

interface EmptySlotControllerProps {
  ref?: Ref<EmptySlotHandle>
  planId: string
  date: string
  /** Set on Today and Tomorrow, whose selector title says the word rather than the date. */
  relativeDay?: 'today' | 'tomorrow'
  mealType: MealType
  householdServings: number
  pantryIngredients?: PantryIngredient[]
  /** The pantry the fridge-meal picker searches (HON-1277). */
  pantryItems?: PantryItemFull[]
  /** The day's "+ Add" button, which takes focus back when a dialog closes (HON-803). */
  returnFocusRef: RefObject<HTMLButtonElement | null>
  /** Called whenever this slot's requests in flight change. */
  onPendingChange: (mealType: MealType, pending: EmptySlotPending) => void
  /**
   * "Pick for me" placed a meal, or a fridge meal was saved. The slot leaves
   * the day's menu when the refresh lands, so the page moves focus to the day
   * (HON-1248).
   */
  onPicked?: () => void
  /** Set on Past meals: a recipe or fridge meal is saved as cooked (HON-1383). */
  log?: LogMode
}

/**
 * One empty slot's routes to a meal, with no button of its own: the day's
 * "+ Add" menu calls `choose` (HON-1335). It owns the placeholder entry, the
 * selector and the fridge-meal picker for its slot.
 */
export function EmptySlotController({
  ref,
  planId,
  date,
  relativeDay,
  mealType,
  householdServings,
  pantryIngredients = [],
  pantryItems = [],
  returnFocusRef,
  onPendingChange,
  onPicked,
  log,
}: EmptySlotControllerProps) {
  const router = useRouter()
  const dropSuggestionCache = useDropPlanSuggestions(planId)
  const tCard = useTranslations('meal-plan.card')
  const [isSelectorOpen, setIsSelectorOpen] = useState(false)
  const [entryId, setEntryId] = useState<string | null>(null)
  const [view, setView] = useState<AddMealView>('library')
  const [isFridgeOpen, setIsFridgeOpen] = useState(false)
  const [isLogOpen, setIsLogOpen] = useState(false)
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

  // `?placeholder` deletes the entry only while it has no meal and no note, so
  // a discard that lands after a pick leaves the meal (HON-1251).
  const discardUrl = (id: string) => `/api/meal-plans/${planId}/entries/${id}?placeholder`

  // Drops the placeholder entry `handleChoose` created when the selector
  // closes without a pick. Only a network failure refreshes the page — an
  // error status is ignored, as before.
  const discardEntryMutation = useMutation({
    mutationFn: (id: string) => fetch(discardUrl(id), { method: 'DELETE' }),
    onError: () => router.refresh(),
    // Here rather than in `mutate()`'s options, which are skipped once the
    // component unmounts. Guarded so a slow discard cannot clear a newer
    // placeholder.
    onSettled: (_data, _error, id) => setEntryId((current) => (current === id ? null : current)),
  })
  const isDiscarding = discardEntryMutation.isPending

  // A tab that closes or reloads with the selector open never runs the
  // discard, and the placeholder stays in the slot (HON-1251). A keepalive
  // request outlives the page. Not into the back/forward cache: Back restores
  // the page with the selector still open on this entry.
  const discardOnPageHideUrl = entryId ? discardUrl(entryId) : null
  useEffect(() => {
    if (!isSelectorOpen || !discardOnPageHideUrl) return
    const url = discardOnPageHideUrl
    function discardOnPageHide(event: PageTransitionEvent) {
      if (event.persisted) return
      void fetch(url, { method: 'DELETE', keepalive: true })
    }
    window.addEventListener('pagehide', discardOnPageHide)
    return () => window.removeEventListener('pagehide', discardOnPageHide)
  }, [isSelectorOpen, discardOnPageHideUrl])
  const { pick, isPicking } = usePickForMe({ planId, date, mealType, onPicked })
  // The slot is filling while a placeholder or a pick is in flight.
  const isAdding = isCreating || isPicking
  // No second placeholder while the last one is still being created or deleted.
  const isPending = isAdding || isDiscarding

  useEffect(() => {
    onPendingChange(mealType, { isAdding, isPending })
    // A slot that fills while pending leaves the menu: drop its flags with it.
    return () => onPendingChange(mealType, { isAdding: false, isPending: false })
  }, [onPendingChange, mealType, isAdding, isPending])

  function handleChoose(chosen: AddMealChoice) {
    // The day's menu stays closed while pending; this guards an item chosen
    // in the same tick as the first.
    if (isPending) return
    // "Pick for me" places the meal in one request, with no placeholder.
    if (chosen === 'pick') {
      pick()
      return
    }
    // The fridge-meal picker creates the entry as it saves, so it needs no
    // placeholder (HON-1277).
    if (chosen === 'fridge') {
      setIsFridgeOpen(true)
      return
    }
    // A log saves the pick in one request, so it needs no placeholder either.
    if (log) {
      setIsLogOpen(true)
      return
    }
    hasSelectedRef.current = false
    setView(chosen)
    createEntryMutation.mutate()
  }

  useImperativeHandle(ref, () => ({ choose: handleChoose }))

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

  function handleSaved() {
    onPicked?.()
    router.refresh()
  }

  // Radix hands focus back to a `DialogTrigger`, and the selector has none, so
  // return it to the day's "+ Add" button ourselves (HON-803). The button is
  // still pending here — the discard is in flight — which is why it is
  // `aria-disabled` rather than `disabled`: a disabled button cannot take focus.
  function handleCloseAutoFocus(event: Event) {
    event.preventDefault()
    returnFocusRef.current?.focus()
  }

  return (
    <>
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
      <FridgeMealPicker
        open={isFridgeOpen}
        onOpenChange={setIsFridgeOpen}
        planId={planId}
        date={date}
        mealType={mealType}
        pantryItems={pantryItems}
        onSaved={handleSaved}
        onCloseAutoFocus={handleCloseAutoFocus}
        recentLabels={log?.recentLabels}
        logPast={log !== undefined}
      />
      {log && (
        <LogMealPicker
          open={isLogOpen}
          onOpenChange={setIsLogOpen}
          planId={planId}
          date={date}
          mealType={mealType}
          dayLabel={log.dayLabel}
          frequentMeals={log.frequentMeals}
          onSaved={handleSaved}
          onCloseAutoFocus={handleCloseAutoFocus}
        />
      )}
    </>
  )
}
