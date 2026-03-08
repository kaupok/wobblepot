'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import { MealCardBase, type MealCardBaseData } from '@/components/meal-plan/MealCardBase'
import { Skeleton } from '@/components/ui/skeleton'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import type { PrefilledIngredient } from '@/components/household/MealForm'

interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
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

interface ImaginedMealResponse {
  id: string
  name: string
  description: string | null
  timeMinutes: number | null
  servings: number
  suitableFor: MealType[]
  kidFriendly: boolean
  primaryProteinType: string
  components: MealCardBaseData['components']
  nutrition: MealCardBaseData['nutrition']
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

function convertToPrefilledData(meal: ImaginedMealResponse): {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  prefilledIngredients: PrefilledIngredient[]
} {
  const prefilledIngredients: PrefilledIngredient[] = meal.ingredients.map((ingredient) => {
    if (ingredient.type === 'unmatched') {
      return {
        type: 'unmatched' as const,
        extractedName: ingredient.extractedName,
        originalText: ingredient.originalText,
        extractedQuantity: ingredient.extractedQuantity,
        extractedUnit: ingredient.extractedUnit,
        isVague: ingredient.isVague,
        originalPhrase: ingredient.originalPhrase,
      }
    }

    if (ingredient.lowConfidence && ingredient.alternatives) {
      return {
        type: 'low-confidence' as const,
        ingredient: {
          id: ingredient.ingredient.id,
          name: ingredient.ingredient.name,
          category: ingredient.ingredient.category,
          defaultUnit: ingredient.ingredient.defaultUnit,
        },
        convertedQuantity: ingredient.convertedQuantity,
        isVague: ingredient.isVague,
        originalPhrase: ingredient.originalPhrase,
        lowConfidence: true,
        alternatives: ingredient.alternatives,
        extractedName: ingredient.extractedName,
        originalText: ingredient.originalText,
      }
    }

    return {
      type: 'matched' as const,
      ingredient: {
        id: ingredient.ingredient.id,
        name: ingredient.ingredient.name,
        category: ingredient.ingredient.category,
        defaultUnit: ingredient.ingredient.defaultUnit,
      },
      convertedQuantity: ingredient.convertedQuantity,
      isVague: ingredient.isVague,
      originalPhrase: ingredient.originalPhrase,
    }
  })

  return {
    name: meal.name,
    description: meal.description,
    preparationNotes: null,
    sourceUrl: null,
    timeMinutes: meal.timeMinutes,
    servings: meal.servings,
    mealTypes: meal.suitableFor,
    kidFriendly: meal.kidFriendly,
    prefilledIngredients,
  }
}

function SkeletonCard() {
  return (
    <Card className="flex h-full flex-col">
      <CardContent className="flex-1 p-4 pb-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <div className="mt-1 flex gap-2">
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-8 w-16" />
          </div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-4 w-32" />
          <div className="mt-1 flex flex-col gap-1">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Skeleton className="h-10 w-full" />
      </CardFooter>
    </Card>
  )
}

export function ImagineClient() {
  const router = useRouter()
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [reviewingMealId, setReviewingMealId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [meals, setMeals] = useState<ImaginedMealResponse[] | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const navigateToCreate = async (meal: ImaginedMealResponse) => {
    setReviewingMealId(meal.id)

    let finalMeal = meal
    try {
      const reviewPayload = {
        mealName: meal.name,
        servings: meal.servings,
        ingredients: meal.components.map((comp) => ({
          ingredientId: comp.ingredientId,
          name: comp.ingredient.name,
          quantityPerServing: comp.quantityPerServing,
          unit: comp.ingredient.defaultUnit,
        })),
      }

      const response = await fetch('/api/meals/imagine/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reviewPayload),
      })

      if (response.ok) {
        const data = await response.json()
        if (data.success && data.ingredients) {
          const correctionMap = new Map<string, number>(
            data.ingredients.map((ing: { ingredientId: string; quantityPerServing: number }) => [
              ing.ingredientId,
              ing.quantityPerServing,
            ]),
          )

          finalMeal = {
            ...meal,
            components: meal.components.map((comp) => {
              const corrected = correctionMap.get(comp.ingredientId)
              return corrected != null ? { ...comp, quantityPerServing: corrected } : comp
            }),
            ingredients: meal.ingredients.map((ing) => {
              if (ing.type !== 'matched') return ing
              const corrected = correctionMap.get(ing.ingredient.id)
              return corrected != null
                ? { ...ing, convertedQuantity: corrected * meal.servings }
                : ing
            }),
          }
        }
      }
    } catch {
      // Graceful degradation: proceed with original quantities
    }

    setReviewingMealId(null)
    const prefilledData = convertToPrefilledData(finalMeal)
    sessionStorage.setItem('prefilled-meal', JSON.stringify(prefilledData))
    router.push('/recipes?mode=create&prefilled=true')
  }

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
  }

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe what kind of meal you want')
      return
    }

    setError('')
    setMeals(null)
    setIsGenerating(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/meals/imagine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt.trim() }),
        signal: controller.signal,
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || data.message || 'Failed to generate meal ideas')
        return
      }

      setMeals(data.meals)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      setError('Failed to generate meal ideas. Please try again.')
    } finally {
      abortControllerRef.current = null
      setIsGenerating(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <div className="w-full max-w-4xl">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" asChild className="-ml-2">
                <Link href="/recipes">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <CardTitle>
                <Heading variant="h2">Imagine a meal</Heading>
              </CardTitle>
            </div>
            <CardDescription>
              <Body variant="muted">
                Describe what you&apos;re in the mood for and we&apos;ll suggest 3 meal ideas.
              </Body>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <Textarea
                value={prompt}
                onChange={(e) => {
                  setPrompt(e.target.value)
                  setError('')
                }}
                placeholder="Something healthy with chicken and a fresh salad..."
                rows={3}
                className="resize-none"
                disabled={isGenerating}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleGenerate()
                  }
                }}
              />
              {error && (
                <Body variant="small" className="text-destructive">
                  {error}
                </Body>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Button
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating ideas...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Imagine meals
                </>
              )}
            </Button>
            {isGenerating && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
            )}
          </CardFooter>
        </Card>

        {/* Results: skeleton cards while loading, real cards when done */}
        {(isGenerating || meals) && (
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {isGenerating
              ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
              : meals?.map((meal) => (
                  <Card key={meal.id} className="flex h-full flex-col">
                    <CardContent className="flex-1 p-4 pb-2">
                      <MealCardBase meal={meal} />
                    </CardContent>
                    <CardFooter className="p-4 pt-0">
                      <Button
                        className="w-full"
                        onClick={() => navigateToCreate(meal)}
                        disabled={reviewingMealId !== null}
                      >
                        {reviewingMealId === meal.id ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Fine-tuning recipe...
                          </>
                        ) : (
                          'Select'
                        )}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
          </div>
        )}
      </div>
    </div>
  )
}
