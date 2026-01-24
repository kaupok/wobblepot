'use client'

import { useState } from 'react'
import {
  Check,
  AlertTriangle,
  ArrowLeft,
  Loader2,
  Clock,
  Users,
  Utensils,
  HelpCircle,
} from 'lucide-react'
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
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'

interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  similarity: number
}

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
  isVague: boolean
  originalPhrase?: string
  similarityScore?: number
  lowConfidence?: boolean
  alternatives?: IngredientAlternative[]
}

interface UnmatchedIngredient {
  type: 'unmatched'
  extractedName: string
  extractedQuantity: number
  extractedUnit: string
  originalText: string
  isVague: boolean
  originalPhrase?: string
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
  // Track disambiguation selections: index -> selected ingredient id (or 'none')
  const [disambiguationSelections, setDisambiguationSelections] = useState<
    Record<number, string | null>
  >({})

  const matchedCount = recipe.ingredients.filter((i) => i.type === 'matched').length
  const unmatchedCount = recipe.ingredients.filter((i) => i.type === 'unmatched').length
  const lowConfidenceCount = recipe.ingredients.filter(
    (i) => i.type === 'matched' && i.lowConfidence,
  ).length

  // Check if all low-confidence matches have been resolved
  const unresolvedDisambiguations = recipe.ingredients
    .map((ingredient, index) => ({ ingredient, index }))
    .filter(
      ({ ingredient, index }) =>
        ingredient.type === 'matched' &&
        ingredient.lowConfidence &&
        disambiguationSelections[index] === undefined,
    )

  const hasUnresolvedDisambiguations = unresolvedDisambiguations.length > 0

  // Check if any disambiguation was set to "none" (marking as unmatched)
  const disambiguatedAsUnmatched = Object.entries(disambiguationSelections).filter(
    ([, value]) => value === 'none',
  ).length

  // Recipe can be confirmed if all matched, no unresolved disambiguations,
  // and no ingredients marked as "none"
  const canConfirm =
    recipe.allMatched && !hasUnresolvedDisambiguations && disambiguatedAsUnmatched === 0

  const handleDisambiguationSelect = (ingredientIndex: number, selectedId: string) => {
    setDisambiguationSelections((prev) => ({
      ...prev,
      [ingredientIndex]: selectedId,
    }))
  }

  const handleConfirm = async () => {
    if (!canConfirm) {
      return
    }

    setError('')
    setIsCreating(true)

    try {
      // Build the components array from matched ingredients
      // Apply disambiguation selections where applicable
      const components = recipe.ingredients
        .map((ingredient, index) => {
          if (ingredient.type !== 'matched') return null

          // Check if this ingredient was disambiguated to a different option
          const disambiguationSelection = disambiguationSelections[index]

          // If disambiguation was resolved, use the selected alternative
          if (disambiguationSelection && disambiguationSelection !== 'none') {
            const selectedAlt = ingredient.alternatives?.find(
              (alt) => alt.id === disambiguationSelection,
            )
            if (selectedAlt) {
              return {
                ingredientId: selectedAlt.id,
                totalQuantity: ingredient.convertedQuantity,
                isVague: ingredient.isVague,
                originalPhrase: ingredient.originalPhrase ?? null,
              }
            }
          }

          // Use original match
          return {
            ingredientId: ingredient.ingredient.id,
            totalQuantity: ingredient.convertedQuantity,
            isVague: ingredient.isVague,
            originalPhrase: ingredient.originalPhrase ?? null,
          }
        })
        .filter((c): c is NonNullable<typeof c> => c !== null)

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

  const getIngredientDisplayName = (ingredient: MatchedIngredient, index: number): string => {
    const disambiguationSelection = disambiguationSelections[index]
    if (disambiguationSelection && disambiguationSelection !== 'none') {
      const selectedAlt = ingredient.alternatives?.find((alt) => alt.id === disambiguationSelection)
      if (selectedAlt) {
        return selectedAlt.name
      }
    }
    return ingredient.ingredient.name
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
            Check the extracted information before {canConfirm ? 'confirming' : 'editing'}
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
                {lowConfidenceCount > 0 && (
                  <Badge variant="outline" className="text-blue-600">
                    <HelpCircle className="mr-1 h-3 w-3" />
                    {lowConfidenceCount} to verify
                  </Badge>
                )}
                {unmatchedCount > 0 && (
                  <Badge variant="outline" className="text-amber-600">
                    <AlertTriangle className="mr-1 h-3 w-3" />
                    {unmatchedCount} unmatched
                  </Badge>
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              {recipe.ingredients.map((ingredient, index) => {
                // Determine the styling based on state
                const isMatched = ingredient.type === 'matched'
                const isLowConfidence = isMatched && ingredient.lowConfidence
                const isDisambiguated = disambiguationSelections[index] !== undefined
                const isDisambiguatedAsNone = disambiguationSelections[index] === 'none'

                let borderClass = ''
                let bgClass = ''

                if (isDisambiguatedAsNone) {
                  // User selected "none" - treat as unmatched
                  borderClass = 'border-amber-200 dark:border-amber-900'
                  bgClass = 'bg-amber-50/50 dark:bg-amber-950/20'
                } else if (!isMatched) {
                  // Unmatched
                  borderClass = 'border-amber-200 dark:border-amber-900'
                  bgClass = 'bg-amber-50/50 dark:bg-amber-950/20'
                } else if (isLowConfidence && !isDisambiguated) {
                  // Low confidence, needs disambiguation
                  borderClass = 'border-blue-200 dark:border-blue-900'
                  bgClass = 'bg-blue-50/50 dark:bg-blue-950/20'
                } else {
                  // Matched (high confidence or disambiguated)
                  borderClass = 'border-green-200 dark:border-green-900'
                  bgClass = 'bg-green-50/50 dark:bg-green-950/20'
                }

                return (
                  <div
                    key={index}
                    className={`flex flex-col gap-2 rounded-md border p-3 ${borderClass} ${bgClass}`}
                  >
                    <div className="flex items-center gap-3">
                      {isDisambiguatedAsNone ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      ) : !isMatched ? (
                        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                      ) : isLowConfidence && !isDisambiguated ? (
                        <HelpCircle className="h-4 w-4 shrink-0 text-blue-600" />
                      ) : (
                        <Check className="h-4 w-4 shrink-0 text-green-600" />
                      )}
                      <div className="flex-1">
                        {ingredient.type === 'matched' ? (
                          <div className="flex flex-col gap-0.5">
                            <Body
                              className={isDisambiguatedAsNone ? 'text-amber-700 line-through' : ''}
                            >
                              {getIngredientDisplayName(ingredient, index)}
                            </Body>
                            <Body variant="muted">
                              {ingredient.isVague && ingredient.originalPhrase ? (
                                <span className="italic">{ingredient.originalPhrase}</span>
                              ) : (
                                <>
                                  {Math.round(
                                    (ingredient.convertedQuantity / recipe.servings) * 10,
                                  ) / 10}
                                  {formatUnit(ingredient.ingredient.defaultUnit)} per serving
                                </>
                              )}
                            </Body>
                          </div>
                        ) : (
                          <div className="flex flex-col gap-0.5">
                            <Body className="text-amber-700 dark:text-amber-400">
                              {ingredient.extractedName}
                            </Body>
                            <Body variant="muted">
                              {ingredient.isVague && ingredient.originalPhrase ? (
                                <span className="italic">{ingredient.originalPhrase}</span>
                              ) : (
                                <>Original: {ingredient.originalText}</>
                              )}
                            </Body>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Disambiguation UI for low-confidence matches */}
                    {isMatched && isLowConfidence && ingredient.alternatives && (
                      <div className="mt-2 ml-7">
                        <Body variant="small" className="mb-2 text-blue-700 dark:text-blue-400">
                          Which ingredient did you mean by &quot;{ingredient.extractedName}&quot;?
                        </Body>
                        <RadioGroup
                          value={disambiguationSelections[index] ?? ''}
                          onValueChange={(value) => handleDisambiguationSelect(index, value)}
                          className="flex flex-col gap-1.5"
                        >
                          {ingredient.alternatives.map((alt) => (
                            <div key={alt.id} className="flex items-center space-x-2">
                              <RadioGroupItem value={alt.id} id={`${index}-${alt.id}`} />
                              <Label
                                htmlFor={`${index}-${alt.id}`}
                                className="cursor-pointer text-sm font-normal"
                              >
                                {alt.name}
                              </Label>
                            </div>
                          ))}
                          <div className="flex items-center space-x-2">
                            <RadioGroupItem value="none" id={`${index}-none`} />
                            <Label
                              htmlFor={`${index}-none`}
                              className="text-muted-foreground cursor-pointer text-sm font-normal"
                            >
                              None of these — skip this ingredient
                            </Label>
                          </div>
                        </RadioGroup>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {unmatchedCount > 0 && (
              <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
                <Body variant="small" className="text-amber-700 dark:text-amber-400">
                  {unmatchedCount} ingredient{unmatchedCount === 1 ? '' : 's'} couldn&apos;t be
                  matched to our database. Click &quot;Edit recipe&quot; to resolve.
                </Body>
              </div>
            )}

            {hasUnresolvedDisambiguations && (
              <div className="rounded-md bg-blue-50 p-3 dark:bg-blue-950/30">
                <Body variant="small" className="text-blue-700 dark:text-blue-400">
                  {unresolvedDisambiguations.length} ingredient
                  {unresolvedDisambiguations.length === 1 ? ' needs' : 's need'} verification.
                  Please select the correct option above.
                </Body>
              </div>
            )}

            {disambiguatedAsUnmatched > 0 && (
              <div className="rounded-md bg-amber-50 p-3 dark:bg-amber-950/30">
                <Body variant="small" className="text-amber-700 dark:text-amber-400">
                  {disambiguatedAsUnmatched} ingredient
                  {disambiguatedAsUnmatched === 1 ? ' was' : 's were'} marked as &quot;none of
                  these&quot;. Click &quot;Edit recipe&quot; to search for the correct ingredient.
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
          <Button onClick={handleConfirm} disabled={!canConfirm || isCreating} className="flex-1">
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : canConfirm ? (
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
