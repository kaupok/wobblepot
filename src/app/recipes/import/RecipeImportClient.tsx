'use client'

import { useState } from 'react'
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
        },
        convertedQuantity: ingredient.convertedQuantity,
        isVague: ingredient.isVague,
        originalPhrase: ingredient.originalPhrase,
        lowConfidence: true,
        alternatives: ingredient.alternatives,
        extractedName: ingredient.extractedName,
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
      },
      convertedQuantity: ingredient.convertedQuantity,
      isVague: ingredient.isVague,
      originalPhrase: ingredient.originalPhrase,
    }
  })

  return {
    name: recipe.name,
    description: recipe.description,
    timeMinutes: recipe.timeMinutes,
    servings: recipe.servings,
    mealTypes: recipe.mealTypes,
    kidFriendly: recipe.kidFriendly,
    prefilledIngredients,
  }
}

export function RecipeImportClient() {
  const router = useRouter()
  const [recipeText, setRecipeText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')

  const handleParse = async () => {
    if (!recipeText.trim()) {
      setError('Please paste a recipe first')
      return
    }

    setError('')
    setIsParsing(true)

    try {
      const response = await fetch('/api/recipes/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: recipeText }),
      })

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || 'Failed to parse recipe')
        return
      }

      // Convert to enhanced prefilled format and navigate directly to edit form
      const prefilledData = convertToPrefilledData(data.recipe)
      sessionStorage.setItem(
        'prefilled-meal',
        JSON.stringify({ ...prefilledData, originalRecipeText: recipeText }),
      )
      router.push('/recipes?mode=create&prefilled=true')
    } catch {
      setError('Failed to parse recipe. Please try again.')
    } finally {
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
            <CardTitle>
              <Heading variant="h2">Import recipe</Heading>
            </CardTitle>
          </div>
          <CardDescription>
            <Body variant="muted">
              Paste a recipe from anywhere and we&apos;ll extract the ingredients for you. Include
              how many servings it makes, otherwise we&apos;ll assume 4.
            </Body>
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4">
            <Textarea
              value={recipeText}
              onChange={(e) => setRecipeText(e.target.value)}
              placeholder={`Paste your recipe here...\n\nExample:\nChicken Stir Fry\nServes 4\n\nIngredients:\n- 500g chicken breast\n- 2 tbsp soy sauce\n- 1 red bell pepper\n- 2 cloves garlic`}
              rows={12}
              className="resize-none"
              disabled={isParsing}
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
            onClick={handleParse}
            disabled={isParsing || !recipeText.trim()}
            className="w-full"
          >
            {isParsing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Parsing recipe...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Parse recipe
              </>
            )}
          </Button>
          <Body variant="muted" className="text-center">
            or{' '}
            <Link href="/recipes?mode=create" className="text-primary underline">
              create manually
            </Link>
          </Body>
        </CardFooter>
      </Card>
    </div>
  )
}
