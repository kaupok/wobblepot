'use client'

import { AlertTriangle } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

import { IngredientSearch } from '@/components/household/IngredientSearch'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Body } from '@/components/ui/typography'
import type { IngredientResult } from '@/hooks/use-ingredient-search'
import { useRefocusAfterPending } from '@/hooks/use-refocus-after-pending'
import { useEnumLabel } from '@/lib/i18n/enum-label'
import { formatQuantity } from '@/lib/i18n/format-number'
import {
  type DisplayUnit,
  displayUnit,
  formatMeasure,
  withPieceUnit,
} from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import {
  type AdjustProposal,
  buildChangeSet,
  pickedQuantity,
} from '@/lib/meal-planning/adjust-proposal'

import type { EntryChange } from './types'
import type { NewEntryChange } from './use-entry-changes'

interface AdjustReviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The instruction the proposals answer; stored with them on Apply. */
  instruction: string
  proposals: AdjustProposal[]
  /** The entry's stored changes: the ones no proposal touches stay. */
  changes: EntryChange[]
  /** Ingredients the meal has, which the search marks as added. */
  existingIngredientIds: string[]
  isApplying: boolean
  /** Resolves true once stored; the dialog then closes. */
  onApply: (changes: NewEntryChange[]) => Promise<boolean>
  /** Opened from state, so Radix has no trigger to return focus to. */
  onCloseAutoFocus?: (event: Event) => void
}

interface RowState {
  checked: boolean
  /** The household's pick for a replacement the catalogue did not match. */
  picked: IngredientResult | null
}

/** The replacement a row brings in: its name, amount per serving and unit, and its id once known. */
function replacementOf(proposal: AdjustProposal, picked: IngredientResult | null) {
  const replacement = proposal.replacement
  if (!replacement) return null
  if (replacement.matched) {
    return {
      id: replacement.ingredient.id,
      name: replacement.ingredient.name,
      quantity: replacement.quantityPerServing,
      unit: displayUnit(replacement.ingredient),
    }
  }
  if (picked) {
    return {
      id: picked.id,
      name: picked.name,
      quantity: pickedQuantity(replacement, picked),
      unit: displayUnit(picked),
    }
  }
  return {
    id: null,
    name: replacement.name,
    quantity: replacement.quantity,
    unit: replacement.unit,
  }
}

/**
 * An amount per serving, as the ingredient list writes amounts ("100g",
 * "2 pc"), but with one decimal under 10: a serving's spice is "0.5g", and
 * the list's whole grams would round it to nothing.
 */
function useFormatAmount() {
  const locale = useLocale() as Locale
  const pieceLabel = useEnumLabel('Unit', 'piece')
  return (quantity: number, unit: DisplayUnit) => {
    if (unit === 'piece') {
      return withPieceUnit(
        formatQuantity(quantity, locale, { maximumFractionDigits: 1 }),
        pieceLabel,
      )
    }
    if (quantity < 10) {
      return `${formatQuantity(quantity, locale, { maximumFractionDigits: 1 })}${unit}`
    }
    return formatMeasure(quantity, unit, locale)
  }
}

/**
 * "Adjust recipe" review (HON-1244): one row per proposed change, ticked by
 * default, with the model's reason. A replacement the catalogue did not match
 * shows the ingredient search, and its row cannot apply until an ingredient
 * is picked or the row is unticked. Apply sends the entry's whole new change
 * set (`buildChangeSet`).
 */
export function AdjustReviewDialog({
  open,
  onOpenChange,
  instruction,
  proposals,
  changes,
  existingIngredientIds,
  isApplying,
  onApply,
  onCloseAutoFocus,
}: AdjustReviewDialogProps) {
  const t = useTranslations('meal-plan.adjust.review')
  const tCommon = useTranslations('common')
  const formatAmount = useFormatAmount()
  const idPrefix = useId()
  const [rows, setRows] = useState<RowState[]>([])
  // Apply is disabled while the set is stored; after a refusal the dialog
  // stays open, so focus goes back to it (docs/DESIGN.md → Focus management).
  const { ref: applyRef, requestRefocus } = useRefocusAfterPending(isApplying)

  // New proposals start ticked, with nothing picked.
  const [shown, setShown] = useState<AdjustProposal[] | null>(null)
  if (proposals !== shown) {
    setShown(proposals)
    setRows(proposals.map(() => ({ checked: true, picked: null })))
  }

  const update = (index: number, patch: Partial<RowState>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))

  const ticked = proposals.flatMap((proposal, i) => {
    const row = rows[i]
    return row?.checked ? [{ proposal, replacement: replacementOf(proposal, row.picked) }] : []
  })
  const unresolved = ticked.some(
    ({ replacement }) => replacement !== null && replacement.id === null,
  )
  const canApply = ticked.length > 0 && !unresolved && !isApplying

  const submit = async () => {
    if (!canApply) return
    const set = buildChangeSet(
      changes,
      ticked.map(({ proposal, replacement }) => ({
        proposal,
        replacementIngredientId: replacement?.id ?? null,
        quantityPerServing: replacement?.quantity ?? null,
      })),
    )
    if (await onApply(set)) onOpenChange(false)
    else requestRefocus()
  }

  const label = (proposal: AdjustProposal, replacement: ReturnType<typeof replacementOf>) => {
    if (proposal.op === 'remove' || !replacement) {
      return t('remove', { name: proposal.original?.name ?? '' })
    }
    const quantity = formatAmount(replacement.quantity, replacement.unit)
    return proposal.op === 'replace' && proposal.original
      ? t('replace', { original: proposal.original.name, replacement: replacement.name, quantity })
      : t('add', { name: replacement.name, quantity })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <Body variant="muted">{t('instruction', { instruction })}</Body>

        <ul className="flex flex-col gap-4">
          {proposals.map((proposal, i) => {
            const row = rows[i] ?? { checked: true, picked: null }
            const replacement = replacementOf(proposal, row.picked)
            const needsPick = proposal.replacement?.matched === false
            const id = `${idPrefix}-${i}`
            return (
              <li key={id} className="flex items-start gap-3">
                <Checkbox
                  id={id}
                  checked={row.checked}
                  onCheckedChange={(checked) => update(i, { checked: checked === true })}
                  disabled={isApplying}
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label htmlFor={id}>{label(proposal, replacement)}</Label>
                  {proposal.reason && <Body variant="muted">{proposal.reason}</Body>}
                  {needsPick && !row.picked && (
                    <div className="flex flex-col gap-2 pt-1">
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          aria-hidden="true"
                          className="text-warning mt-0.5 h-4 w-4 shrink-0"
                        />
                        <Body tone="warning">
                          {t('unmatched', {
                            name:
                              proposal.replacement?.matched === false
                                ? proposal.replacement.name
                                : '',
                          })}
                        </Body>
                      </div>
                      <IngredientSearch
                        disabled={isApplying}
                        existingIngredientIds={existingIngredientIds}
                        onAddIngredient={(picked) => update(i, { picked, checked: true })}
                      />
                    </div>
                  )}
                  {needsPick && row.picked && (
                    <div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => update(i, { picked: null })}
                        disabled={isApplying}
                        aria-label={t('pickedAria', { name: row.picked.name })}
                      >
                        {t('pickAnother')}
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        {ticked.length === 0 && <Body variant="muted">{t('nothingTicked')}</Body>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isApplying}>
            {tCommon('cancel')}
          </Button>
          <Button ref={applyRef} onClick={submit} disabled={!canApply}>
            {t('apply')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
