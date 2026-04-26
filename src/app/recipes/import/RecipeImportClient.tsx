'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Sparkles, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import type { IngredientCategory, MealType, Unit } from '@/generated/prisma/enums'
import type { PrefilledIngredient } from '@/components/household/MealForm'

// Types for the parsed recipe response from the API
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
    calories?: number
    protein?: number
    carbs?: number
    fat?: number
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

interface ParsedRecipeData {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  ingredients: IngredientMatchResult[]
  allMatched: boolean
}

// Convert parsed recipe to prefilled format for MealForm
function convertToPrefilledData(recipe: ParsedRecipeData): {
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
  const prefilledIngredients: PrefilledIngredient[] = recipe.ingredients.map((ingredient) => {
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

    // Low-confidence match with alternatives
    if (ingredient.lowConfidence && ingredient.alternatives) {
      return {
        type: 'low-confidence' as const,
        ingredient: {
          id: ingredient.ingredient.id,
          name: ingredient.ingredient.name,
          category: ingredient.ingredient.category,
          defaultUnit: ingredient.ingredient.defaultUnit,
          gramsPerPiece: ingredient.ingredient.gramsPerPiece,
          calories: ingredient.ingredient.calories,
          protein: ingredient.ingredient.protein,
          carbs: ingredient.ingredient.carbs,
          fat: ingredient.ingredient.fat,
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

    // High-confidence match
    return {
      type: 'matched' as const,
      ingredient: {
        id: ingredient.ingredient.id,
        name: ingredient.ingredient.name,
        category: ingredient.ingredient.category,
        defaultUnit: ingredient.ingredient.defaultUnit,
        gramsPerPiece: ingredient.ingredient.gramsPerPiece,
        calories: ingredient.ingredient.calories,
        protein: ingredient.ingredient.protein,
        carbs: ingredient.ingredient.carbs,
        fat: ingredient.ingredient.fat,
      },
      convertedQuantity: ingredient.convertedQuantity,
      isVague: ingredient.isVague,
      originalPhrase: ingredient.originalPhrase,
    }
  })

  return {
    name: recipe.name,
    description: recipe.description,
    preparationNotes: recipe.preparationNotes,
    sourceUrl: recipe.sourceUrl,
    timeMinutes: recipe.timeMinutes,
    servings: recipe.servings,
    mealTypes: recipe.mealTypes,
    kidFriendly: recipe.kidFriendly,
    prefilledIngredients,
  }
}

function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim()) || /^www\./i.test(text.trim())
}

const URL_STEPS = ['Fetching page...', 'Extracting recipe...', 'Matching ingredients...']
const TEXT_STEPS = ['Extracting recipe...', 'Matching ingredients...']
const URL_STEP_DELAYS = [0, 4000, 10000]
const TEXT_STEP_DELAYS = [0, 4000]

export function RecipeImportClient() {
  const router = useRouter()
  const [recipeText, setRecipeText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')
  const [progressStep, setProgressStep] = useState('')
  const [stepVisible, setStepVisible] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const [warning, setWarning] = useState<{
    message: string
    recipe: ParsedRecipeData
  } | null>(null)

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const navigateToCreate = (recipe: ParsedRecipeData) => {
    const prefilledData = convertToPrefilledData(recipe)
    sessionStorage.setItem(
      'prefilled-meal',
      JSON.stringify({ ...prefilledData, originalRecipeText: recipeText }),
    )
    router.push('/recipes/create?prefilled=true')
  }

  useEffect(() => {
    if (!isParsing) {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
      setStepVisible(false)
      // Small delay before clearing text so fade-out completes
      const clearTimer = setTimeout(() => setProgressStep(''), 150)
      return () => clearTimeout(clearTimer)
    }

    const steps = isUrl(recipeText) ? URL_STEPS : TEXT_STEPS
    const delays = isUrl(recipeText) ? URL_STEP_DELAYS : TEXT_STEP_DELAYS

    // Show first step immediately
    setProgressStep(steps[0]!)
    setStepVisible(true)

    // Set up fade transitions for subsequent steps
    for (let i = 1; i < steps.length; i++) {
      const step = steps[i]!
      const delay = delays[i]!
      const timer = setTimeout(() => {
        setStepVisible(false)
        const swapTimer = setTimeout(() => {
          setProgressStep(step)
          setStepVisible(true)
        }, 150)
        timersRef.current.push(swapTimer)
      }, delay)
      timersRef.current.push(timer)
    }

    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
  }, [isParsing]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsParsing(false)
  }

  const handleParse = async () => {
    if (!recipeText.trim()) {
      setError('Please paste a recipe or URL first')
      return
    }

    setError('')
    setWarning(null)
    setIsParsing(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      const response = await fetch('/api/recipes/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: recipeText }),
        signal: controller.signal,
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to parse recipe')
        return
      }

      // `recipe:imported` fires when the user actually saves the recipe to
      // their library on `/recipes/create` (see `CreateRecipeClient`), not
      // when the parse succeeds. Counting parses inflates the activation
      // metric with abandoned attempts.

      // Handle medium confidence — show warning with options
      if (data.confidenceTier === 'medium') {
        setWarning({
          message:
            data.confidenceWarning ||
            "We're not confident this is a complete recipe. The results may be incomplete.",
          recipe: data.recipe,
        })
        return
      }

      navigateToCreate(data.recipe)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      setError('Failed to parse recipe. Please try again.')
    } finally {
      abortControllerRef.current = null
      setIsParsing(false)
    }
  }

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="-ml-2">
              <Link href="/recipes">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Heading variant="h4">Import recipe</Heading>
          </div>
          <Body variant="muted">
            Paste a recipe or drop a URL and we&apos;ll extract the ingredients for you. Include how
            many servings it makes, otherwise we&apos;ll assume 4.
          </Body>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Textarea
              value={recipeText}
              onChange={(e) => {
                setRecipeText(e.target.value)
                setError('')
                setWarning(null)
              }}
              placeholder={`Paste a recipe or URL here...\n\nExamples:\nhttps://example.com/chicken-stir-fry\n\nOr paste recipe text directly:\nChicken Stir Fry (serves 4)\n- 500g chicken breast\n- 2 tbsp soy sauce\n- 1 red bell pepper`}
              rows={12}
              className="resize-none"
              disabled={isParsing}
            />
            {error && (
              <Body variant="small" className="text-destructive">
                {error}
              </Body>
            )}
            {warning && (
              <div className="rounded-md border border-yellow-500/50 bg-yellow-50 p-4 dark:bg-yellow-950/20">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600 dark:text-yellow-500" />
                  <div className="flex flex-col gap-3">
                    <Body variant="small" className="text-yellow-800 dark:text-yellow-200">
                      {warning.message}
                    </Body>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigateToCreate(warning.recipe)}
                      >
                        Continue anyway
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setWarning(null)
                          setRecipeText('')
                        }}
                      >
                        Try different text
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            onClick={handleParse}
            disabled={isParsing || !recipeText.trim()}
            className="w-full"
          >
            {isParsing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span
                  className="transition-opacity duration-150"
                  style={{ opacity: stepVisible ? 1 : 0 }}
                >
                  {progressStep || 'Importing recipe...'}
                </span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Import recipe
              </>
            )}
          </Button>
          {isParsing ? (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              Cancel
            </Button>
          ) : (
            <Body variant="muted" className="text-center">
              or{' '}
              <Link href="/recipes/create" className="text-primary underline">
                create manually
              </Link>
            </Body>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
