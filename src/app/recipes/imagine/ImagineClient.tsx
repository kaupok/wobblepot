'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import { Check, Loader2, Sparkles } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { BackToRecipesLink } from '@/components/recipes/BackToRecipesLink'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import { MealCardBase } from '@/components/meal-plan/MealCardBase'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import type { PrefilledIngredient } from '@/components/household/MealForm'
import { ImagineReviewDialog, type ReviewMealData } from '@/components/recipes/ImagineReviewDialog'
import { withReviewNutrition } from '@/components/recipes/imagine-review-nutrition'
import { AttachImages, useAttachImages } from '@/components/recipes/AttachImages'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { downscaleImage } from '@/lib/downscale-image'
import { IMAGINE_ERROR_KEYS, rateLimitMessage, translateErrorCode } from '@/lib/ai/error-codes'
import type { Locale } from '@/lib/i18n/locales'
import {
  convertToPrefilledData,
  reviewImaginedMeal,
  type ImaginedMealResponse,
  withSavableTimeMinutes,
} from '@/lib/imagine-utils'
import { track } from '@/lib/analytics'
import { ApiError, apiFetch } from '@/lib/api'
import {
  IMAGINE_ROUTE,
  clearImagineSession,
  loadImagineSession,
  saveImagineSession,
} from './imagine-session'
import { FieldError } from '@/components/FieldError'

const recipeHref = (mealId: string) => `/recipes/${mealId}/edit`

// `Skeleton` renders `role="status"` on every bar, so all but the name bar are
// `aria-hidden`: each card announces "Loading" once, not 15 times.
function SkeletonCard() {
  return (
    <Card size="sm" className="flex h-full flex-col">
      <CardContent className="flex-1 p-4 pb-2">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton aria-hidden className="h-5 w-full" />
          <Skeleton aria-hidden className="h-5 w-2/3" />
          <div className="mt-1 flex gap-2">
            <Skeleton aria-hidden className="h-8 w-16" />
            <Skeleton aria-hidden className="h-8 w-16" />
            <Skeleton aria-hidden className="h-8 w-16" />
            <Skeleton aria-hidden className="h-8 w-16" />
          </div>
          <Skeleton aria-hidden className="h-5 w-24" />
          <Skeleton aria-hidden className="h-5 w-32" />
          <div className="mt-1 flex flex-col gap-1">
            <Skeleton aria-hidden className="h-4 w-28" />
            <Skeleton aria-hidden className="h-4 w-24" />
            <Skeleton aria-hidden className="h-4 w-32" />
            <Skeleton aria-hidden className="h-4 w-20" />
          </div>
        </div>
      </CardContent>
      <CardFooter className="p-4 pt-0">
        <Skeleton aria-hidden className="h-touch w-full md:h-10" />
      </CardFooter>
    </Card>
  )
}

export function ImagineClient() {
  const router = useRouter()
  const t = useTranslations('recipes.imagine')
  const locale = useLocale() as Locale
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [meals, setMeals] = useState<ImaginedMealResponse[] | null>(null)
  const [reviewMeal, setReviewMeal] = useState<ReviewMealData | null>(null)
  // Imagined meal ID → saved recipe ID. A saved idea shows "Open recipe" in
  // place of "Review and save", so it cannot be reviewed and saved a second time (HON-1270).
  const [savedMealIds, setSavedMealIds] = useState<Record<string, string>>({})
  const abortControllerRef = useRef<AbortController | null>(null)
  // `ReviewMealData` carries no ID, so the imagined meal behind the open
  // dialog is kept here, set when its review lands.
  const reviewSourceIdRef = useRef<string | null>(null)
  // Each card's action ("Review and save", or "Open recipe" once saved), by imagined meal
  // ID: where focus goes when the review dialog closes.
  const cardActionRefs = useRef(new Map<string, HTMLElement>())

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

  // Restore the suggestions the user left behind when they went to the create
  // form (Cancel or browser back both land here on a fresh mount). Runs in an
  // effect rather than a lazy `useState` initialiser so the server-rendered
  // empty state and the first client render still agree.
  useEffect(() => {
    const stored = loadImagineSession()
    if (!stored) return
    // The hydration reason above is why this sets state in an effect; the rule
    // only started seeing it once the compiler could analyse this component.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrompt(stored.prompt)
    setMeals(withSavableTimeMinutes(stored.meals))
    setSavedMealIds(stored.savedMealIds ?? {})
  }, [])

  // Degrades on failure and reports it — see `reviewImaginedMeal` (HON-699),
  // so this mutation never errors.
  const review = useMutation({
    mutationFn: reviewImaginedMeal,
    onSuccess: (finalMeal, meal) => {
      reviewSourceIdRef.current = meal.id
      // The card takes the dialog's numbers, so the two agree (HON-1367).
      if (meals) {
        const next = meals.map((m) => (m.id === meal.id ? withReviewNutrition(m, finalMeal) : m))
        setMeals(next)
        saveImagineSession({ prompt, meals: next, savedMealIds })
      }
      setReviewMeal(convertToPrefilledData(finalMeal))
    },
  })

  const reviewingMealId = review.isPending ? review.variables.id : null

  const handleReviewSaved = (mealId: string) => {
    void track('meal:imagined', { meal_id: mealId, source: 'imagine_page' })
    // Deliberately does NOT clear the stash. Saving closes the dialog without
    // navigating, so the other two suggestions are still on screen and still
    // selectable — dropping the stash here would leave it out of sync with
    // `meals` and blank the page on the next mount. The stash mirrors what is
    // rendered; only a new generation (or the tab closing) supersedes it.
    // The saved ID goes into the stash too, so a reload keeps the card marked.
    const sourceId = reviewSourceIdRef.current
    if (sourceId && meals) {
      const next = { ...savedMealIds, [sourceId]: mealId }
      setSavedMealIds(next)
      saveImagineSession({ prompt, meals, savedMealIds: next })
    }
    setReviewMeal(null)
    toast.success(t('savedToast'), {
      action: { label: t('openRecipe'), onClick: () => router.push(recipeHref(mealId)) },
    })
  }

  // Back to the card the dialog was opened from: its "Review and save" after a cancel, or
  // its "Open recipe" link after a save, which replaced it on that card.
  const handleReviewCloseAutoFocus = (event: Event) => {
    const sourceId = reviewSourceIdRef.current
    const target = sourceId ? cardActionRefs.current.get(sourceId) : undefined
    if (!target) return
    event.preventDefault()
    target.focus()
  }

  const cardActionRef = (mealId: string) => (element: HTMLElement | null) => {
    if (element) cardActionRefs.current.set(mealId, element)
    else cardActionRefs.current.delete(mealId)
  }

  const handleEditDetails = (currentIngredients: PrefilledIngredient[]) => {
    if (!reviewMeal) return
    sessionStorage.setItem(
      'prefilled-meal',
      JSON.stringify({
        ...reviewMeal,
        prefilledIngredients: currentIngredients,
        returnTo: IMAGINE_ROUTE,
        origin: 'imagine',
      }),
    )
    router.push('/recipes/create?prefilled=true')
  }

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
        // Shrunk first, so three phone photos fit Vercel's 4.5 MB body limit.
        for (const image of await Promise.all(imageFiles.map(downscaleImage))) {
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
    onSuccess: (meals, { prompt }) => {
      setMeals(meals)
      saveImagineSession({ prompt, meals })
    },
    onError: (err) => {
      // A user-initiated cancel is not a failure — leave the page untouched.
      if (err instanceof Error && err.name === 'AbortError') return
      if (!(err instanceof ApiError)) {
        setError(t('errors.imagineFailed'))
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
      const { key, values } = rateLimitMessage(
        translateErrorCode(err.code, IMAGINE_ERROR_KEYS, 'generic'),
        IMAGINE_ERROR_KEYS.rate_limited,
        err.body,
        locale,
      )
      setError(t(`errors.${key}`, { max: MAX_ATTACHED_IMAGES, ...values }))
    },
    onSettled: (_data, _err, { controller }) => {
      if (abortControllerRef.current === controller) abortControllerRef.current = null
    },
  })

  const isGenerating = imagine.isPending

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    imagine.reset()
  }

  const handleGenerate = () => {
    // The prompt field and this button stay focusable while busy
    // (`aria-disabled`), so Enter and clicks still reach here.
    if (isGenerating || reviewingMealId !== null) return
    if (!prompt.trim() && images.length === 0) {
      setError(t('errors.promptOrPhotoRequired'))
      return
    }

    setError('')
    setMeals(null)
    setSavedMealIds({})
    // A new generation supersedes the stashed one; drop it now so an aborted or
    // failed run cannot restore stale suggestions on the next mount.
    clearImagineSession()

    const controller = new AbortController()
    abortControllerRef.current = controller
    imagine.mutate({ prompt, imageFiles, controller })
  }

  return (
    <div className="w-full px-4 py-8">
      {/* Top-aligned, no page-level Card (HON-779). The column fills the page
          width, as a list does, not a form's `max-w-2xl`: the results grid
          needs it (HON-1367). The result cards stay cards, each is the item itself. */}
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BackToRecipesLink />
            <Heading variant="h4" as="h1">
              {t('title')}
            </Heading>
          </div>
          <Body variant="muted">{t('description')}</Body>
        </div>
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
              aria-label={t('promptAria')}
              rows={3}
              className="min-w-0 flex-1 resize-none"
              // Not `disabled`: Chromium would drop focus to <body> on Enter.
              readOnly={isGenerating}
              aria-disabled={isGenerating || undefined}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleGenerate()
                }
              }}
            />
          </AttachImages>
          {error && <FieldError>{error}</FieldError>}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleGenerate}
            // Busy is `aria-disabled`, so a pressed button keeps focus; an empty
            // prompt is `disabled`, since focus is in the field when it empties.
            aria-disabled={isGenerating || reviewingMealId !== null || undefined}
            disabled={!prompt.trim() && images.length === 0}
            // Once ideas show, each card's action leads, so this steps back.
            variant={meals ? 'outline' : 'default'}
            className="w-full md:w-auto md:self-start"
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('generating')}
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {meals ? t('generateAgain') : t('generate')}
              </>
            )}
          </Button>
          {isGenerating && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCancel}
              className="w-full md:w-auto md:self-start"
            >
              {t('cancel')}
            </Button>
          )}
          {/* Mounted before the ideas arrive, so the count is announced. Focus
              stays where the user left it. */}
          <div role="status" className="sr-only">
            {imagine.isSuccess && meals ? t('ideasReady', { count: meals.length }) : null}
          </div>
        </div>

        {/* Results: skeleton cards while loading, real cards when done */}
        {(isGenerating || meals) && (
          <div className="grid gap-4 sm:grid-cols-3">
            {isGenerating
              ? Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)
              : meals?.map((meal) => {
                  const savedMealId = savedMealIds[meal.id]
                  return (
                    <Card key={meal.id} size="sm" className="flex h-full flex-col">
                      <CardContent className="flex-1 p-4 pb-2">
                        <MealCardBase meal={meal} nameHeadingTag="h2" />
                      </CardContent>
                      <CardFooter className="flex-col items-stretch gap-2 p-4 pt-0">
                        {savedMealId ? (
                          <>
                            <div>
                              <Badge variant="surface-success">
                                <Check aria-hidden="true" />
                                {t('saved')}
                              </Badge>
                            </div>
                            <Button asChild variant="outline" className="w-full">
                              <Link href={recipeHref(savedMealId)} ref={cardActionRef(meal.id)}>
                                {t('openRecipe')}
                              </Link>
                            </Button>
                          </>
                        ) : (
                          <Button
                            ref={cardActionRef(meal.id)}
                            // Outline: three filled buttons in a row would compete
                            // with the review dialog's one primary Save.
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                              if (reviewingMealId !== null) return
                              review.mutate(meal)
                            }}
                            // Not `disabled`: the pressed button keeps focus
                            // until the review dialog takes it.
                            aria-disabled={reviewingMealId !== null || undefined}
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
                        )}
                      </CardFooter>
                    </Card>
                  )
                })}
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
          onCloseAutoFocus={handleReviewCloseAutoFocus}
        />
      )}
    </div>
  )
}
