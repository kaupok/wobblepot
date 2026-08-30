'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { PrefilledIngredient } from '@/components/household/MealForm'
import { ImagineReviewDialog, type ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import { AttachImages, useAttachImages } from '@/components/recipes/AttachImages'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { convertToPrefilledData, type ImaginedMealResponse } from '@/lib/imagine-utils'
import { track } from '@/lib/analytics'

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
  const t = useTranslations('recipes.imagine')
  const [prompt, setPrompt] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [reviewingMealId, setReviewingMealId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [meals, setMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const {
    images,
    files: imageFiles,
    handleFileSelect,
    removeImage,
  } = useAttachImages({
    tooManyImages: t('errors.tooManyImages', { max: MAX_ATTACHED_IMAGES }),
    wrongImageType: t('errors.wrongImageType'),
    imageTooLarge: t('errors.imageTooLarge'),
  })

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
        signal: AbortSignal.timeout(15_000),
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
    setReviewMeal({
      ...prefilledData,
      nutrition: finalMeal.nutrition,
    })
  }

  const handleReviewSaved = (mealId: string) => {
    void track('meal:imagined', { meal_id: mealId, source: 'imagine_page' })
    setReviewMeal(null)
    toast.success(t('savedToast'))
  }

  const handleEditDetails = (currentIngredients: PrefilledIngredient[]) => {
    if (!reviewMeal) return
    const { nutrition: _, ...prefilledData } = reviewMeal
    sessionStorage.setItem(
      'prefilled-meal',
      JSON.stringify({ ...prefilledData, prefilledIngredients: currentIngredients }),
    )
    router.push('/recipes/create?prefilled=true')
  }

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    setIsGenerating(false)
  }

  const handleGenerate = async () => {
    if (!prompt.trim() && images.length === 0) {
      setError(t('errors.promptOrPhotoRequired'))
      return
    }

    setError('')
    setMeals(null)
    setIsGenerating(true)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      let response: Response
      if (images.length > 0) {
        const formData = new FormData()
        if (prompt.trim()) {
          formData.append('prompt', prompt.trim())
        }
        for (const image of imageFiles) {
          formData.append('image', image)
        }
        response = await fetch('/api/meals/imagine', {
          method: 'POST',
          body: formData,
          signal: controller.signal,
        })
      } else {
        response = await fetch('/api/meals/imagine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim() }),
          signal: controller.signal,
        })
      }

      const data = await response.json()

      if (!response.ok || !data.success) {
        setError(data.error || data.message || t('errors.generic'))
        return
      }

      setMeals(data.meals)
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        return
      }
      setError(t('errors.imagineFailed'))
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
              <Heading variant="h4">{t('title')}</Heading>
            </div>
            <Body variant="muted">{t('description')}</Body>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <AttachImages
                images={images}
                onSelect={handleFileSelect}
                onRemove={removeImage}
                disabled={isGenerating}
                attachLabel={t('attachAria')}
                removeImageLabel={(filename) => t('removeImageAria', { filename })}
              >
                <Textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    setError('')
                  }}
                  placeholder={t('promptPlaceholder')}
                  rows={3}
                  className="min-w-0 flex-1 resize-none"
                  disabled={isGenerating}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleGenerate()
                    }
                  }}
                />
              </AttachImages>
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
              disabled={
                isGenerating || reviewingMealId !== null || (!prompt.trim() && images.length === 0)
              }
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('generating')}
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  {t('generate')}
                </>
              )}
            </Button>
            {isGenerating && (
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {t('cancel')}
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
                            {t('fineTuning')}
                          </>
                        ) : (
                          t('select')
                        )}
                      </Button>
                    </CardFooter>
                  </Card>
                ))}
          </div>
        )}
      </div>

      {reviewMeal && (
        <ImagineReviewDialog
          open={!!reviewMeal}
          onOpenChange={(open) => {
            if (!open) setReviewMeal(null)
          }}
          meal={reviewMeal}
          onSaved={handleReviewSaved}
          onEditDetails={handleEditDetails}
        />
      )}
    </div>
  )
}
