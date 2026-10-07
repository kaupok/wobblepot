'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Loader2, Sparkles, ArrowLeft } from 'lucide-react'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { AttachImages, useAttachImages } from '@/components/recipes/AttachImages'
import { ImagineReviewDialog, type ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { IMAGINE_ERROR_KEYS, translateErrorCode } from '@/lib/ai/error-codes'
import {
  convertToPrefilledData,
  reviewImaginedMeal,
  type ImaginedMealResponse,
  withSavableTimeMinutes,
} from '@/lib/imagine-utils'
import { ApiError, apiFetch } from '@/lib/api'
import { MealCardBase } from '../MealCardBase'
import { AlternativeSkeleton } from './AlternativesList'
import { FieldError } from '@/components/FieldError'
import type { MealType } from '@/generated/prisma/enums'

export interface ImaginePanelProps {
  /** The slot being filled. Picks a placeholder example that fits the meal (HON-944). */
  mealType: MealType
  /** Leaves imagine mode and returns to the library list. */
  onExit: () => void
  /**
   * Fired after `ImagineReviewDialog` persists the meal. The caller assigns it
   * to the plan entry and closes the modal.
   */
  onMealSaved: (mealId: string) => void | Promise<void>
}

/**
 * AI "imagine a meal" flow: a prompt plus optional photos in, up to three
 * generated meals out, each openable in `ImagineReviewDialog` for saving.
 *
 * Self-contained — the parent only supplies the exit and save callbacks. An
 * in-flight request is aborted on unmount, which is what cancels generation
 * when the surrounding dialog closes.
 */
export function ImaginePanel({ mealType, onExit, onMealSaved }: ImaginePanelProps) {
  const t = useTranslations('meal-plan.selector.imagine')
  // `/api/meals/imagine` is shared with `/recipes/imagine`, so its error codes
  // resolve against that screen's catalog rather than duplicating thirteen
  // strings into this namespace (HON-700).
  const tRouteErrors = useTranslations('recipes.imagine.errors')

  const [prompt, setPrompt] = useState('')
  const [imaginedMeals, setImaginedMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
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
    mutationFn: async ({
      prompt,
      imageFiles,
      controller,
    }: {
      prompt: string
      imageFiles: File[]
      controller: AbortController
    }): Promise<ImaginedMealResponse[]> => {
      let init: RequestInit
      if (imageFiles.length > 0) {
        const formData = new FormData()
        if (prompt.trim()) {
          formData.append('prompt', prompt.trim())
        }
        for (const image of imageFiles) {
          formData.append('image', image)
        }
        init = { method: 'POST', body: formData, signal: controller.signal }
      } else {
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: prompt.trim() }),
          signal: controller.signal,
        }
      }

      // Every failure branch of the route answers non-2xx, so a resolved call
      // is always `success: true`.
      const data = await apiFetch<{ meals: ImaginedMealResponse[] }>('/api/meals/imagine', init)
      return withSavableTimeMinutes(data.meals)
    },
    onSuccess: (meals) => setImaginedMeals(meals),
    onError: (err) => {
      // A user-initiated cancel is not a failure — leave the panel untouched.
      if (err instanceof Error && err.name === 'AbortError') return
      if (!(err instanceof ApiError)) {
        setError(t('imagineFailed'))
        return
      }
      // Deliberately not falling back to the route's `error` / `message`: both
      // carry untranslated English, which would render verbatim to an
      // Estonian household. The route's machine-readable `code` is what
      // picks the copy; the prose is kept as a console breadcrumb only
      // (HON-700).
      const body = err.body as { error?: unknown; message?: unknown }
      console.error('[imagine] request failed', {
        code: err.code,
        // `message` carries the detail on the 429 branches — the hourly
        // limit, and the household-local date the AI cap resets on. `error`
        // is a bare label there.
        message: body.message,
        error: body.error,
      })
      setError(
        tRouteErrors(translateErrorCode(err.code, IMAGINE_ERROR_KEYS, 'imagineFailed'), {
          max: MAX_ATTACHED_IMAGES,
        }),
      )
    },
    onSettled: (_data, _err, { controller }) => {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    },
  })

  /**
   * Sanity-check the AI's per-serving quantities before opening the save
   * dialog. `reviewImaginedMeal` degrades on any failure — the original
   * quantities are used and the failure is reported, not surfaced (HON-699) —
   * so this mutation never errors.
   */
  const review = useMutation({
    mutationFn: reviewImaginedMeal,
    onSuccess: (finalMeal) => setReviewMeal(convertToPrefilledData(finalMeal)),
  })

  const isImagining = imagine.isPending
  const reviewingMealId = review.isPending ? review.variables.id : null

  const handleGenerate = () => {
    if (!prompt.trim() && images.length === 0) {
      setError(t('promptOrPhotoRequired'))
      return
    }

    setError(null)
    setImaginedMeals(null)

    const controller = new AbortController()
    abortControllerRef.current = controller
    imagine.mutate({ prompt, imageFiles, controller })
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
    review.reset()
    onExit()
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
            placeholder={t(`promptPlaceholder.${mealType}`)}
            aria-label={t('promptAria')}
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

        {error && <FieldError>{error}</FieldError>}

        <div className="flex flex-col gap-2">
          <Button
            onClick={handleGenerate}
            disabled={
              isImagining || reviewingMealId !== null || (!prompt.trim() && images.length === 0)
            }
            className="w-full md:w-auto md:self-start"
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
            <Button variant="ghost" size="sm" className="md:self-start" onClick={handleCancel}>
              {t('cancel')}
            </Button>
          )}
        </div>

        {/* Imagined meal results */}
        {(isImagining || imaginedMeals) && (
          <div className="grid gap-4 sm:grid-cols-3">
            {isImagining
              ? // Imagine cards keep their ingredient list (HON-1115 left them out of scope).
                Array.from({ length: 3 }).map((_, i) => (
                  <AlternativeSkeleton key={i} ingredients="list" />
                ))
              : imaginedMeals?.map((meal) => (
                  <Card key={meal.id} size="sm" className="flex h-full flex-col">
                    <CardContent className="flex-1 p-4 pb-2">
                      <MealCardBase meal={meal} nameHeadingTag="h3" mealTypes="hide" />
                    </CardContent>
                    <CardFooter className="p-4 pt-0">
                      <Button
                        variant="outline"
                        className="w-full md:w-auto md:self-start"
                        onClick={() => review.mutate(meal)}
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
