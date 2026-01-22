'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
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
import { RecipePreview, type ParsedRecipeData } from '@/components/recipes/RecipePreview'

type ViewMode = 'input' | 'preview'

export function RecipeImportClient() {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<ViewMode>('input')
  const [recipeText, setRecipeText] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [error, setError] = useState('')
  const [parsedRecipe, setParsedRecipe] = useState<ParsedRecipeData | null>(null)

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

      setParsedRecipe(data.recipe)
      setViewMode('preview')
    } catch {
      setError('Failed to parse recipe. Please try again.')
    } finally {
      setIsParsing(false)
    }
  }

  const handleBack = () => {
    setViewMode('input')
    setParsedRecipe(null)
    setError('')
  }

  const handleSuccess = () => {
    toast.success('Recipe created')
    router.push('/recipes')
  }

  const handleEdit = (data: ParsedRecipeData) => {
    // Store parsed data in sessionStorage for MealForm to read
    sessionStorage.setItem('prefilled-meal', JSON.stringify(data))
    router.push('/recipes?mode=create&prefilled=true')
  }

  // Preview mode
  if (viewMode === 'preview' && parsedRecipe) {
    return (
      <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
        <RecipePreview
          recipe={parsedRecipe}
          onConfirm={handleSuccess}
          onEdit={handleEdit}
          onBack={handleBack}
        />
      </div>
    )
  }

  // Input mode
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
