'use client'

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Heart, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch } from '@/lib/api'
import type { MealImageFields } from '@/components/meal-plan/MealImageCard'
import { RecipeDetailModal } from '@/components/recipes/RecipeDetailModal'
import { RecipeCard } from './RecipeCard'
import {
  RecentlyDeletedMeals,
  recentlyDeletedMealsQueryKey,
} from '@/components/household/RecentlyDeletedMeals'
import type { IngredientCategory, MealType, ProteinType, Unit } from '@/generated/prisma/enums'

export interface MealData extends MealImageFields {
  id: string
  name: string
  description?: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  primaryProteinType: ProteinType
  suitableFor: MealType[]
  servings: number
  isCustom: boolean
  isFavorite: boolean
  createdAt: string
  updatedAt: string
  components: {
    ingredientId: string
    quantityPerServing: number
    ingredient: {
      id: string
      name: string
      category: IngredientCategory
      defaultUnit: Unit
      gramsPerPiece?: number | null
      measuredByVolume?: boolean
    }
  }[]
  nutrition: {
    calories: number
    protein: number
    carbs: number
    fat: number
  }
  allergens: string[]
  /** The household's cook history (`loadMealHistory`, HON-1389); dates are `YYYY-MM-DD`. */
  lastCookedOn: string | null
  cookedLast28Days: number
  nextPlannedOn: string | null
}

interface MealListProps {
  meals: MealData[]
  /** The household's portions summed (HON-1040): the cook view opens at it. */
  householdServings: number
  onDelete: (mealId: string) => void
  onToggleFavorite: (mealId: string, isFavorite: boolean) => void
  /**
   * Takes focus after a delete that leaves no card to land on: the page's
   * search field, or the empty state's action once the search is gone.
   */
  emptyFocusRef?: RefObject<HTMLElement | null>
  /** The empty state's one primary button, under its line. */
  emptyAction?: ReactNode
  /** Under the grid, above Recently deleted: the page's Load more. */
  footer?: ReactNode
  /** The Recently deleted section at the end; off while a search filters the list. */
  showRecentlyDeleted?: boolean
}

export function MealList({
  meals,
  householdServings,
  onDelete,
  onToggleFavorite,
  emptyFocusRef,
  emptyAction,
  footer,
  showRecentlyDeleted = true,
}: MealListProps) {
  const t = useTranslations('recipes.list')
  const [deleteConfirmMeal, setDeleteConfirmMeal] = useState<MealData | null>(null)
  // The recipe in the cook view (HON-1338). Kept after it closes, so the view
  // can animate out and hand focus back to the card's name.
  const [viewedMeal, setViewedMeal] = useState<MealData | null>(null)
  const [isViewOpen, setIsViewOpen] = useState(false)
  // The confirm dialog opens from a menu item that is gone by the time it
  // closes, so Radix has no trigger to return focus to (HON-934). These hold
  // each card's ⋯ trigger and the card whose trigger should take focus: the
  // one Delete was chosen on, or after a delete its neighbour.
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusTargetIdRef = useRef<string | null>(null)
  const queryClient = useQueryClient()
  // A restored card whose ⋯ trigger takes focus once the refetched list
  // brings it back (HON-1336). `settled` marks the refetch done, so a card
  // outside the loaded pages does not hold the request open.
  const cardFocusRef = useRef<{ id: string; settled: boolean } | null>(null)

  useEffect(() => {
    const pending = cardFocusRef.current
    if (!pending) return
    const trigger = triggerRefs.current.get(pending.id)
    if (trigger) trigger.focus()
    if (trigger || pending.settled) cardFocusRef.current = null
  }, [meals])

  // Restores from the toast's Undo and from Recently deleted. The page's list
  // and the section refetch before it settles, so the restored card is back
  // (with its image) by the time the toast says so.
  const restoreMeal = useMutation({
    mutationFn: ({ mealId }: { mealId: string; focusCard: boolean }) =>
      apiFetch(`/api/households/me/meals/${mealId}/restore`, { method: 'POST' }),
    onMutate: ({ mealId, focusCard }) => {
      cardFocusRef.current = focusCard ? { id: mealId, settled: false } : null
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['meals'] }),
        queryClient.invalidateQueries({ queryKey: recentlyDeletedMealsQueryKey }),
      ])
      const pending = cardFocusRef.current
      const trigger = pending ? triggerRefs.current.get(pending.id) : undefined
      if (trigger) {
        trigger.focus()
        cardFocusRef.current = null
      } else if (pending) {
        pending.settled = true
      }
      toast.success(t('restored'))
    },
    onError: (err) => {
      cardFocusRef.current = null
      // The route's `error` is English (HON-914): log it, render catalog copy.
      console.error(
        '[recipes] restore failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      toast.error(t('restoreFailed'))
    },
  })

  const deleteMeal = useMutation({
    mutationFn: (mealId: string) =>
      apiFetch(`/api/households/me/meals/${mealId}`, { method: 'DELETE' }),
    onSuccess: (_data, mealId) => {
      const index = meals.findIndex((meal) => meal.id === mealId)
      focusTargetIdRef.current = (meals[index + 1] ?? meals[index - 1])?.id ?? null
      onDelete(mealId)
      void queryClient.invalidateQueries({ queryKey: recentlyDeletedMealsQueryKey })
      toast(t('deleted'), {
        action: {
          label: t('undo'),
          onClick: (event) => {
            // Sonner returns focus to where it was before the toast whenever
            // focus leaves the toaster, which would undo the move to the
            // restored card. Leave now, so that return happens first.
            event.currentTarget.blur()
            restoreMeal.mutate({ mealId, focusCard: true })
          },
        },
        duration: 6000,
      })
      setDeleteConfirmMeal(null)
    },
    onError: () => {
      toast.error(t('deleteFailed'))
    },
  })

  const toggleFavorite = useMutation({
    mutationFn: (meal: MealData) =>
      apiFetch(`/api/meals/${meal.id}/favorite`, {
        method: meal.isFavorite ? 'DELETE' : 'POST',
      }),
    onSuccess: (_data, meal) => {
      onToggleFavorite(meal.id, !meal.isFavorite)
      toast.success(meal.isFavorite ? t('removedFromFavorites') : t('addedToFavorites'))
    },
    onError: () => {
      toast.error(t('favoriteUpdateFailed'))
    },
  })

  const handleDelete = () => {
    if (!deleteConfirmMeal) return
    deleteMeal.mutate(deleteConfirmMeal.id)
  }

  const handleCloseAutoFocus = (event: Event) => {
    event.preventDefault()
    const id = focusTargetIdRef.current
    focusTargetIdRef.current = null
    const trigger = id ? triggerRefs.current.get(id) : undefined
    ;(trigger ?? emptyFocusRef?.current)?.focus()
  }

  const recentlyDeleted = showRecentlyDeleted ? (
    <RecentlyDeletedMeals
      onRestore={(mealId, focusCard) => restoreMeal.mutate({ mealId, focusCard })}
      restoringId={restoreMeal.isPending ? restoreMeal.variables.mealId : null}
    />
  ) : null

  if (meals.length === 0) {
    // A household that deleted its last recipe can still bring it back.
    return (
      <>
        <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
          <Body variant="muted">{t('emptyBody')}</Body>
          {emptyAction}
        </div>
        {footer}
        {recentlyDeleted}
      </>
    )
  }

  return (
    <>
      {/* One column on a phone, two from `sm`, three from `lg` (HON-747). The
          columns make the cards taller than wide, so the image sits below the
          content rather than behind it, as in the alternatives grid (HON-750).
          The actions stay on the title row: the heart, and Edit and Delete
          behind one ⋯ menu as on the planner card (docs/DESIGN.md →
          Composition, HON-934). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {meals.map((meal) => (
          <RecipeCard
            key={meal.id}
            meal={meal}
            onOpen={() => {
              setViewedMeal(meal)
              setIsViewOpen(true)
            }}
            titleActions={
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => toggleFavorite.mutate(meal)}
                  disabled={toggleFavorite.isPending && toggleFavorite.variables?.id === meal.id}
                  aria-label={
                    meal.isFavorite ? t('removeFromFavoritesAria') : t('addToFavoritesAria')
                  }
                >
                  <Heart
                    aria-hidden="true"
                    className={cn(meal.isFavorite && 'text-primary fill-current')}
                  />
                </Button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      ref={(el) => {
                        if (!el) return
                        triggerRefs.current.set(meal.id, el)
                        return () => {
                          triggerRefs.current.delete(meal.id)
                        }
                      }}
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('moreActions', { name: meal.name })}
                    >
                      <MoreHorizontal aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {/* A real link, so middle-click and open-in-new-tab work. */}
                    <DropdownMenuItem asChild>
                      <Link href={`/recipes/${meal.id}/edit`}>
                        <Pencil aria-hidden="true" />
                        {t('edit')}
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => {
                        focusTargetIdRef.current = meal.id
                        setDeleteConfirmMeal(meal)
                      }}
                    >
                      <Trash2 aria-hidden="true" />
                      {t('delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            }
          />
        ))}
      </div>

      {footer}
      {recentlyDeleted}

      {viewedMeal && (
        <RecipeDetailModal
          meal={viewedMeal}
          householdServings={householdServings}
          open={isViewOpen}
          onOpenChange={setIsViewOpen}
          history={viewedMeal}
        />
      )}

      <ConfirmDialog
        open={deleteConfirmMeal !== null}
        // Not dismissible while the delete is in flight, like its disabled
        // Cancel: Escape would put focus on the deleting card's trigger, and
        // the card's removal would then drop it to the body.
        onOpenChange={(open) => {
          if (!open && !deleteMeal.isPending) setDeleteConfirmMeal(null)
        }}
        title={t('deleteDialog.title')}
        description={
          deleteConfirmMeal ? t('deleteDialog.description', { name: deleteConfirmMeal.name }) : ''
        }
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('deleteDialog.cancel')}
        loadingLabel={t('deleteDialog.deleting')}
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={deleteMeal.isPending}
        onCloseAutoFocus={handleCloseAutoFocus}
      />
    </>
  )
}
