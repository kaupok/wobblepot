'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Trash2, Heart, Clock, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Body, Heading } from '@/components/ui/typography'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { cn } from '@/lib/utils'
import type { IngredientCategory, MealType, ProteinType, Unit } from '@/generated/prisma/enums'

export interface MealData {
  id: string
  name: string
  description?: string | null
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
  onEdit: (meal: MealData) => void
  onDelete: (mealId: string) => void
  onToggleFavorite: (mealId: string, isFavorite: boolean) => void
}

function formatMealTypes(types: MealType[]): string {
  return types.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
}

function formatProteinType(type: ProteinType): string {
  if (type === 'none') return 'No protein'
  return type.charAt(0).toUpperCase() + type.slice(1)
}

export function MealList({ meals, onEdit, onDelete, onToggleFavorite }: MealListProps) {
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
                <div className="flex items-center gap-2">
                  <Heading variant="h4">{meal.name}</Heading>
                  {meal.kidFriendly && (
                    <Badge variant="secondary" className="text-xs">
                      <Users className="mr-1 h-3 w-3" />
                      Kid-friendly
                    </Badge>
                  )}
                </div>

                {meal.description && (
                  <Body variant="muted" className="mt-1">
                    {meal.description}
                  </Body>
                )}

                <div className="mt-2 flex flex-wrap items-center gap-3">
                  {meal.timeMinutes && (
                    <Body variant="small" className="text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {meal.timeMinutes} min
                    </Body>
                  )}
                  <Body variant="small" className="text-muted-foreground">
                    {formatMealTypes(meal.suitableFor)}
                  </Body>
                  <Body variant="small" className="text-muted-foreground">
                    {formatProteinType(meal.primaryProteinType)}
                  </Body>
                </div>

                <div className="mt-2 flex flex-wrap gap-1">
                  {meal.components.slice(0, 5).map((comp) => (
                    <Badge key={comp.ingredientId} variant="outline" className="text-xs">
                      {comp.ingredient.name}
                    </Badge>
                  ))}
                  {meal.components.length > 5 && (
                    <Badge variant="outline" className="text-xs">
                      +{meal.components.length - 5} more
                    </Badge>
                  )}
                </div>

                <div className="mt-2 flex items-center gap-4 text-xs">
                  <span className="text-muted-foreground">{meal.nutrition.calories} kcal</span>
                  <span className="text-muted-foreground">{meal.nutrition.protein}g protein</span>
                  <span className="text-muted-foreground">{meal.nutrition.carbs}g carbs</span>
                  <span className="text-muted-foreground">{meal.nutrition.fat}g fat</span>
                </div>

                {meal.allergens.length > 0 && (
                  <div className="mt-2 flex items-center gap-1">
                    <Body variant="small" className="text-destructive">
                      Contains:
                    </Body>
                    {meal.allergens.map((allergen) => (
                      <Badge key={allergen} variant="destructive" className="text-xs">
                        {allergen}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center gap-1">
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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(meal)}
                  aria-label="Edit meal"
                >
                  <Pencil className="h-4 w-4" />
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
