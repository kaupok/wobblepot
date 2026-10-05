'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  MealForm,
  type MealFormData,
  type PrefilledIngredient,
} from '@/components/household/MealForm'
import type { MealType } from '@/generated/prisma/enums'
import { track } from '@/lib/analytics'
import { getValidReturnUrl } from '@/lib/utils'
import { MealFormSkeleton } from './MealFormSkeleton'

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
  /**
   * Which flow wrote the stash, so a save fires that flow's event (HON-1063).
   * Absent means the blank form. `originalRecipeText` is a form field, not an
   * analytics marker.
   */
  origin?: 'import' | 'imagine'
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
  // The stash is single-use, but StrictMode runs this effect twice on mount:
  // the first run consumes it, so the second has to reuse what that run read
  // rather than find nothing and blank the form (HON-801).
  const stashRef = useRef<EnhancedPrefilledData | null>(null)

  useEffect(() => {
    async function loadPrefilled() {
      await Promise.resolve()
      if (prefilled !== 'true') {
        setPrefilledData(null)
        return
      }
      const stored = sessionStorage.getItem('prefilled-meal')
      if (stored) {
        try {
          stashRef.current = JSON.parse(stored) as EnhancedPrefilledData
        } catch {
          // Invalid data
          stashRef.current = null
        }
        sessionStorage.removeItem('prefilled-meal')
      }
      setPrefilledData(stashRef.current)
    }
    loadPrefilled()
  }, [prefilled])

  const handleSuccess = (meal: { id: string }) => {
    // One event per path that adds a recipe (HON-1063). Firing on save, not on
    // the parse or the generation, means abandoned attempts are not counted.
    const origin = prefilledData?.origin
    if (origin === 'import') {
      void track('recipe:imported', { source: 'import_page' })
    } else if (origin === 'imagine') {
      // The same event the review dialog's Select fires, so the imagine funnel
      // counts both ways out of the dialog.
      void track('meal:imagined', { meal_id: meal.id, source: 'imagine_page' })
    } else {
      void track('recipe:created', { source: 'create_page' })
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

  // The stash is read in an effect, after the route has resolved, so the
  // route's `loading.tsx` no longer covers this gap: render the same skeleton
  // rather than an empty page (HON-779).
  if (prefilledData === undefined) return <MealFormSkeleton />

  return (
    <div className="w-full px-4 py-8">
      {/* A form page: a narrow column, top-aligned, no page-level Card (HON-779). */}
      <div className="max-w-2xl">
        <MealForm
          meal={getPrefilledMeal()}
          defaultServings={defaultServings}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </div>
    </div>
  )
}
