'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'
import type { IngredientRowData } from '@/components/recipes/IngredientRow'
import {
  type MealTypeValue,
  type IngredientResult,
  type MealComponent,
  type MealFormData,
  buildFinalComponents,
} from './meal-form-types'
import { prefersReducedMotion } from '@/lib/utils'
import { parseLocalizedNumber } from '@/lib/i18n/parse-number'
import type { Unit } from '@/generated/prisma/enums'

const MAX_SERVINGS = 50
const MAX_PREP_MINUTES = 480

export interface UseMealFormOptions {
  /** Existing meal when editing, or prefilled data from the import / imagine flows. */
  meal?: MealFormData
  /** Household default, used for the servings field when creating from scratch. */
  defaultServings?: number
  onSuccess: () => void
}

/**
 * Seed the enhanced ingredient rows used by the import flow, ordering them so
 * the rows needing attention (unmatched, then low-confidence) come first.
 */
function initIngredientRows(meal?: MealFormData): IngredientRowData[] {
  if (!meal?.prefilledIngredients) return []

  const rows = meal.prefilledIngredients.map((prefilled): IngredientRowData => {
    if (prefilled.type === 'unmatched') {
      return {
        type: 'unmatched',
        extractedName: prefilled.extractedName ?? '',
        originalText: prefilled.originalText ?? '',
        extractedQuantity: prefilled.extractedQuantity ?? 0,
        extractedUnit: prefilled.extractedUnit ?? '',
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    if (prefilled.type === 'low-confidence' && prefilled.ingredient && prefilled.alternatives) {
      return {
        type: 'low-confidence',
        extractedName: prefilled.extractedName ?? prefilled.ingredient.name,
        originalText: prefilled.originalText,
        ingredient: prefilled.ingredient,
        alternatives: prefilled.alternatives,
        totalQuantity: prefilled.convertedQuantity ?? 100,
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    if (prefilled.ingredient) {
      return {
        type: 'matched',
        ingredient: prefilled.ingredient,
        totalQuantity: prefilled.convertedQuantity ?? 100,
        isVague: prefilled.isVague,
        originalPhrase: prefilled.originalPhrase,
      }
    }

    return {
      type: 'unmatched',
      extractedName: prefilled.extractedName ?? 'Unknown',
      originalText: prefilled.originalText ?? '',
      extractedQuantity: 0,
      extractedUnit: '',
    }
  })

  const typeOrder = { unmatched: 0, 'low-confidence': 1, matched: 2 }
  return rows.sort((a, b) => typeOrder[a.type] - typeOrder[b.type])
}

/**
 * All of `MealForm`'s state, derived values and handlers, so the component is
 * layout and wiring only.
 *
 * The form has two ingredient representations: plain `components` for manual
 * entry and editing, and `ingredientRows` with per-row match states for the
 * import / imagine flows. `isImportMode` picks between them, and every
 * ingredient handler branches on it.
 */
export function useMealForm({ meal, defaultServings, onSuccess }: UseMealFormOptions) {
  const t = useTranslations('recipes.form')
  const isEditing = !!meal?.id
  const hasPrefilledIngredients = !!meal?.prefilledIngredients?.length

  // Form state
  const [name, setName] = useState(meal?.name ?? '')
  const [description, setDescription] = useState(meal?.description ?? '')
  const [preparationNotes, setPreparationNotes] = useState(meal?.preparationNotes ?? '')
  const [timeMinutes, setTimeMinutes] = useState<string>(
    meal?.timeMinutes ? String(meal.timeMinutes) : '',
  )
  const [sourceUrl, setSourceUrl] = useState(meal?.sourceUrl ?? '')
  const [kidFriendly, setKidFriendly] = useState(meal?.kidFriendly ?? false)
  const [suitableFor, setSuitableFor] = useState<MealTypeValue[]>(
    (meal?.suitableFor as MealTypeValue[]) ?? ['dinner'],
  )
  const editServings = meal?.servings ?? defaultServings ?? 4
  const [servings, setServings] = useState<string>(String(editServings))

  // Standard components (for plain ingredient rows when editing)
  const [components, setComponents] = useState<MealComponent[]>(() => {
    if (!meal?.components) return []
    return meal.components.map((c) => ({
      ingredientId: c.ingredientId,
      ingredient: c.ingredient,
      totalQuantity: c.quantityPerServing * editServings,
      isVague: c.isVague,
      originalPhrase: c.originalPhrase,
    }))
  })

  // Enhanced ingredient rows (for import flow with match states)
  const [ingredientRows, setIngredientRows] = useState<IngredientRowData[]>(() =>
    initIngredientRows(meal),
  )

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState('')
  const ingredientRowsRef = useRef<HTMLDivElement>(null)

  const isImportMode = hasPrefilledIngredients || ingredientRows.length > 0
  const unresolvedCount = ingredientRows.filter((row) => row.type === 'unmatched').length
  const lowConfidenceCount = ingredientRows.filter((row) => row.type === 'low-confidence').length

  // Add beforeunload listener to warn about losing imported data
  useEffect(() => {
    if (!hasPrefilledIngredients) return

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [hasPrefilledIngredients])

  // Detect duplicate ingredients by ID
  const duplicateMap = useMemo(() => {
    const map = new Map<string, number[]>()

    if (isImportMode) {
      ingredientRows.forEach((row, index) => {
        if (row.type === 'matched' || row.type === 'low-confidence') {
          const id = row.ingredient.id
          const indices = map.get(id) ?? []
          indices.push(index)
          map.set(id, indices)
        }
      })
    } else {
      components.forEach((comp, index) => {
        const id = comp.ingredientId
        const indices = map.get(id) ?? []
        indices.push(index)
        map.set(id, indices)
      })
    }

    const duplicates = new Map<string, number[]>()
    map.forEach((indices, id) => {
      if (indices.length > 1) {
        duplicates.set(id, indices)
      }
    })

    return duplicates
  }, [isImportMode, ingredientRows, components])

  // Compute live nutrition summary from current ingredients
  const nutritionSummary = useMemo(() => {
    const servingsNum = parseLocalizedNumber(servings, { integer: true }) ?? 1
    const nutrition = { calories: 0, protein: 0, carbs: 0, fat: 0 }
    let matchedCount = 0
    let unmatchedCount = 0
    let hasVague = false

    const addNutrition = (
      ing: {
        calories?: number
        protein?: number
        carbs?: number
        fat?: number
        defaultUnit: string
        gramsPerPiece?: number | null
      },
      totalQuantity: number,
    ) => {
      const quantityPerServing = totalQuantity / servingsNum
      // For piece-unit ingredients, convert pieces to grams first
      const gramsPerServing =
        ing.defaultUnit === 'piece' && ing.gramsPerPiece
          ? quantityPerServing * ing.gramsPerPiece
          : quantityPerServing
      const factor = gramsPerServing / 100
      nutrition.calories += (ing.calories ?? 0) * factor
      nutrition.protein += (ing.protein ?? 0) * factor
      nutrition.carbs += (ing.carbs ?? 0) * factor
      nutrition.fat += (ing.fat ?? 0) * factor
    }

    if (isImportMode) {
      for (const row of ingredientRows) {
        if (row.type === 'unmatched') {
          unmatchedCount++
          continue
        }
        if (row.ingredient.calories == null) continue
        if (row.isVague) {
          hasVague = true
          continue
        }
        matchedCount++
        addNutrition(row.ingredient, row.totalQuantity)
      }
    } else {
      for (const comp of components) {
        if (comp.ingredient.calories == null) continue
        if (comp.isVague) {
          hasVague = true
          continue
        }
        matchedCount++
        addNutrition(comp.ingredient, comp.totalQuantity)
      }
    }

    return { nutrition, matchedCount, unmatchedCount, hasVague }
  }, [isImportMode, ingredientRows, components, servings])

  const handleMealTypeToggle = (mealType: MealTypeValue, checked: boolean) => {
    if (checked) {
      setSuitableFor([...suitableFor, mealType])
    } else {
      const newTypes = suitableFor.filter((t) => t !== mealType)
      // At least one meal type must stay selected.
      if (newTypes.length > 0) {
        setSuitableFor(newTypes)
      }
    }
  }

  const getAllIngredientIds = useCallback((): string[] => {
    const fromComponents = components.map((c) => c.ingredientId)
    const fromRows = ingredientRows
      .filter(
        (r): r is Extract<IngredientRowData, { type: 'matched' | 'low-confidence' }> =>
          r.type === 'matched' || r.type === 'low-confidence',
      )
      .map((r) => r.ingredient.id)
    return [...fromComponents, ...fromRows]
  }, [components, ingredientRows])

  const addIngredient = useCallback(
    (ingredient: IngredientResult) => {
      const existingIds = getAllIngredientIds()
      if (existingIds.includes(ingredient.id)) {
        toast.error(t('alreadyAdded', { name: ingredient.name }))
        return
      }

      if (isImportMode) {
        setIngredientRows([
          ...ingredientRows,
          {
            type: 'matched',
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      } else {
        setComponents([
          ...components,
          {
            ingredientId: ingredient.id,
            ingredient,
            totalQuantity: ingredient.defaultUnit === 'piece' ? 1 : 100,
          },
        ])
      }
    },
    [getAllIngredientIds, isImportMode, ingredientRows, components, t],
  )

  const removeComponent = (ingredientId: string) => {
    setComponents(components.filter((c) => c.ingredientId !== ingredientId))
  }

  const updateComponentQuantity = (ingredientId: string, quantity: number) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? { ...c, totalQuantity: quantity, isVague: false, originalPhrase: null }
          : c,
      ),
    )
  }

  const setComponentQuantity = (ingredientId: string, defaultUnit: Unit) => {
    const defaultQuantity = defaultUnit === 'piece' ? 1 : 5
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId
          ? { ...c, totalQuantity: defaultQuantity, isVague: false, originalPhrase: null }
          : c,
      ),
    )
  }

  const markComponentAsVague = (ingredientId: string) => {
    setComponents(
      components.map((c) =>
        c.ingredientId === ingredientId ? { ...c, isVague: true, originalPhrase: 'to taste' } : c,
      ),
    )
  }

  const handleIngredientRowUpdate = (index: number, updatedData: IngredientRowData) => {
    setIngredientRows(ingredientRows.map((row, i) => (i === index ? updatedData : row)))
  }

  const handleIngredientRowRemove = (index: number) => {
    setIngredientRows(ingredientRows.filter((_, i) => i !== index))
  }

  const handleIngredientRowResolve = (
    index: number,
    ingredient: IngredientResult,
    totalQuantity: number,
  ) => {
    setIngredientRows(
      ingredientRows.map((row, i) =>
        i === index ? { type: 'matched' as const, ingredient, totalQuantity } : row,
      ),
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!name.trim()) {
      setError(t('errors.nameRequired'))
      return
    }

    if (suitableFor.length === 0) {
      setError(t('errors.mealTypeRequired'))
      return
    }

    const servingsNum = parseLocalizedNumber(servings, { integer: true })
    if (servingsNum === null || servingsNum < 1 || servingsNum > MAX_SERVINGS) {
      setError(t('errors.servingsRange'))
      return
    }

    const result = buildFinalComponents(isImportMode, ingredientRows, components)
    if (result.error) {
      setError(result.error)
      if (isImportMode) {
        ingredientRowsRef.current?.scrollIntoView({
          behavior: prefersReducedMotion() ? 'auto' : 'smooth',
          block: 'start',
        })
      }
      return
    }

    setIsSubmitting(true)

    try {
      const timeMinutesNum = timeMinutes
        ? parseLocalizedNumber(timeMinutes, { integer: true })
        : null
      if (
        timeMinutes &&
        (timeMinutesNum === null || timeMinutesNum < 1 || timeMinutesNum > MAX_PREP_MINUTES)
      ) {
        setError(t('errors.prepTimeRange'))
        setIsSubmitting(false)
        return
      }

      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        preparationNotes: preparationNotes.trim() || null,
        sourceUrl: sourceUrl.trim() || null,
        timeMinutes: timeMinutesNum,
        kidFriendly,
        suitableFor,
        servings: servingsNum,
        components: result.components,
      }

      const url = isEditing ? `/api/households/me/meals/${meal.id}` : '/api/households/me/meals'
      const method = isEditing ? 'PATCH' : 'POST'

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(
          data.error || (isEditing ? t('errors.updateFailed') : t('errors.createFailed')),
        )
      }

      toast.success(isEditing ? t('successUpdated') : t('successCreated'))
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.generic'))
    } finally {
      setIsSubmitting(false)
    }
  }

  const servingsNum = parseLocalizedNumber(servings, { integer: true }) ?? 1
  const totalIngredientCount = isImportMode ? ingredientRows.length : components.length

  return {
    // Mode flags
    isEditing,
    isImportMode,
    hasPrefilledIngredients,
    originalRecipeText: meal?.originalRecipeText,

    // Field values + setters
    name,
    setName,
    description,
    setDescription,
    preparationNotes,
    setPreparationNotes,
    timeMinutes,
    setTimeMinutes,
    sourceUrl,
    setSourceUrl,
    kidFriendly,
    setKidFriendly,
    suitableFor,
    handleMealTypeToggle,
    servings,
    setServings,

    // Ingredients
    components,
    ingredientRows,
    ingredientRowsRef,
    duplicateMap,
    unresolvedCount,
    lowConfidenceCount,
    hasIngredients: totalIngredientCount > 0,
    /** Parsed servings, defaulting to 1 so per-serving maths never divides by zero. */
    servingsNum,
    nutritionSummary,
    getAllIngredientIds,
    addIngredient,
    removeComponent,
    updateComponentQuantity,
    setComponentQuantity,
    markComponentAsVague,
    handleIngredientRowUpdate,
    handleIngredientRowRemove,
    handleIngredientRowResolve,

    // Submission
    isSubmitting,
    error,
    handleSubmit,
  }
}
