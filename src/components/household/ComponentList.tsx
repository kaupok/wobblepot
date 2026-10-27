'use client'

import { useLocale, useTranslations } from 'next-intl'
import { Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/number-input'
import { Body } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import { type MealComponent, formatAmountWithUnit, formatUnit } from './meal-form-types'
import type { Unit } from '@/generated/prisma/enums'

interface ComponentListProps {
  components: MealComponent[]
  servings: number
  disabled: boolean
  duplicateMap: Map<string, number[]>
  onRemove: (ingredientId: string) => void
  onUpdateQuantity: (ingredientId: string, quantity: number) => void
  onSetQuantity: (ingredientId: string, defaultUnit: Unit) => void
  onMarkAsVague: (ingredientId: string) => void
}

export function ComponentList({
  components,
  servings,
  disabled,
  duplicateMap,
  onRemove,
  onUpdateQuantity,
  onSetQuantity,
  onMarkAsVague,
}: ComponentListProps) {
  const locale = useLocale() as Locale
  const t = useTranslations('recipes.form.componentList')
  const tCommon = useTranslations('common')
  const vaguePhrase = useVaguePhrase()
  const pieceLabel = useEnumLabel('Unit', 'piece')

  if (components.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {components.map((comp, index) => {
        const isInvalidQuantity = !comp.isVague && comp.totalQuantity <= 0
        const unitLabel = formatUnit(comp.ingredient, pieceLabel)
        const duplicateIndices = duplicateMap.get(comp.ingredientId)
        const isDuplicate = duplicateIndices && duplicateIndices.length > 1
        const otherIndices = isDuplicate ? duplicateIndices.filter((i) => i !== index) : []
        return (
          // Below `sm` the controls stack under the text so the name keeps the row's width
          <div
            key={index}
            className="flex flex-col gap-3 rounded-md border p-3 sm:flex-row sm:items-center"
          >
            <div className="sm:flex-1">
              <Body>{comp.ingredient.name}</Body>
              <Body variant="muted">
                {comp.isVague && comp.originalPhrase ? (
                  <span className="italic">{vaguePhrase(comp.originalPhrase)}</span>
                ) : isInvalidQuantity ? (
                  <span className="text-destructive">{t('invalidQuantity')}</span>
                ) : (
                  t('perServing', {
                    quantity: formatAmountWithUnit(
                      formatQuantity(comp.totalQuantity / servings, locale, {
                        maximumFractionDigits: 1,
                      }),
                      comp.ingredient,
                      pieceLabel,
                    ),
                  })
                )}
              </Body>
              {isDuplicate && (
                <div className="mt-1 flex items-center gap-1.5">
                  <Info className="text-warning size-3.5 shrink-0" />
                  <Body variant="paragraph" tone="warning">
                    {t('duplicateRow', {
                      count: otherIndices.length,
                      rows: otherIndices.map((i) => i + 1).join(', '),
                    })}
                  </Body>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {comp.isVague ? (
                <Button
                  type="button"
                  variant="quiet"
                  size="sm"
                  onClick={() => onSetQuantity(comp.ingredientId, comp.ingredient.defaultUnit)}
                  disabled={disabled}
                >
                  {t('setQuantity')}
                </Button>
              ) : (
                <>
                  <div
                    className={cn(
                      // The group draws the focus ring its `embedded` field gives up.
                      'focus-within:border-ring focus-within:ring-ring/50 flex items-center rounded-md border focus-within:ring-3',
                      isInvalidQuantity ? 'border-destructive' : 'border-input',
                    )}
                  >
                    <NumberInput
                      value={comp.totalQuantity}
                      onValueChange={(v) => {
                        if (v !== null) onUpdateQuantity(comp.ingredientId, v)
                      }}
                      embedded
                      className="w-20"
                      disabled={disabled}
                      aria-label={t('totalQuantityAria', { name: comp.ingredient.name })}
                    />
                    {/* From `sm` the controls sit at the row end, so a minimum width keeps
                        the fields of "g", "ml" and "pc" rows in line. */}
                    <span className="text-foreground bg-muted border-l px-2 py-1.5 text-center text-sm sm:min-w-10">
                      {unitLabel}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="quiet"
                    size="sm"
                    onClick={() => onMarkAsVague(comp.ingredientId)}
                    disabled={disabled}
                  >
                    {t('noQuantity')}
                  </Button>
                </>
              )}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(comp.ingredientId)}
                disabled={disabled}
                aria-label={tCommon('removeNamed', { name: comp.ingredient.name })}
              >
                <X className="size-4" />
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
