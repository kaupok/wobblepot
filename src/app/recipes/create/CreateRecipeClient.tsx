'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MealForm,
  type MealFormData,
  type PrefilledIngredient,
} from '@/components/household/MealForm'
import type { MealType } from '@/generated/prisma/enums'
import { track } from '@/lib/analytics'
import { getValidReturnUrl } from '@/lib/utils'

interface EnhancedPrefilledData {
  name: string
  description: string | null
  preparationNotes?: string | null
  sourceUrl?: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  prefilledIngredients: PrefilledIngredient[]
  originalRecipeText?: string
  /**
   * Where Cancel should return to. Set by the imagine flow's "Edit details"
   * (`ImagineClient.handleEditDetails`); the import flow omits it and keeps the
   * `/recipes` fallback.
   */
  returnTo?: string | null
}

/**
 * `returnTo` round-trips through `sessionStorage`, so treat it as untrusted.
 * Delegates to the vetted `getValidReturnUrl` rather than re-deriving the rule:
 * it also rejects backslashes and percent-encoded bypasses (`/\evil.example`
 * resolves to `https://evil.example/`). It returns `'/'` for anything it
 * rejects, so an unchanged value is the pass signal.
 */
function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value === '') return null
  return getValidReturnUrl(value) === value ? value : null
}

// undefined = not loaded yet, null = loaded (no prefill), object = loaded with prefill
type PrefilledState = EnhancedPrefilledData | null | undefined

interface CreateRecipeClientProps {
  defaultServings: number
}

export function CreateRecipeClient({ defaultServings }: CreateRecipeClientProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prefilled = searchParams.get('prefilled')

  const [prefilledData, setPrefilledData] = useState<PrefilledState>(undefined)

  useEffect(() => {
    async function loadPrefilled() {
      await Promise.resolve()
      let data: EnhancedPrefilledData | null = null
      if (prefilled === 'true') {
        const stored = sessionStorage.getItem('prefilled-meal')
        if (stored) {
          try {
            data = JSON.parse(stored) as EnhancedPrefilledData
          } catch {
            // Invalid data
          }
          sessionStorage.removeItem('prefilled-meal')
        }
      }
      setPrefilledData(data)
    }
    loadPrefilled()
  }, [prefilled])

  const handleSuccess = () => {
    // `originalRecipeText` is set only by the import flow (RecipeImportClient
    // → navigateToCreate); the imagine flow's "Edit details" path does not
    // set it. Firing here means we count saves, not parses — abandoned
    // parses no longer inflate the activation metric.
    if (prefilledData?.originalRecipeText) {
      void track('recipe:imported', { source: 'import_page' })
    }
    // The imagine stash is deliberately left alone: saving one of the three
    // suggestions does not invalidate the other two, and the stash has to keep
    // mirroring what `/recipes/imagine` renders (see `handleReviewSaved`
    // there). A new generation, or the tab closing, is what supersedes it.
    router.push('/recipes')
  }

  const handleCancel = () => {
    router.push(safeInternalPath(prefilledData?.returnTo) ?? '/recipes')
  }

  const getPrefilledMeal = (): MealFormData | undefined => {
    if (!prefilledData) return undefined

    return {
      name: prefilledData.name,
      description: prefilledData.description,
      preparationNotes: prefilledData.preparationNotes,
      sourceUrl: prefilledData.sourceUrl,
      timeMinutes: prefilledData.timeMinutes,
      kidFriendly: prefilledData.kidFriendly,
      suitableFor: prefilledData.mealTypes,
      servings: prefilledData.servings,
      prefilledIngredients: prefilledData.prefilledIngredients,
      originalRecipeText: prefilledData.originalRecipeText,
    }
  }

  if (prefilledData === undefined) return null

  return (
    <div className="grid min-h-[calc(100vh-4rem)] place-items-center p-4">
      <MealForm
        meal={getPrefilledMeal()}
        defaultServings={defaultServings}
        onSuccess={handleSuccess}
        onCancel={handleCancel}
      />
    </div>
  )
}
