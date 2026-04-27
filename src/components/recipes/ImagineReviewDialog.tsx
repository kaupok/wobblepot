'use client'

import { useState, useMemo, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Loader2, ChevronDown, ChevronRight, Clock, Baby, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { IngredientRow, type IngredientRowData } from './IngredientRow'
import type { IngredientResult } from './IngredientRow'
import { buildFinalComponents, formatUnit } from '@/components/household/meal-form-types'
import type { PrefilledIngredient } from '@/components/household/meal-form-types'
import { formatInteger, formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import type { MealType } from '@/generated/prisma/enums'

interface NutritionData {
  calories: number
  protein: number
  carbs: number
  fat: number
}

export interface ReviewMealData {
  name: string
  description: string | null
  preparationNotes: string | null
  sourceUrl: string | null
  timeMinutes: number | null
  servings: number
  mealTypes: MealType[]
  kidFriendly: boolean
  prefilledIngredients: PrefilledIngredient[]
  nutrition: NutritionData
}

interface ImagineReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meal: ReviewMealData
  onSaved: (mealId: string) => void
  onEditDetails?: (currentIngredients: PrefilledIngredient[]) => void
}

function initIngredientRows(prefilledIngredients: PrefilledIngredient[]): IngredientRowData[] {
  const rows = prefilledIngredients.map((prefilled): IngredientRowData => {
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

function toPrefilledIngredients(rows: IngredientRowData[]): PrefilledIngredient[] {
  return rows.map((row): PrefilledIngredient => {
    if (row.type === 'unmatched') {
      return {
        type: 'unmatched',
        extractedName: row.extractedName,
        originalText: row.originalText,
        extractedQuantity: row.extractedQuantity,
        extractedUnit: row.extractedUnit,
        isVague: row.isVague,
        originalPhrase: row.originalPhrase,
      }
    }
    if (row.type === 'low-confidence') {
      return {
        type: 'low-confidence',
        ingredient: row.ingredient,
        convertedQuantity: row.totalQuantity,
        isVague: row.isVague,
        originalPhrase: row.originalPhrase,
        lowConfidence: true,
        alternatives: row.alternatives,
        extractedName: row.extractedName,
        originalText: row.originalText,
      }
    }
    return {
      type: 'matched',
      ingredient: row.ingredient,
      convertedQuantity: row.totalQuantity,
      isVague: row.isVague,
      originalPhrase: row.originalPhrase,
    }
  })
}

const MEAL_TYPE_LABELS: Record<string, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
}

export function ImagineReviewDialog({
  open,
  onOpenChange,
  meal,
  onSaved,
  onEditDetails,
}: ImagineReviewDialogProps) {
  const [ingredientRows, setIngredientRows] = useState<IngredientRowData[]>(() =>
    initIngredientRows(meal.prefilledIngredients),
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isMatchedOpen, setIsMatchedOpen] = useState(false)
  const locale = useLocale() as Locale

  const unresolvedCount = ingredientRows.filter((row) => row.type === 'unmatched').length
  const lowConfidenceCount = ingredientRows.filter((row) => row.type === 'low-confidence').length
  const matchedCount = ingredientRows.filter((row) => row.type === 'matched').length
  const hasIssues = unresolvedCount > 0 || lowConfidenceCount > 0
  const canSave = unresolvedCount === 0 && lowConfidenceCount === 0

  const duplicateMap = useMemo(() => {
    const map = new Map<string, number[]>()
    ingredientRows.forEach((row, index) => {
      if (row.type === 'matched' || row.type === 'low-confidence') {
        const id = row.ingredient.id
        const indices = map.get(id) ?? []
        indices.push(index)
        map.set(id, indices)
      }
    })
    const duplicates = new Map<string, number[]>()
    map.forEach((indices, id) => {
      if (indices.length > 1) duplicates.set(id, indices)
    })
    return duplicates
  }, [ingredientRows])

  const handleIngredientRowUpdate = useCallback((index: number, updatedData: IngredientRowData) => {
    setIngredientRows((rows) => rows.map((row, i) => (i === index ? updatedData : row)))
  }, [])

  const handleIngredientRowRemove = useCallback((index: number) => {
    setIngredientRows((rows) => rows.filter((_, i) => i !== index))
  }, [])

  const handleIngredientRowResolve = useCallback(
    (index: number, ingredient: IngredientResult, totalQuantity: number) => {
      setIngredientRows((rows) =>
        rows.map((row, i) =>
          i === index ? { type: 'matched' as const, ingredient, totalQuantity } : row,
        ),
      )
    },
    [],
  )

  const handleSave = async () => {
    setError(null)

    const result = buildFinalComponents(true, ingredientRows, [])
    if (result.error) {
      setError(result.error)
      return
    }

    setIsSaving(true)
    try {
      const response = await fetch('/api/households/me/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: meal.name,
          description: meal.description,
          preparationNotes: meal.preparationNotes ?? null,
          sourceUrl: meal.sourceUrl ?? null,
          timeMinutes: meal.timeMinutes,
          kidFriendly: meal.kidFriendly,
          suitableFor: meal.mealTypes,
          servings: meal.servings,
          components: result.components,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save meal')
      }

      const data = await response.json()
      onSaved(data.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsSaving(false)
    }
  }

  const { nutrition } = meal

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          {meal.description && <DialogDescription>{meal.description}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Macros summary */}
          <div className="text-muted-foreground text-xs">
            {formatInteger(nutrition.calories, locale)} kcal ·{' '}
            {formatInteger(nutrition.protein, locale)}g protein ·{' '}
            {formatInteger(nutrition.carbs, locale)}g carbs · {formatInteger(nutrition.fat, locale)}
            g fat
          </div>

          {/* Meta badges */}
          <div className="flex flex-wrap items-center gap-2">
            {meal.timeMinutes && (
              <Badge variant="outline">
                <Clock className="h-3 w-3" />
                {meal.timeMinutes} min
              </Badge>
            )}
            {meal.kidFriendly && (
              <Badge variant="outline">
                <Baby className="h-3 w-3" />
                Kid-friendly
              </Badge>
            )}
            {meal.mealTypes.map((type) => (
              <Badge key={type} variant="secondary">
                {MEAL_TYPE_LABELS[type] ?? type}
              </Badge>
            ))}
          </div>

          {/* Issue rows: unmatched and low-confidence */}
          {hasIssues && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {unresolvedCount > 0 && (
                  <Badge variant="outline" className="text-amber-700 dark:text-amber-400">
                    {unresolvedCount} unmatched
                  </Badge>
                )}
                {lowConfidenceCount > 0 && (
                  <Badge variant="outline" className="text-blue-700 dark:text-blue-400">
                    {lowConfidenceCount} to verify
                  </Badge>
                )}
              </div>
              {ingredientRows.map((row, index) => {
                if (row.type === 'matched') return null
                const duplicateIndices =
                  row.type === 'low-confidence'
                    ? duplicateMap.get(row.ingredient.id)?.filter((i) => i !== index)
                    : undefined

                return (
                  <IngredientRow
                    key={index}
                    data={row}
                    servings={meal.servings}
                    disabled={isSaving}
                    duplicateIndices={duplicateIndices}
                    onUpdate={(updatedData) => handleIngredientRowUpdate(index, updatedData)}
                    onRemove={() => handleIngredientRowRemove(index)}
                    onResolve={(ingredient, totalQuantity) =>
                      handleIngredientRowResolve(index, ingredient, totalQuantity)
                    }
                  />
                )
              })}
            </div>
          )}

          {/* Matched ingredients: collapsible */}
          {matchedCount > 0 && (
            <Collapsible open={isMatchedOpen} onOpenChange={setIsMatchedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 rounded-md border border-green-200 bg-green-50/50 px-3 py-2 text-left transition-colors hover:bg-green-50 dark:border-green-900 dark:bg-green-950/20 dark:hover:bg-green-950/30"
                >
                  <Check className="h-4 w-4 text-green-600" />
                  {isMatchedOpen ? (
                    <ChevronDown className="text-muted-foreground h-4 w-4" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  )}
                  <Body variant="small" className="font-medium">
                    {matchedCount} ingredient{matchedCount !== 1 ? 's' : ''} matched
                  </Body>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 flex flex-col gap-1">
                  {ingredientRows.map((row, index) => {
                    if (row.type !== 'matched') return null
                    const perServing = formatQuantity(row.totalQuantity / meal.servings, locale, {
                      maximumFractionDigits: 1,
                    })
                    const unitLabel = formatUnit(row.ingredient.defaultUnit)
                    return (
                      <div key={index} className="flex items-center justify-between px-3 py-1">
                        <Body variant="small">{row.ingredient.name}</Body>
                        <Body variant="muted" className="text-xs">
                          {row.isVague && row.originalPhrase ? (
                            <span className="italic">{row.originalPhrase}</span>
                          ) : (
                            <>
                              {perServing}
                              {unitLabel}/serving
                            </>
                          )}
                        </Body>
                      </div>
                    )
                  })}
                </div>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Error */}
          {error && (
            <Body variant="small" className="text-destructive" role="alert">
              {error}
            </Body>
          )}
        </div>

        <DialogFooter className="flex-col">
          <Button onClick={handleSave} disabled={!canSave || isSaving} className="w-full">
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save meal'
            )}
          </Button>
          {onEditDetails && (
            <button
              type="button"
              onClick={() => onEditDetails(toPrefilledIngredients(ingredientRows))}
              disabled={isSaving}
              className="text-muted-foreground hover:text-foreground text-center text-sm underline transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              Edit details
            </button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
