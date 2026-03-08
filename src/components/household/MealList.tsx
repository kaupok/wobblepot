'use client'

import { useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Pencil, Trash2, Heart } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Body } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { cn } from '@/lib/utils'
import type { IngredientCategory, MealType, ProteinType, Unit } from '@/generated/prisma/enums'

export interface MealData {
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
        throw new Error('Failed to delete meal')
      }

      onDelete(deleteConfirmMeal.id)
      toast.success('Meal deleted')
      setDeleteConfirmMeal(null)
    } catch {
      toast.error('Failed to delete meal')
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
        throw new Error('Failed to update favorite')
      }

      onToggleFavorite(meal.id, !meal.isFavorite)
      toast.success(meal.isFavorite ? 'Removed from favorites' : 'Added to favorites')
    } catch {
      toast.error('Failed to update favorite')
    } finally {
      setTogglingFavorite(null)
    }
  }

  if (meals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Body variant="muted">No meals yet</Body>
        <Body variant="muted">Create your first custom meal to get started</Body>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {meals.map((meal) => (
        <Card key={meal.id}>
          <CardContent className="p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <MealCardBase meal={meal} />
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleToggleFavorite(meal)}
                  disabled={togglingFavorite === meal.id}
                  aria-label={meal.isFavorite ? 'Remove from favorites' : 'Add to favorites'}
                >
                  <Heart
                    className={cn('h-4 w-4', meal.isFavorite && 'fill-red-500 text-red-500')}
                  />
                </Button>
                <Button variant="ghost" size="sm" asChild aria-label="Edit meal">
                  <Link href={`/recipes/${meal.id}/edit`}>
                    <Pencil className="h-4 w-4" />
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmMeal(meal)}
                  aria-label="Delete meal"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={deleteConfirmMeal !== null}
        onOpenChange={(open) => !open && setDeleteConfirmMeal(null)}
        title="Delete meal"
        description={
          deleteConfirmMeal
            ? `Are you sure you want to delete "${deleteConfirmMeal.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loadingLabel="Deleting..."
        variant="destructive"
        onConfirm={handleDelete}
        isLoading={isDeleting}
      />
    </div>
  )
}
