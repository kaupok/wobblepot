'use client'

import { useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { useMutation } from '@tanstack/react-query'
import { Heart, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/api'
import { MealImageCard, type MealImageFields } from '@/components/meal-plan/MealImageCard'
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
}

interface MealListProps {
  meals: MealData[]
  onDelete: (mealId: string) => void
  onToggleFavorite: (mealId: string, isFavorite: boolean) => void
  /**
   * Takes focus after a delete that leaves no card to land on: the page's
   * search field, or the empty state's action once the search is gone.
   */
  emptyFocusRef?: RefObject<HTMLElement | null>
  /** The empty state's one primary button, under its line. */
  emptyAction?: ReactNode
}

export function MealList({
  meals,
  onDelete,
  onToggleFavorite,
  emptyFocusRef,
  emptyAction,
}: MealListProps) {
  const t = useTranslations('recipes.list')
  const [deleteConfirmMeal, setDeleteConfirmMeal] = useState<MealData | null>(null)
  // The confirm dialog opens from a menu item that is gone by the time it
  // closes, so Radix has no trigger to return focus to (HON-934). These hold
  // each card's ⋯ trigger and the card whose trigger should take focus: the
  // one Delete was chosen on, or after a delete its neighbour.
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>())
  const focusTargetIdRef = useRef<string | null>(null)

  const deleteMeal = useMutation({
    mutationFn: (mealId: string) =>
      apiFetch(`/api/households/me/meals/${mealId}`, { method: 'DELETE' }),
    onSuccess: (_data, mealId) => {
      const index = meals.findIndex((meal) => meal.id === mealId)
      focusTargetIdRef.current = (meals[index + 1] ?? meals[index - 1])?.id ?? null
      onDelete(mealId)
      toast.success(t('deleted'))
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

  if (meals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-12 text-center">
        <Body variant="muted">{t('emptyBody')}</Body>
        {emptyAction}
      </div>
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
          <MealImageCard
            key={meal.id}
            meal={meal}
            layout="bottom"
            // `sm`: the content's own `p-4` is the card's padding; the default
            // `py-6` on top of it doubled the space above the first row.
            size="sm"
            className="flex h-full flex-col"
          >
            <CardContent className="flex-1 p-4">
              {/* h2: the page title is the h1 (HON-747). No ingredient list at
                  any width: uncoloured names only, it doubled a phone card
                  (HON-784) and left an empty band above the image beside a
                  longer list on desktop (HON-819). Edit and the meal detail
                  carry the list with quantities. */}
              <MealCardBase
                meal={meal}
                nameHeadingTag="h2"
                ingredients="never"
                ownRecipe="hide"
                titleActions={
                  <>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => toggleFavorite.mutate(meal)}
                      disabled={
                        toggleFavorite.isPending && toggleFavorite.variables?.id === meal.id
                      }
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
            </CardContent>
          </MealImageCard>
        ))}
      </div>

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
