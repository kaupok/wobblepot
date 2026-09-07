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
// Colocated with the flow that owns it — the imagine page writes the stash and
// this page is the one place that can tell when it should be dropped.
import { IMAGINE_ROUTE, clearImagineSession } from '@/app/recipes/imagine/imagine-session'

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
 * `returnTo` round-trips through `sessionStorage`, so treat it as untrusted:
 * only same-origin absolute paths are pushed. `//host` is a protocol-relative
 * URL, not a path.
 */
function safeInternalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  if (!value.startsWith('/') || value.startsWith('//')) return null
  return value
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
    // The imagined suggestion is now a saved meal, so there is nothing to go
    // back to. Gated on `returnTo` so the import flow never clears a stash that
    // belongs to an imagine session the user is still in the middle of.
    if (prefilledData?.returnTo === IMAGINE_ROUTE) {
      clearImagineSession()
    }
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
