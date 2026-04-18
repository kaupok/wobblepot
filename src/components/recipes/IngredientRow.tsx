'use client'

import { useRef } from 'react'
import { Check, X, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import { formatUnit } from '@/components/household/meal-form-types'
import { QuantityControls } from './QuantityControls'
import { UnmatchedIngredientRow } from './UnmatchedIngredientRow'
import { LowConfidenceIngredientRow } from './LowConfidenceIngredientRow'
import type { IngredientCategory, Unit } from '@/generated/prisma/enums'

export interface IngredientResult {
  id: string
  name: string
  category: IngredientCategory
  defaultUnit: Unit
  gramsPerPiece?: number | null
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
}

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
  | MatchedIngredientData
  | LowConfidenceIngredientData
  | UnmatchedIngredientData

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
  const perServing = Math.round((data.totalQuantity / servings) * 10) / 10
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
            <span className="text-destructive">Quantity must be greater than 0</span>
          ) : (
            <>
              {perServing}
              {unitLabel} per serving
            </>
          )}
        </Body>
        {isDuplicate && (
          <div className="mt-1 flex items-center gap-1.5">
            <Info className="h-3 w-3 shrink-0 text-amber-600" />
            <Body variant="small" className="text-amber-700 dark:text-amber-400">
              Also used in row{duplicateIndices.length > 1 ? 's' : ''}{' '}
              {duplicateIndices.map((i) => i + 1).join(', ')}
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
          aria-label="Remove ingredient"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
