'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Pencil, Trash2, Heart } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { cn } from '@/lib/utils'
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
}

export function MealList({ meals, onDelete, onToggleFavorite }: MealListProps) {
  const t = useTranslations('recipes.list')
  const [deleteConfirmMeal, setDeleteConfirmMeal] = useState<MealData | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [togglingFavorite, setTogglingFavorite] = useState<string | null>(null)

  const handleDelete = async () => {
    if (!deleteConfirmMeal) return
    setIsDeleting(true)
    try {
      const response = await fetch(`/api/households/me/meals/${deleteConfirmMeal.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('delete-failed')
      }

      onDelete(deleteConfirmMeal.id)
      toast.success(t('deleted'))
      setDeleteConfirmMeal(null)
    } catch {
      toast.error(t('deleteFailed'))
    } finally {
      setIsDeleting(false)
    }
  }

  const handleToggleFavorite = async (meal: MealData) => {
    setTogglingFavorite(meal.id)
    try {
      const method = meal.isFavorite ? 'DELETE' : 'POST'
      const response = await fetch(`/api/meals/${meal.id}/favorite`, {
        method,
      })

      if (!response.ok) {
        throw new Error('favorite-failed')
      }

      onToggleFavorite(meal.id, !meal.isFavorite)
      toast.success(meal.isFavorite ? t('removedFromFavorites') : t('addedToFavorites'))
    } catch {
      toast.error(t('favoriteUpdateFailed'))
    } finally {
      setTogglingFavorite(null)
    }
  }

  if (meals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Body variant="muted">{t('emptyHeading')}</Body>
        <Body variant="muted">{t('emptyBody')}</Body>
      </div>
    )
  }

  return (
    <>
      {/* One column on a phone, two from `sm`, three from `lg` (HON-747). The
          columns make the cards taller than wide, so the image sits below the
          content rather than behind it, as in the alternatives grid (HON-750).
          The actions stay on the title row (docs/DESIGN.md → Composition). */}
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
              {/* h2: the page title is the h1 (HON-747). No ingredient list on a
                  phone: uncoloured names only, and it doubled the card (HON-784) */}
              <MealCardBase
                meal={meal}
                nameHeadingTag="h2"
                ingredients="md-up"
                titleActions={
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleFavorite(meal)}
                      disabled={togglingFavorite === meal.id}
                      aria-label={
                        meal.isFavorite ? t('removeFromFavoritesAria') : t('addToFavoritesAria')
                      }
                    >
                      <Heart
                        className={cn('h-4 w-4', meal.isFavorite && 'text-primary fill-current')}
                      />
                    </Button>
                    <Button variant="ghost" size="sm" asChild aria-label={t('editAria')}>
                      <Link href={`/recipes/${meal.id}/edit`}>
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setDeleteConfirmMeal(meal)}
                      aria-label={t('deleteAria')}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                }
              />
            </CardContent>
          </MealImageCard>
        ))}
      </div>

      <ConfirmDialog
        open={deleteConfirmMeal !== null}
        onOpenChange={(open) => !open && setDeleteConfirmMeal(null)}
        title={t('deleteDialog.title')}
        description={
          deleteConfirmMeal ? t('deleteDialog.description', { name: deleteConfirmMeal.name }) : ''
        }
        confirmLabel={t('deleteDialog.confirm')}
        cancelLabel={t('deleteDialog.cancel')}
        loadingLabel={t('deleteDialog.deleting')}
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </>
  )
}
