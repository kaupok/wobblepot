'use client'

import { useLocale, useTranslations } from 'next-intl'
import { HelpCircle, X, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Body } from '@/components/ui/typography'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { formatUnit } from '@/components/household/meal-form-types'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { QuantityControls } from './QuantityControls'
import type { LowConfidenceIngredientData, IngredientRowData } from './IngredientRow'

interface LowConfidenceIngredientRowProps {
  data: LowConfidenceIngredientData
  servings: number
  disabled: boolean
  duplicateIndices?: number[]
  onUpdate: (data: IngredientRowData) => void
  onRemove: () => void
  onQuantityChange: (newQuantity: number) => void
  onSetQuantity: () => void
  onMarkAsVague: () => void
}

export function LowConfidenceIngredientRow({
  data,
  servings,
  disabled,
  duplicateIndices,
  onUpdate,
  onRemove,
  onQuantityChange,
  onSetQuantity,
  onMarkAsVague,
}: LowConfidenceIngredientRowProps) {
  const locale = useLocale() as Locale
  const t = useTranslations('recipes.ingredientRow')
  const perServing = formatQuantity(data.totalQuantity / servings, locale, {
    maximumFractionDigits: 1,
  })
  const isInvalidQuantity = !data.isVague && data.totalQuantity <= 0
  const unitLabel = formatUnit(data.ingredient.defaultUnit)
  const isDuplicate = duplicateIndices && duplicateIndices.length > 0

  const handleAlternativeSelect = (selectedId: string) => {
    const selectedAlt = data.alternatives.find((alt) => alt.id === selectedId)
    if (!selectedAlt) return

    onUpdate({
      type: 'matched',
      ingredient: {
        id: selectedAlt.id,
        name: selectedAlt.name,
        category: selectedAlt.category,
        defaultUnit: selectedAlt.defaultUnit,
      },
      totalQuantity: data.totalQuantity,
      isVague: data.isVague,
      originalPhrase: data.originalPhrase,
    })
  }

  const handleConfirmBestMatch = () => {
    onUpdate({
      type: 'matched',
      ingredient: data.ingredient,
      totalQuantity: data.totalQuantity,
      isVague: data.isVague,
      originalPhrase: data.originalPhrase,
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
      <div className="flex items-start gap-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        <div className="flex flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-col gap-0.5">
              <Body className="text-blue-700 dark:text-blue-400">{data.extractedName}</Body>
              {data.originalText && (
                <Body variant="muted">{t('originalLabel', { text: data.originalText })}</Body>
              )}
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
                onQuantityChange={onQuantityChange}
                onSetQuantity={onSetQuantity}
                onMarkAsVague={onMarkAsVague}
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

          {/* Disambiguation dropdown */}
          <div className="flex items-center gap-2">
            <Body variant="small" className="text-blue-700 dark:text-blue-400">
              {t('verifyMatch')}
            </Body>
            <Select
              value={data.ingredient.id}
              onValueChange={handleAlternativeSelect}
              disabled={disabled}
            >
              <SelectTrigger className="w-[200px]" aria-label={t('verifyMatchAria')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={data.ingredient.id}>
                  {t('bestMatchSuffix', { name: data.ingredient.name })}
                </SelectItem>
                {data.alternatives
                  .filter((alt) => alt.id !== data.ingredient.id)
                  .map((alt) => (
                    <SelectItem key={alt.id} value={alt.id}>
                      {alt.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button type="button" size="sm" onClick={handleConfirmBestMatch} disabled={disabled}>
              {t('confirm')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
