'use client'

import { useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Check, X, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { formatUnit } from '@/components/household/meal-form-types'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { QuantityControls } from './QuantityControls'
import { UnmatchedIngredientRow } from './UnmatchedIngredientRow'
import { LowConfidenceIngredientRow } from './LowConfidenceIngredientRow'
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

// Defined by the search hook that produces it; re-exported here so recipe-row
// callers keep a single import for the row's types.
export type { IngredientResult }

export interface IngredientAlternative {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  similarity: number
}

// High-confidence matched ingredient
export interface MatchedIngredientData {
  type: 'matched'
  ingredient: IngredientResult
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Low-confidence matched ingredient with alternatives
export interface LowConfidenceIngredientData {
  type: 'low-confidence'
  extractedName: string
  originalText?: string
  ingredient: IngredientResult
  alternatives: IngredientAlternative[]
  totalQuantity: number
  isVague?: boolean
  originalPhrase?: string | null
}

// Unmatched ingredient that needs resolution
export interface UnmatchedIngredientData {
  type: 'unmatched'
  extractedName: string
  originalText: string
  extractedQuantity: number
  extractedUnit: string
  isVague?: boolean
  originalPhrase?: string | null
}

export type IngredientRowData =
  MatchedIngredientData | LowConfidenceIngredientData | UnmatchedIngredientData

interface IngredientRowProps {
  data: IngredientRowData
  servings: number
  disabled?: boolean
  duplicateIndices?: number[]
  onUpdate: (data: IngredientRowData) => void
  onRemove: () => void
  onResolve?: (ingredient: IngredientResult, totalQuantity: number) => void
}

export function IngredientRow({
  data,
  servings,
  disabled = false,
  duplicateIndices,
  onUpdate,
  onRemove,
  onResolve,
}: IngredientRowProps) {
  // Preserve the last quantity when toggling between vague and specific
  const lastQuantityRef = useRef<number | null>(null)
  const locale = useLocale() as Locale
  const t = useTranslations('recipes.ingredientRow')

  const handleQuantityChange = (newQuantity: number) => {
    if (data.type === 'matched' || data.type === 'low-confidence') {
      onUpdate({
        ...data,
        totalQuantity: newQuantity,
        isVague: false,
        originalPhrase: null,
      })
    }
  }

  const handleSetQuantity = () => {
    if (data.type === 'matched' || data.type === 'low-confidence') {
      const quantity = lastQuantityRef.current ?? (data.ingredient.defaultUnit === 'piece' ? 1 : 5)
      onUpdate({
        ...data,
        totalQuantity: quantity,
        isVague: false,
        originalPhrase: null,
      })
    }
  }

  const handleMarkAsVague = () => {
    if (data.type === 'matched' || data.type === 'low-confidence') {
      lastQuantityRef.current = data.totalQuantity
      onUpdate({
        ...data,
        isVague: true,
        originalPhrase: 'to taste',
      })
    }
  }

  // Delegate to sub-components based on type
  if (data.type === 'unmatched') {
    return (
      <UnmatchedIngredientRow
        data={data}
        disabled={disabled}
        onRemove={onRemove}
        onResolve={onResolve}
      />
    )
  }

  if (data.type === 'low-confidence') {
    return (
      <LowConfidenceIngredientRow
        data={data}
        servings={servings}
        disabled={disabled}
        duplicateIndices={duplicateIndices}
        onUpdate={onUpdate}
        onRemove={onRemove}
        onQuantityChange={handleQuantityChange}
        onSetQuantity={handleSetQuantity}
        onMarkAsVague={handleMarkAsVague}
      />
    )
  }

  // Matched (high confidence)
  const perServing = formatQuantity(data.totalQuantity / servings, locale, {
    maximumFractionDigits: 1,
  })
  const isInvalidQuantity = !data.isVague && data.totalQuantity <= 0
  const unitLabel = formatUnit(data.ingredient.defaultUnit)
  const isDuplicate = duplicateIndices && duplicateIndices.length > 0

  return (
    <div className="flex items-center gap-3 rounded-md border border-green-200 bg-green-50/50 p-3 dark:border-green-900 dark:bg-green-950/20">
      <Check className="h-4 w-4 shrink-0 text-green-600" />
      <div className="flex-1">
        <Body>{data.ingredient.name}</Body>
        <Body variant="muted">
          {data.isVague && data.originalPhrase ? (
            <span className="italic">{data.originalPhrase}</span>
          ) : isInvalidQuantity ? (
            <span className="text-destructive">{t('invalidQuantity')}</span>
          ) : (
            t('perServing', { quantity: perServing, unit: unitLabel })
          )}
        </Body>
        {isDuplicate && (
          <div className="mt-1 flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0 text-amber-600" />
            <Body variant="small" className="text-amber-700 dark:text-amber-400">
              {t('duplicateRow', {
                count: duplicateIndices.length,
                rows: duplicateIndices.map((i) => i + 1).join(', '),
              })}
            </Body>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <QuantityControls
          totalQuantity={data.totalQuantity}
          unitLabel={unitLabel}
          isVague={!!data.isVague}
          isInvalidQuantity={isInvalidQuantity}
          disabled={disabled}
          onQuantityChange={handleQuantityChange}
          onSetQuantity={handleSetQuantity}
          onMarkAsVague={handleMarkAsVague}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          disabled={disabled}
          aria-label={t('removeAria')}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
