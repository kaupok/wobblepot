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
    router.push('/recipes')
  }

  const handleCancel = () => {
    router.push('/recipes')
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
