'use client'

import { useMutation } from '@tanstack/react-query'
import { BookOpen, Repeat, ThumbsDown, ThumbsUp, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { MealType } from '@/generated/prisma/enums'
import { ApiError, apiFetch } from '@/lib/api'
import { formatInteger } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'

import { MealDetailModal } from './MealDetailModal'
import { MealSelectorModal } from './MealSelectorModal'
import { ServingControl } from './ServingControl'
import type { EntryRating, PantryIngredient, PlanEntrySide } from './types'

/** What the side's menu needs from its card, beside the side itself. */
export interface SideDishMenuContext {
  planId: string
  /** The slot's day, YYYY-MM-DD: Undo after Remove posts the side back to it. */
  date: string
  mealType: MealType
  householdServings: number
  /** The main's name, which the side picker's description names. */
  mainMealName: string
  /** The meals already in the slot, which Swap lists but refuses (Q8). */
  takenMealIds: readonly string[]
  pantryIngredients?: PantryIngredient[]
  /**
   * Called as Remove closes the menu: the side's line goes with the refresh,
   * so the card moves focus to its ⋯ trigger first.
   */
  onRemoved: () => void
}

type SideDialog = 'servings' | 'swap' | 'steps' | null

/**
 * The menu each side line opens (HON-1611): the line, "+ Cucumber salad · 3",
 * is its trigger. Servings and Swap are for a planned side; a cooked one
 * records what was made (`completedServings`, `completedSwap`). Rating is for
 * a cooked side, as the main's thumbs are. Remove offers Undo in its toast.
 */
export function SideDishMenu({
  side,
  planId,
  date,
  mealType,
  householdServings,
  mainMealName,
  takenMealIds,
  pantryIngredients,
  onRemoved,
}: SideDishMenuContext & { side: PlanEntrySide }) {
  const router = useRouter()
  const t = useTranslations('meal-plan.side')
  const tCard = useTranslations('meal-plan.card')
  const tRating = useTranslations('meal-plan.rating')
  // The read-only line's `+ {items}` form, so the line reads the same as one.
  const tFridge = useTranslations('meal-plan.fridge')
  const locale = useLocale() as Locale
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [dialog, setDialog] = useState<SideDialog>(null)
  // The item a dialog is chosen from unmounts with the menu, so focus goes to
  // the line first: the cook view returns focus to whatever had it as it
  // opened. Remove moves focus to the card's ⋯ as the menu closes, since its
  // line leaves with the refresh.
  const removeRequestedRef = useRef(false)
  const request = (which: Exclude<SideDialog, null>) => () => {
    triggerRef.current?.focus()
    setDialog(which)
  }
  const name = side.mealName ?? ''
  const isPlanned = side.status === 'planned'

  // Each dialog opens from state, so focus goes back to the line that opened
  // it (docs/DESIGN.md → Focus management).
  function focusTriggerOnClose(event: Event) {
    event.preventDefault()
    triggerRef.current?.focus()
  }
  const dialogProps = (which: Exclude<SideDialog, null>) => ({
    open: dialog === which,
    onOpenChange: (open: boolean) => setDialog(open ? which : null),
  })

  const patch = (body: object) =>
    apiFetch(`/api/meal-plans/${planId}/entries/${side.entryId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const ratingMutation = useMutation({
    mutationFn: (rating: EntryRating | null) => patch({ rating }),
    onSuccess: () => router.refresh(),
    onError: () => toast.error(tRating('saveFailed')),
  })

  // Undo posts the side back as a new side of the slot's main. It runs after
  // the line has unmounted, so its callbacks live on the mutation, not in
  // `mutate()`'s options, which are skipped once the component unmounts.
  const restoreMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/meal-plans/${planId}/entries`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          mealType,
          mealId: side.mealId,
          side: true,
          servingOverride: side.servingOverride,
          rating: side.rating,
        }),
      }),
    onSuccess: () => router.refresh(),
    onError: (err) => {
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error('[side-dish] restore after remove failed', {
        status: err instanceof ApiError ? err.status : undefined,
      })
      toast.error(t('undoFailed'))
    },
  })

  const removeMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/meal-plans/${planId}/entries/${side.entryId}`, { method: 'DELETE' }),
    onSuccess: () => {
      router.refresh()
      toast(t('removed', { name }), {
        action: {
          label: tCard('undo'),
          onClick: (event) => {
            // Sonner returns focus as the toast closes; blur first, so the
            // refresh after the restore is the last thing to move it.
            ;(event.currentTarget as HTMLElement | null)?.blur()
            restoreMutation.mutate()
          },
        },
        duration: 6000,
      })
    },
    onError: () => toast.error(t('removeFailed')),
  })

  const rate = (rating: EntryRating) =>
    ratingMutation.mutate(side.rating === rating ? null : rating)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button ref={triggerRef} variant="quiet-link" size="inline">
            {tFridge('withItems', { items: `${name} · ${formatInteger(side.servings, locale)}` })}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            if (!removeRequestedRef.current) return
            removeRequestedRef.current = false
            event.preventDefault()
            onRemoved()
          }}
        >
          {isPlanned && (
            <DropdownMenuItem onSelect={request('servings')}>
              <Users aria-hidden="true" />
              {t('servings')}
            </DropdownMenuItem>
          )}
          {isPlanned && (
            <DropdownMenuItem onSelect={request('swap')}>
              <Repeat aria-hidden="true" />
              {tCard('swap')}
            </DropdownMenuItem>
          )}
          {side.meal && (
            <DropdownMenuItem onSelect={request('steps')}>
              <BookOpen aria-hidden="true" />
              {t('steps')}
            </DropdownMenuItem>
          )}
          {side.status === 'completed' && (
            <>
              <DropdownMenuCheckboxItem
                checked={side.rating === 'up'}
                onCheckedChange={() => rate('up')}
              >
                <ThumbsUp aria-hidden="true" />
                {tRating('thumbsUp')}
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={side.rating === 'down'}
                onCheckedChange={() => rate('down')}
              >
                <ThumbsDown aria-hidden="true" />
                {tRating('thumbsDown')}
              </DropdownMenuCheckboxItem>
            </>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              removeRequestedRef.current = true
              removeMutation.mutate()
            }}
            disabled={removeMutation.isPending}
          >
            <X aria-hidden="true" />
            {t('remove')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {isPlanned && (
        <Dialog {...dialogProps('servings')}>
          <DialogContent className="sm:max-w-sm" onCloseAutoFocus={focusTriggerOnClose}>
            <DialogHeader>
              <DialogTitle>{t('servingsTitle')}</DialogTitle>
              <DialogDescription>{t('servingsDescription', { name })}</DialogDescription>
            </DialogHeader>
            <ServingControl
              servings={side.servings}
              householdServings={householdServings}
              onServingsChange={(servings) =>
                patch({ servingOverride: servings }).then(
                  () => {
                    router.refresh()
                    return true
                  },
                  () => {
                    toast.error(t('servingsFailed'))
                    return false
                  },
                )
              }
            />
          </DialogContent>
        </Dialog>
      )}

      {isPlanned && (
        <MealSelectorModal
          {...dialogProps('swap')}
          planId={planId}
          entryId={side.entryId}
          mealType={mealType}
          date={date}
          householdServings={householdServings}
          currentMealName={mainMealName}
          mode="side"
          replaceSide
          takenMealIds={takenMealIds}
          initialView="library"
          pantryIngredients={pantryIngredients}
          onSwapComplete={() => router.refresh()}
          onCloseAutoFocus={focusTriggerOnClose}
        />
      )}

      {side.meal && (
        <MealDetailModal
          {...dialogProps('steps')}
          meal={side.meal}
          // A side with no override follows its main's servings (Q2), so the
          // cook view opens on them.
          householdServings={side.servingOverride === null ? side.servings : householdServings}
          servingOverride={side.servingOverride}
          onServingOverrideChange={() => router.refresh()}
          status={side.status}
          planId={planId}
          entryId={side.entryId}
          pantryIngredients={pantryIngredients}
          initialSteps={side.preparationTips ?? null}
          conflicts={isPlanned ? side.conflicts : undefined}
          // The side is cooked with its main, from the main's card, so the
          // view has no "Done cooking".
          generateOnOpen={isPlanned}
        />
      )}
    </>
  )
}
