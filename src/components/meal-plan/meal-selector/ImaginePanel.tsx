'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Sparkles, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Body } from '@/components/ui/typography'
import { AttachImages, useAttachImages } from '@/components/recipes/AttachImages'
import { ImagineReviewDialog, type ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { convertToPrefilledData, type ImaginedMealResponse } from '@/lib/imagine-utils'
import { MealCardBase } from '../MealCardBase'
import { AlternativeSkeleton } from './AlternativesList'

export interface ImaginePanelProps {
  /** Leaves imagine mode and returns to the library list. */
  onExit: () => void
  /**
   * Fired after `ImagineReviewDialog` persists the meal. The caller assigns it
   * to the plan entry and closes the modal.
   */
  onMealSaved: (mealId: string) => void | Promise<void>
}

/** Thrown so `useMutation` treats a failed imagine response as an error. */
class ImagineRequestError extends Error {}

/**
 * AI "imagine a meal" flow: a prompt plus optional photos in, up to three
 * generated meals out, each openable in `ImagineReviewDialog` for saving.
 *
 * Self-contained — the parent only supplies the exit and save callbacks. An
 * in-flight request is aborted on unmount, which is what cancels generation
 * when the surrounding dialog closes.
 */
export function ImaginePanel({ onExit, onMealSaved }: ImaginePanelProps) {
  const t = useTranslations('meal-plan.selector.imagine')

  const [prompt, setPrompt] = useState('')
  const [imaginedMeals, setImaginedMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
  const [reviewingMealId, setReviewingMealId] = useState<string | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  const {
    images,
    files: imageFiles,
    handleFileSelect,
    removeImage,
    reset: resetImages,
  } = useAttachImages({
    tooManyImages: t('tooManyImages', { max: MAX_ATTACHED_IMAGES }),
    wrongImageType: t('wrongImageType'),
    imageTooLarge: t('imageTooLarge'),
  })

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort()
    }
  }, [])

  const imagine = useMutation({
    mutationFn: async () => {
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
          throw new ImagineRequestError(data.error || data.message || t('imagineFailed'))
        }

        return data.meals as ImaginedMealResponse[]
      } finally {
        abortControllerRef.current = null
      }
    },
    onSuccess: (meals) => setImaginedMeals(meals),
    onError: (err) => {
      // A user-initiated cancel is not a failure — leave the panel untouched.
      if (err instanceof Error && err.name === 'AbortError') return
      setError(err instanceof ImagineRequestError ? err.message : t('imagineFailed'))
    },
  })

  const isImagining = imagine.isPending

  const handleGenerate = () => {
    if (!prompt.trim() && images.length === 0) {
      setError(t('promptOrPhotoRequired'))
      return
    }

    setError(null)
    setImaginedMeals(null)
    imagine.mutate()
  }

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    imagine.reset()
  }

  const handleExit = () => {
    abortControllerRef.current?.abort()
    imagine.reset()
    setPrompt('')
    resetImages()
    setImaginedMeals(null)
    setError(null)
    setReviewingMealId(null)
    onExit()
  }

  /**
   * Ask the review endpoint to sanity-check the AI's per-serving quantities
   * before opening the save dialog. Degrades gracefully: on any failure the
   * original quantities are used.
   */
  const handleSelectImaginedMeal = async (meal: ImaginedMealResponse) => {
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

  const handleSaved = async (mealId: string) => {
    // Close the review dialog immediately to prevent duplicate saves.
    setReviewMeal(null)
    await onMealSaved(mealId)
  }

  return (
    <>
      <div className="flex flex-col gap-4">
        <Button variant="ghost" size="sm" className="-ml-2 self-start" onClick={handleExit}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          {t('back')}
        </Button>

        <AttachImages
          images={images}
          onSelect={handleFileSelect}
          onRemove={removeImage}
          disabled={isImagining}
          attachLabel={t('attachAria')}
          removeImageLabel={(filename) => t('removeImageAria', { filename })}
        >
          <Textarea
            value={prompt}
            onChange={(e) => {
              setPrompt(e.target.value)
              setError(null)
            }}
            placeholder={t('promptPlaceholder')}
            rows={3}
            className="min-w-0 flex-1 resize-none"
            disabled={isImagining}
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

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleGenerate}
            disabled={
              isImagining || reviewingMealId !== null || (!prompt.trim() && images.length === 0)
            }
            className="w-full"
          >
            {isImagining ? (
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
          {isImagining && (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              {t('cancel')}
            </Button>
          )}
        </div>

        {/* Imagined meal results */}
        {(isImagining || imaginedMeals) && (
          <div className="grid gap-4 sm:grid-cols-3">
            {isImagining
              ? Array.from({ length: 3 }).map((_, i) => <AlternativeSkeleton key={i} />)
              : imaginedMeals?.map((meal) => (
                  <Card key={meal.id} className="flex h-full flex-col">
                    <CardContent className="flex-1 p-4 pb-2">
                      <MealCardBase meal={meal} nameHeadingLevel="h3" />
                    </CardContent>
                    <CardFooter className="p-4 pt-0">
                      <Button
                        className="w-full"
                        onClick={() => handleSelectImaginedMeal(meal)}
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

      {/* Nested inside the selector's DialogContent, which is fine: DialogPortal
          puts both dialogs on document.body and Radix's DismissableLayer stack is
          module-global, so React-tree position does not affect stacking. */}
      {reviewMeal && (
        <ImagineReviewDialog
          open={!!reviewMeal}
          onOpenChange={(open) => {
            if (!open) setReviewMeal(null)
          }}
          meal={reviewMeal}
          onSaved={handleSaved}
        />
      )}
    </>
  )
}
