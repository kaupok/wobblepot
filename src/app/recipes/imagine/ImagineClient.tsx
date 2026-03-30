'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Loader2, ArrowLeft, Sparkles, ImagePlus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { PrefilledIngredient } from '@/components/household/MealForm'
import { ImagineReviewSheet, type ReviewMealData } from '@/components/recipes/ImagineReviewSheet'
import { convertToPrefilledData, type ImaginedMealResponse } from '@/lib/imagine-utils'

const MAX_IMAGES = 3
const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

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
  const [images, setImages] = useState<File[]>([])
  const [isGenerating, setIsGenerating] = useState(false)
  const [reviewingMealId, setReviewingMealId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [meals, setMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const objectUrlsRef = useRef<string[]>([])

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
      objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  const removeImage = useCallback((index: number) => {
    setImages((prev) => {
      const removed = prev[index]
      if (removed) {
        const url = objectUrlsRef.current[index]
        if (url) URL.revokeObjectURL(url)
        objectUrlsRef.current = objectUrlsRef.current.filter((_, i) => i !== index)
      }
      return prev.filter((_, i) => i !== index)
    })
  }, [])

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      // Reset input so the same file can be re-selected
      e.target.value = ''

      const available = MAX_IMAGES - images.length
      if (files.length > available) {
        toast.error(`You can attach up to ${MAX_IMAGES} images`)
        return
      }

      for (const file of files) {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
          toast.error('Images must be JPEG, PNG, or WebP')
          return
        }
        if (file.size > MAX_IMAGE_SIZE) {
          toast.error('Each image must be 5 MB or less')
          return
        }
      }

      const newUrls = files.map((f) => URL.createObjectURL(f))
      objectUrlsRef.current = [...objectUrlsRef.current, ...newUrls]
      setImages((prev) => [...prev, ...files])
    },
    [images.length],
  )

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

  const handleReviewSaved = (_mealId: string) => {
    setReviewMeal(null)
    toast.success('Meal saved to your library')
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
      setError('Please describe what kind of meal you want or attach a photo')
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
        for (const image of images) {
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
              <Heading variant="h4">Imagine a meal</Heading>
            </div>
            <Body variant="muted">
              Describe what you&apos;re in the mood for or snap a photo, and we&apos;ll suggest 3
              meal ideas.
            </Body>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-4">
              <div className="flex gap-2">
                <Textarea
                  value={prompt}
                  onChange={(e) => {
                    setPrompt(e.target.value)
                    setError('')
                  }}
                  placeholder="Something healthy with chicken and a fresh salad..."
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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-10 w-10 shrink-0 self-end"
                  disabled={isGenerating || images.length >= MAX_IMAGES}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach photos"
                >
                  <ImagePlus className="h-4 w-4" />
                </Button>
              </div>
              {images.length > 0 && (
                <div className="flex gap-2">
                  {images.map((file, index) => (
                    <div key={`${file.name}-${file.lastModified}`} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element -- blob URL preview, not optimizable */}
                      <img
                        src={objectUrlsRef.current[index]}
                        alt={file.name}
                        className="h-16 w-16 rounded-md border object-cover"
                      />
                      <button
                        type="button"
                        onClick={() => removeImage(index)}
                        disabled={isGenerating}
                        className="bg-background/80 absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm"
                        aria-label={`Remove ${file.name}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
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

      {reviewMeal && (
        <ImagineReviewSheet
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
