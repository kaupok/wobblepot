'use client'

import { useEffect, useRef } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Info, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/ui/number-input'
import { Body } from '@/components/ui/typography'
import { cn, prefersReducedMotion } from '@/lib/utils'
import { formatQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import {
  type MealComponent,
  formatAmountWithUnit,
  formatUnit,
  isMissingQuantity,
  suggestedQuantity,
} from './meal-form-types'
import type { Unit } from '@/generated/prisma/enums'

interface ComponentListProps {
  components: MealComponent[]
  servings: number
  disabled: boolean
  duplicateMap: Map<string, number[]>
  onRemove: (ingredientId: string) => void
  onUpdateQuantity: (ingredientId: string, quantity: number | null) => void
  onSetQuantity: (ingredientId: string, defaultUnit: Unit) => void
  onMarkAsVague: (ingredientId: string) => void
  /** Enter in a quantity field: the form sends focus back to the ingredient search. */
  onQuantityEnter: () => void
  /** Rows whose empty quantity shows the error: the ones empty at the last save attempt. */
  flaggedEmptyIds: ReadonlySet<string>
}

// Each quantity field carries `data-quantity-for={ingredientId}`.
function quantityInput(container: ParentNode, ingredientId: string) {
  return container.querySelector<HTMLInputElement>(`[data-quantity-for="${ingredientId}"]`)
}

/**
 * Focus a field and scroll it clear of the phone tab bar. The browser's own
 * focus scroll stops at the viewport edge, which is under the bar, so the field
 * carries `scroll-mb-above-tab-bar` and is scrolled to with that margin.
 */
export function focusClearOfTabBar(field: HTMLElement | null | undefined) {
  if (!field) return
  field.focus({ preventScroll: true })
  field.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

/** Focus the quantity field of the first row that `invalid_quantity` names. */
export function focusFirstInvalidQuantity(container: ParentNode, components: MealComponent[]) {
  const first = components.find(isMissingQuantity)
  if (first) focusClearOfTabBar(quantityInput(container, first.ingredientId))
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
  onQuantityEnter,
  flaggedEmptyIds,
}: ComponentListProps) {
  const locale = useLocale() as Locale
  const t = useTranslations('recipes.form.componentList')
  const tCommon = useTranslations('common')
  const vaguePhrase = useVaguePhrase()
  const pieceLabel = useEnumLabel('Unit', 'piece')
  const listRef = useRef<HTMLDivElement>(null)
  // The ids the last render showed; null before the first, so an edit form's
  // existing rows take no focus.
  const shownIdsRef = useRef<Set<string> | null>(null)

  // A newly added row gets focus in its quantity field, so the user types the
  // amount next (HON-1362). The search field keeps focus until then, so it never
  // falls to <body>.
  useEffect(() => {
    const shown = shownIdsRef.current
    shownIdsRef.current = new Set(components.map((c) => c.ingredientId))
    const last = components.at(-1)
    if (!shown || !last || shown.has(last.ingredientId) || !listRef.current) return
    focusClearOfTabBar(quantityInput(listRef.current, last.ingredientId))
  }, [components])

  if (components.length === 0) return null

  return (
    <div ref={listRef} className="flex flex-col gap-2">
      {components.map((comp, index) => {
        const quantity = comp.totalQuantity
        const isInvalidQuantity =
          !comp.isVague &&
          (quantity === null ? flaggedEmptyIds.has(comp.ingredientId) : quantity <= 0)
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
                  quantity !== null &&
                  t('perServing', {
                    quantity: formatAmountWithUnit(
                      formatQuantity(quantity / servings, locale, {
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
                      value={quantity}
                      onValueChange={(v) => onUpdateQuantity(comp.ingredientId, v)}
                      placeholder={formatQuantity(suggestedQuantity(comp.ingredient), locale)}
                      onKeyDown={(e) => {
                        // Enter would submit the form; move on to the next ingredient instead.
                        if (e.key !== 'Enter') return
                        e.preventDefault()
                        onQuantityEnter()
                      }}
                      aria-invalid={isInvalidQuantity || undefined}
                      data-quantity-for={comp.ingredientId}
                      embedded
                      className="scroll-mb-above-tab-bar w-20 md:scroll-mb-0"
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
