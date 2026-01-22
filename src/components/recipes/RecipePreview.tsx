'use client'

import { useState } from 'react'
import { Check, AlertTriangle, ArrowLeft, Loader2, Clock, Users, Utensils } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Heading, Body } from '@/components/ui/typography'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

interface MatchedIngredient {
  type: 'matched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  ingredient: {
    id: string
    name: string
    category: IngredientCategory
    defaultUnit: Unit
    gramsPerPiece: number | null
  }
  convertedQuantity: number
}

interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
}

type IngredientMatchResult = MatchedIngredient | UnmatchedIngredient

export interface ParsedRecipeData {
  name: string
  description: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

interface RecipePreviewProps {
  recipe: ParsedRecipeData
  onConfirm: () => void
  onEdit: (data: ParsedRecipeData) => void
  onBack: () => void
}

function formatUnit(unit: Unit): string {
  return unit === 'g' ? 'g' : ''
}

function formatMealType(mealType: MealType): string {
  return mealType.charAt(0).toUpperCase() + mealType.slice(1)
}

export function RecipePreview({ recipe, onConfirm, onEdit, onBack }: RecipePreviewProps) {
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')

  const matchedCount = recipe.ingredients.filter((i) => i.type === 'matched').length
  const unmatchedCount = recipe.ingredients.filter((i) => i.type === 'unmatched').length

  const handleConfirm = async () => {
    if (!recipe.allMatched) {
      return
    }

    setError('')
    setIsCreating(true)

    try {
      // Build the components array from matched ingredients
      const components = recipe.ingredients
        .filter((i): i is MatchedIngredient => i.type === 'matched')
        .map((i) => ({
          ingredientId: i.ingredient.id,
          totalQuantity: i.convertedQuantity * recipe.servings,
        }))

      const response = await fetch('/api/households/me/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: recipe.name,
          description: recipe.description,
          timeMinutes: recipe.timeMinutes,
          kidFriendly: recipe.kidFriendly,
          suitableFor: recipe.mealTypes,
          servings: recipe.servings,
          components,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create meal')
      }

      onConfirm()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create meal')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onBack}
            className="-ml-2"
            disabled={isCreating}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <CardTitle>
            <Heading variant="h2">Review recipe</Heading>
          </CardTitle>
        </div>
        <CardDescription>
          <Body variant="muted">
            Check the extracted information before {recipe.allMatched ? 'confirming' : 'editing'}
          </Body>
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-6">
          {/* Basic Info */}
          <section className="flex flex-col gap-3">
            <Heading variant="h3">{recipe.name}</Heading>
            {recipe.description && <Body variant="muted">{recipe.description}</Body>}

            <div className="flex flex-wrap gap-3">
              {recipe.timeMinutes && (
                <div className="flex items-center gap-1.5">
                  <Clock className="text-muted-foreground h-4 w-4" />
                  <Body variant="small">{recipe.timeMinutes} min</Body>
                </div>
              )}
              <div className="flex items-center gap-1.5">
                <Users className="text-muted-foreground h-4 w-4" />
                <Body variant="small">{recipe.servings} servings</Body>
              </div>
              <div className="flex items-center gap-1.5">
                <Utensils className="text-muted-foreground h-4 w-4" />
                <Body variant="small">{recipe.mealTypes.map(formatMealType).join(', ')}</Body>
              </div>
            </div>

            {recipe.kidFriendly && (
              <Badge variant="secondary" className="w-fit">
                Kid-friendly
              </Badge>
            )}
          </section>

          {/* Ingredients Summary */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <Heading variant="h4">Ingredients</Heading>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-green-600">
                  <Check className="mr-1 h-3 w-3" />
                  {matchedCount} matched
                </Badge>
                {unmatchedCount > 0 && (
                  <Badge variant="outline" className="text-amber-600">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {unmatchedCount} unmatched
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {recipe.ingredients.map((ingredient, index) => (
                <div
                  key={index}
                  className={`flex items-center gap-3 rounded-md border p-3 ${
                    ingredient.type === 'matched'
                      ? 'border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20'
                      : 'border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20'
                  }`}
                >
                  {ingredient.type === 'matched' ? (
                    <Check className="h-4 w-4 shrink-0 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  )}
                  <div className="flex-1">
                    {ingredient.type === 'matched' ? (
                      <div className="flex flex-col gap-0.5">
                        <Body>{ingredient.ingredient.name}</Body>
                        <Body variant="muted">
                          {Math.round(ingredient.convertedQuantity * 10) / 10}
                          {formatUnit(ingredient.ingredient.defaultUnit)} per serving
                        </Body>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <Body className="text-amber-700 dark:text-amber-400">
                          {ingredient.extractedName}
                        </Body>
                        <Body variant="muted">Original: {ingredient.originalText}</Body>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {unmatchedCount > 0 && (
              <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
                <Body variant="small" className="text-amber-700 dark:text-amber-400">
                  {unmatchedCount} ingredient{unmatchedCount === 1 ? '' : 's'} couldn&apos;t be
                  matched to our database. Click &quot;Edit recipe&quot; to resolve.
                </Body>
              </div>
            )}
          </section>

          {error && (
            <Body variant="small" className="text-destructive">
              {error}
            </Body>
          )}
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex w-full gap-2">
          <Button
            variant="outline"
            onClick={() => onEdit(recipe)}
            disabled={isCreating}
            className="flex-1"
          >
            Edit recipe
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!recipe.allMatched || isCreating}
            className="flex-1"
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : recipe.allMatched ? (
              'Confirm & create'
            ) : (
              'Resolve issues first'
            )}
          </Button>
        </div>
      </CardFooter>
    </Card>
  )
}
