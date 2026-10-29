'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, ChevronRight, Clock, Loader2, Users } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useId, useMemo, useRef, useState } from 'react'

import { FieldError } from '@/components/FieldError'
import type { FinalComponent, PrefilledIngredient } from '@/components/household/meal-form-types'
import {
  buildFinalComponents,
  formatAmountWithUnit,
  mealComponentErrorMessage,
} from '@/components/household/meal-form-types'
import { KidFriendlyBadge } from '@/components/meal-plan/KidFriendlyBadge'
import { NutritionSummary } from '@/components/meal-plan/NutritionSummary'
import { NutritionDisclaimer } from '@/components/NutritionDisclaimer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Body } from '@/components/ui/typography'
import type { MealType } from '@/generated/prisma/enums'
import { ApiError, apiFetch } from '@/lib/api'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { savableTimeMinutes } from '@/lib/imagine-utils'
import { MAX_MEAL_COMPONENTS } from '@/lib/meal-planning/components-schema'

import { computeReviewNutrition, initIngredientRows } from './imagine-review-nutrition'
import type { IngredientResult } from './IngredientRow'
import { IngredientRow, type IngredientRowData } from './IngredientRow'

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
}

interface ImagineReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  meal: ReviewMealData
  onSaved: (mealId: string) => void
  onEditDetails?: (currentIngredients: PrefilledIngredient[]) => void
  /**
   * The dialog opens from controlled state, so Radix has no trigger to return
   * focus to and it falls to `<body>`. The caller calls
   * `event.preventDefault()` and focuses the control that opened it.
   */
  onCloseAutoFocus?: (event: Event) => void
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

function MealTypeBadge({ type }: { type: MealType }) {
  const label = useEnumLabel('MealType', type)
  return <Badge variant="secondary">{label}</Badge>
}

export function ImagineReviewDialog({
  open,
  onOpenChange,
  meal,
  onSaved,
  onEditDetails,
  onCloseAutoFocus,
}: ImagineReviewDialogProps) {
  const t = useTranslations('recipes.review')
  const tForm = useTranslations('recipes.form')
  const tDetail = useTranslations('meal-plan.detail')
  const tRow = useTranslations('recipes.ingredientRow')
  const vaguePhrase = useVaguePhrase()
  const pieceLabel = useEnumLabel('Unit', 'piece')
  const contentRef = useRef<HTMLDivElement>(null)
  const [ingredientRows, setIngredientRows] = useState<IngredientRowData[]>(() =>
    initIngredientRows(meal.prefilledIngredients, tRow('unknownName')),
  )
  const [error, setError] = useState<string | null>(null)
  const [isMatchedOpen, setIsMatchedOpen] = useState(false)
  const locale = useLocale() as Locale
  const saveBlockedId = useId()
  // Callers already pass a sanitised value; re-applying it keeps the save valid
  // and the badge equal to what is saved whatever the caller (HON-891).
  const timeMinutes = savableTimeMinutes(meal.timeMinutes)

  const unresolvedCount = ingredientRows.filter((row) => row.type === 'unmatched').length
  const lowConfidenceCount = ingredientRows.filter((row) => row.type === 'low-confidence').length
  const matchedCount = ingredientRows.filter((row) => row.type === 'matched').length
  const hasIssues = unresolvedCount > 0 || lowConfidenceCount > 0
  const canSave = unresolvedCount === 0 && lowConfidenceCount === 0
  const saveBlockedReason =
    unresolvedCount > 0 && lowConfidenceCount > 0
      ? t('saveBlocked.both', { unmatched: unresolvedCount, lowConfidence: lowConfidenceCount })
      : unresolvedCount > 0
        ? t('saveBlocked.unmatched', { count: unresolvedCount })
        : lowConfidenceCount > 0
          ? t('saveBlocked.lowConfidence', { count: lowConfidenceCount })
          : null

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

  const queryClient = useQueryClient()
  const save = useMutation({
    mutationFn: (components: FinalComponent[]) =>
      apiFetch<{ id: string }>('/api/households/me/meals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: meal.name,
          description: meal.description,
          preparationNotes: meal.preparationNotes ?? null,
          sourceUrl: meal.sourceUrl ?? null,
          timeMinutes,
          kidFriendly: meal.kidFriendly,
          suitableFor: meal.mealTypes,
          servings: meal.servings,
          components,
        }),
      }),
    onSuccess: (data) => {
      // The new meal belongs in the recipe library and the selector's
      // "my recipes" list.
      void queryClient.invalidateQueries({ queryKey: ['meals'] })
      void queryClient.invalidateQueries({ queryKey: ['my-recipes'] })
      onSaved(data.id)
    },
    onError: (err) => {
      // `POST /api/households/me/meals` sets an English `error` on every
      // failure branch (`Failed to create recipe`, `Validation failed`, …), so
      // preferring it meant the translated fallback never fired and an
      // Estonian household read English on the step right after a localized
      // imagine (HON-724). None of those branches needs distinct copy here —
      // the user's only move is to retry — so the server string is logged,
      // never rendered, as in `JoinHouseholdCard` (HON-697). A network
      // failure's `message` is browser English too.
      console.error(
        '[imagine-review] save failed',
        err instanceof ApiError ? { status: err.status, error: err.message } : { error: err },
      )
      setError(t('errors.saveFailed'))
    },
  })
  const isSaving = save.isPending

  const handleSave = () => {
    setError(null)

    // The rows are already flagged inline; the API would reject the payload,
    // and retrying the generic save error would resend it unchanged (HON-714).
    if (duplicateMap.size > 0) {
      setError(tForm('errors.duplicateIngredients'))
      return
    }
    const result = buildFinalComponents(true, ingredientRows, [])
    if (result.error !== undefined) {
      setError(mealComponentErrorMessage(result.error, tForm, locale))
      return
    }

    if (result.components.length > MAX_MEAL_COMPONENTS) {
      setError(tForm('errors.tooManyIngredients', { max: MAX_MEAL_COMPONENTS }))
      return
    }

    save.mutate(result.components)
  }

  const nutrition = useMemo(
    () => computeReviewNutrition(ingredientRows, meal.servings),
    [ingredientRows, meal.servings],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className="max-h-dialog overflow-y-auto sm:max-w-lg"
        // Focus the dialog itself, not its first control: that is the matched
        // ingredients disclosure, a secondary control. A screen reader
        // announces the dialog by its title.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          contentRef.current?.focus()
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{meal.name}</DialogTitle>
          {meal.description && <DialogDescription>{meal.description}</DialogDescription>}
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Meta badges */}
          <div className="flex flex-wrap items-center gap-2">
            {/* The sanitised value, never `null` or `0`, so no stray "0" (HON-711). */}
            {timeMinutes != null && (
              <Badge variant="outline">
                <Clock className="size-3.5" />
                {tDetail('timeMinutes', { count: timeMinutes })}
              </Badge>
            )}
            {/* Every quantity below is per serving, so say how many it makes. */}
            <Badge variant="outline">
              <Users className="size-3.5" />
              {t('servings', { count: meal.servings })}
            </Badge>
            {meal.kidFriendly && <KidFriendlyBadge />}
            {meal.mealTypes.map((type) => (
              <MealTypeBadge key={type} type={type} />
            ))}
          </div>

          {/* The same summary as every other meal view; hidden rather than
              zeroed when macros are missing. */}
          {nutrition && (
            <div className="flex flex-col gap-2">
              <NutritionSummary
                nutrition={nutrition}
                components={
                  ingredientRows.some((row) => row.isVague) ? [{ isVague: true }] : undefined
                }
              />
              <NutritionDisclaimer />
            </div>
          )}

          {/* Issue rows: unmatched and low-confidence */}
          {hasIssues && (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {unresolvedCount > 0 && (
                  <Badge variant="warning">
                    {tForm('unmatchedBadge', { count: unresolvedCount })}
                  </Badge>
                )}
                {lowConfidenceCount > 0 && (
                  <Badge variant="info">
                    {tForm('toVerifyBadge', { count: lowConfidenceCount })}
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
                  className="border-success/30 bg-success-muted hover:bg-success-muted/70 flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors"
                >
                  <Check className="text-success h-4 w-4" />
                  {isMatchedOpen ? (
                    <ChevronDown className="text-muted-foreground h-4 w-4" />
                  ) : (
                    <ChevronRight className="text-muted-foreground h-4 w-4" />
                  )}
                  <Body variant="small">{t('matchedCollapse', { count: matchedCount })}</Body>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 flex flex-col gap-1">
                  {ingredientRows.map((row, index) => {
                    if (row.type !== 'matched') return null
                    const perServing = formatQuantity(row.totalQuantity / meal.servings, locale, {
                      maximumFractionDigits: 1,
                    })
                    return (
                      <div key={index} className="flex items-center justify-between px-3 py-1">
                        <Body variant="small">{row.ingredient.name}</Body>
                        <Body variant="caption">
                          {row.isVague && row.originalPhrase ? (
                            <span className="italic">{vaguePhrase(row.originalPhrase)}</span>
                          ) : (
                            tRow('perServing', {
                              quantity: formatAmountWithUnit(
                                perServing,
                                row.ingredient,
                                pieceLabel,
                              ),
                            })
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
          {error && <FieldError>{error}</FieldError>}
        </div>

        {/* Plain column, not DialogFooter: its `sm:flex-row sm:justify-end` default
            would put the full-width Save beside "Edit details" and overflow (HON-759). */}
        <div className="flex flex-col gap-2">
          <Button
            onClick={handleSave}
            disabled={!canSave || isSaving}
            aria-describedby={saveBlockedReason ? saveBlockedId : undefined}
            className="w-full"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
          {saveBlockedReason && (
            <Body id={saveBlockedId} variant="muted" className="text-center">
              {saveBlockedReason}
            </Body>
          )}
          {onEditDetails && (
            <button
              type="button"
              onClick={() => onEditDetails(toPrefilledIngredients(ingredientRows))}
              disabled={isSaving}
              className="text-muted-foreground hover:text-foreground text-center text-sm underline transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {t('editDetails')}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
