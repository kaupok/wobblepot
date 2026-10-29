'use client'

import { useState, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation } from '@tanstack/react-query'
import Link from 'next/link'
import { Loader2, Sparkles, AlertTriangle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { BackToRecipesLink } from '@/components/recipes/BackToRecipesLink'
import { Textarea } from '@/components/ui/textarea'
import { Heading, Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch } from '@/lib/api'
import {
  RECIPE_IMPORT_ERROR_KEYS,
  rateLimitMessage,
  translateErrorCode,
} from '@/lib/ai/error-codes'
import type { Locale } from '@/lib/i18n/locales'
import { FieldError } from '@/components/FieldError'
import { AttachImages, useAttachImages } from '@/components/recipes/AttachImages'
import { MAX_ATTACHED_IMAGES } from '@/lib/image-attachments'
import { downscaleImage } from '@/lib/downscale-image'
import { convertToPrefilledData, type ParsedRecipeData } from './convert-parsed-recipe'
import type { PrefilledMeal } from '@/app/recipes/create/prefilled-meal'

function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text.trim()) || /^www\./i.test(text.trim())
}

type ParseResponse = { confidenceTier?: string; recipe: ParsedRecipeData }

const URL_STEP_DELAYS = [0, 4000, 10000]
const TEXT_STEP_DELAYS = [0, 4000]
// Reading a photo takes longer than reading pasted text, so each step stays up longer.
const PHOTO_STEP_DELAYS = [0, 5000, 12000]

interface RecipeImportClientProps {
  /** The household's member count, the servings a recipe gets when it does not say. */
  defaultServings: number
}

export function RecipeImportClient({ defaultServings }: RecipeImportClientProps) {
  const router = useRouter()
  const t = useTranslations('recipes.import')
  const locale = useLocale() as Locale
  const [recipeText, setRecipeText] = useState('')
  // A node, not a string: the `photoNoRecipe` copy carries a link to Imagine a meal.
  const [error, setError] = useState<ReactNode>(null)
  const [progressStep, setProgressStep] = useState('')
  const [stepVisible, setStepVisible] = useState(false)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])
  const abortControllerRef = useRef<AbortController | null>(null)
  const [warning, setWarning] = useState<{
    message: string
    recipe: ParsedRecipeData
  } | null>(null)

  const urlSteps = useMemo(
    () => [t('steps.fetchingPage'), t('steps.extractingRecipe'), t('steps.matchingIngredients')],
    [t],
  )
  const textSteps = useMemo(
    () => [t('steps.extractingRecipe'), t('steps.matchingIngredients')],
    [t],
  )
  const photoSteps = useMemo(
    () => [t('steps.readingPhoto'), t('steps.extractingRecipe'), t('steps.matchingIngredients')],
    [t],
  )

  const {
    images,
    files: imageFiles,
    handleFileSelect,
    removeImage,
    reset: resetImages,
  } = useAttachImages({
    tooManyImages: t('errors.tooManyImages', { max: MAX_ATTACHED_IMAGES }),
    wrongImageType: t('errors.wrongImageType'),
    imageTooLarge: t('errors.imageTooLarge'),
  })
  const hasInput = recipeText.trim() !== '' || images.length > 0

  useEffect(() => {
    const timers = timersRef
    return () => {
      abortControllerRef.current?.abort()
      timers.current.forEach(clearTimeout)
    }
  }, [])

  const navigateToCreate = (recipe: ParsedRecipeData) => {
    const prefilledData = convertToPrefilledData(recipe)
    sessionStorage.setItem(
      'prefilled-meal',
      JSON.stringify({
        ...prefilledData,
        // Photos are not stored with the recipe, so a photo import keeps only
        // the typed text, and none when nothing was typed (HON-1274).
        originalRecipeText: recipeText.trim() ? recipeText : undefined,
        origin: 'import',
      } satisfies PrefilledMeal),
    )
    router.push('/recipes/create?prefilled=true')
  }

  const clearProgressTimers = () => {
    timersRef.current.forEach(clearTimeout)
    timersRef.current = []
  }

  // Driven from the parse's start and end rather than an effect on `isPending`,
  // so the steps change in the same event that starts or ends the request.
  const startProgress = (text: string, hasPhotos: boolean) => {
    clearProgressTimers()

    // With photos the route does not fetch a link in the text, so the photo
    // steps win over the link steps.
    const [steps, delays] = hasPhotos
      ? [photoSteps, PHOTO_STEP_DELAYS]
      : isUrl(text)
        ? [urlSteps, URL_STEP_DELAYS]
        : [textSteps, TEXT_STEP_DELAYS]

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
  }

  const stopProgress = () => {
    clearProgressTimers()
    setStepVisible(false)
    // Small delay before clearing text so fade-out completes
    timersRef.current.push(setTimeout(() => setProgressStep(''), 150))
  }

  const parse = useMutation({
    mutationFn: async ({
      text,
      imageFiles,
      controller,
    }: {
      text: string
      imageFiles: File[]
      controller: AbortController
    }): Promise<ParseResponse> => {
      let init: RequestInit
      if (imageFiles.length > 0) {
        // No Content-Type header: the browser sets the multipart boundary.
        const formData = new FormData()
        if (text.trim()) formData.append('text', text)
        // Shrunk first, so three phone photos fit Vercel's 4.5 MB body limit.
        for (const image of await Promise.all(imageFiles.map(downscaleImage))) {
          formData.append('image', image)
        }
        init = { method: 'POST', body: formData, signal: controller.signal }
      } else {
        init = {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
          signal: controller.signal,
        }
      }
      // Every failure branch of the route answers non-2xx, so a resolved call
      // is always `success: true`.
      return apiFetch<ParseResponse>('/api/recipes/parse', init)
    },
    onSuccess: (data) => {
      // `recipe:imported` fires when the user actually saves the recipe to
      // their library on `/recipes/create` (see `CreateRecipeClient`), not
      // when the parse succeeds. Counting parses inflates the activation
      // metric with abandoned attempts.

      // Handle medium confidence — show warning with options
      if (data.confidenceTier === 'medium') {
        // Same reason the error path below ignores the route's `error`:
        // `evaluateRecipeConfidence` always sets a message on the medium tier,
        // so `data.confidenceWarning ||` never reached the translation and an
        // Estonian household read the English sentence. There is exactly one
        // medium-tier message and `warningDefault` already says it in both
        // catalogs, so nothing specific is lost (HON-700).
        setWarning({ message: t('warningDefault'), recipe: data.recipe })
        return
      }

      navigateToCreate(data.recipe)
    },
    onError: (err) => {
      // A user-initiated cancel is not a failure — leave the page untouched.
      if (err instanceof Error && err.name === 'AbortError') return
      if (!(err instanceof ApiError)) {
        setError(t('errors.parseGeneric'))
        return
      }
      // Deliberately not falling back to the route's `error`: it carries
      // untranslated English, which would render verbatim to an Estonian
      // household. The route's machine-readable `code` is what picks the
      // copy; the prose is kept as a console breadcrumb only (HON-700).
      const body = err.body as { error?: unknown; message?: unknown }
      console.error('[recipe-import] request failed', {
        code: err.code,
        // `message` carries the detail on the 429 and 503 branches — the
        // hourly limit, the AI-cap reset date, the kill-switch note.
        message: body.message,
        error: body.error,
      })
      // Vercel answers a body over 4.5 MB itself, with no JSON and so no
      // `code`. Photos that do not shrink in the browser can still reach it.
      if (err.status === 413) {
        setError(t('errors.photosTooLarge'))
        return
      }
      const { key, values } = rateLimitMessage(
        translateErrorCode(err.code, RECIPE_IMPORT_ERROR_KEYS, 'parseGeneric'),
        RECIPE_IMPORT_ERROR_KEYS.rate_limited,
        err.body,
        locale,
      )
      if (key === RECIPE_IMPORT_ERROR_KEYS.photo_no_recipe) {
        setError(
          t.rich('errors.photoNoRecipe', {
            link: (chunks) => (
              <Link href="/recipes/imagine" className="inline-link">
                {chunks}
              </Link>
            ),
          }),
        )
        return
      }
      setError(t(`errors.${key}`, { max: MAX_ATTACHED_IMAGES, ...values }))
    },
    onSettled: (_data, _err, { controller }) => {
      // A cancelled run was already wound down by `handleCancel`, and may
      // settle after a newer run has started.
      if (abortControllerRef.current !== controller) return
      abortControllerRef.current = null
      stopProgress()
    },
  })

  const isParsing = parse.isPending

  const handleCancel = () => {
    abortControllerRef.current?.abort()
    abortControllerRef.current = null
    parse.reset()
    stopProgress()
  }

  const handleParse = () => {
    if (!hasInput) {
      setError(t('errors.empty'))
      return
    }

    setError(null)
    setWarning(null)

    const controller = new AbortController()
    abortControllerRef.current = controller
    startProgress(recipeText, imageFiles.length > 0)
    parse.mutate({ text: recipeText, imageFiles, controller })
  }

  return (
    <div className="w-full px-4 py-8">
      {/* A form page: a narrow column, top-aligned, no bordered page wrapper (HON-779). */}
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <BackToRecipesLink />
            <Heading variant="h4" as="h1">
              {t('title')}
            </Heading>
          </div>
          <Body variant="muted">{t('description', { count: defaultServings })}</Body>
        </div>
        <div className="flex flex-col gap-4">
          <AttachImages
            images={images}
            onSelect={(e) => {
              handleFileSelect(e)
              setError(null)
              setWarning(null)
            }}
            onRemove={removeImage}
            disabled={isParsing}
            attachLabel={t('attachAria')}
            removeImageLabel={(filename) => t('removeImageAria', { filename })}
          >
            <Textarea
              value={recipeText}
              onChange={(e) => {
                setRecipeText(e.target.value)
                setError(null)
                setWarning(null)
              }}
              placeholder={t('placeholder')}
              aria-label={t('textAria')}
              rows={12}
              className="min-w-0 flex-1 resize-none"
              disabled={isParsing}
            />
          </AttachImages>
          {error && <FieldError>{error}</FieldError>}
          {warning && (
            <div className="border-warning/30 bg-warning-muted rounded-md border p-4">
              <div className="flex items-start gap-3">
                <AlertTriangle className="text-warning mt-0.5 h-5 w-5 shrink-0" />
                <div className="flex flex-col gap-3">
                  <Body variant="paragraph" tone="warning">
                    {warning.message}
                  </Body>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => navigateToCreate(warning.recipe)}
                    >
                      {t('continueAnyway')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setWarning(null)
                        setRecipeText('')
                        resetImages()
                      }}
                    >
                      {t('tryDifferent')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            onClick={handleParse}
            disabled={isParsing || !hasInput}
            className="w-full md:w-auto md:self-start"
          >
            {isParsing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                <span
                  className={cn(
                    'transition-opacity duration-150',
                    stepVisible ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  {progressStep || t('submitting')}
                </span>
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                {t('submit')}
              </>
            )}
          </Button>
          {isParsing ? (
            <Button variant="ghost" size="sm" onClick={handleCancel}>
              {t('cancel')}
            </Button>
          ) : (
            // A visible way to the blank form for a recipe the household
            // types in by hand (HON-1128, HON-1271).
            <Button variant="outline" asChild className="w-full md:w-auto md:self-start">
              <Link href="/recipes/create">{t('startBlank')}</Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
