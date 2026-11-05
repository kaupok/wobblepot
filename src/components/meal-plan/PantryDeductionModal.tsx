'use client'

import { Star } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ChoiceChips } from '@/components/ui/choice-chips'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Body } from '@/components/ui/typography'
import type { IngredientCategory } from '@/generated/prisma/enums'
import { type DisplayUnit, displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { defaultCookOutcome } from '@/lib/pantry/cook-outcome'

import { sidesToCharge, slotComponents } from './side-dishes'
import type { MealComponent, PantryDeductionItem, PantryItemFull, PlanEntrySide } from './types'

interface PantryDeductionModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  mealName: string
  /** The main's own rows; the sides' rows come from `sides`. */
  components: MealComponent[]
  householdServings: number
  pantryItems: PantryItemFull[]
  /**
   * The main's sides (HON-1611). Each one Cooked charges is listed under
   * "Made", checked; unchecking one drops its rows from the sum at once.
   * Its components are scaled to the side's own servings, so pass sides only
   * with `householdServings` 1 and `components` already scaled.
   */
  sides?: readonly PlanEntrySide[]
  /**
   * With the cook's answer when the dialog shows a row, and with none when it
   * shows none, so the server's default decides. The server reads a sent list
   * as the answer for every null row, so a row added after the page loaded is
   * kept as "Some left". `made` comes only when the dialog lists a side.
   */
  onConfirm: (answer?: CookAnswer, made?: SidesMade) => void
  isLoading?: boolean
  /**
   * The dialog opens from state, with no `DialogTrigger` for Radix to return
   * focus to, so without this it lands on the page body (docs/DESIGN.md → Focus
   * management).
   */
  onCloseAutoFocus?: (event: Event) => void
}

/** What the cook said about each row (HON-1564, HON-1583, HON-1588). */
export interface CookAnswer {
  /**
   * The "have some" rows and staples at "Used up", and the known rows the cook
   * switched to it. `[]` when there are none. A known row the sum runs out is left to the
   * server's subtraction, which reads the live pantry, so a preview from a
   * stale pantry cannot zero a row that was restocked meanwhile.
   */
  usedUpIngredientIds: string[]
  /**
   * The rows at "Some left" the server acts on: a known row the sum runs out,
   * kept as "have some" (HON-1583), and any running-low row, staples
   * included, whose mark clears (HON-1592). `[]` when there are none.
   */
  someLeftIngredientIds: string[]
  /** Every row at "Running low", staples included. `[]` when there are none. */
  lowIngredientIds: string[]
  /** The rows at each choice, and the staple rows, for the completion event. */
  usedUpCount: number
  someLeftCount: number
  lowCount: number
  stapleRows: number
}

/** The sides the cook unchecked under "Made", which the completion skips (HON-1611). */
export interface SidesMade {
  skippedSideIds: string[]
}

type HaveSomeChoice = 'usedUp' | 'runningLow' | 'someLeft'

const NO_SIDES: readonly PlanEntrySide[] = []

/**
 * The pantry rows a cooked meal touches, one per ingredient, in the order the
 * meal lists them. A known quantity subtracts; a "have some" row
 * (`quantity: null`) carries the default `defaultCookOutcome` gives it, the
 * rule the server applies when no one chose (HON-1563). A staple is never
 * subtracted, so its row shows no amount and defaults to "Some left"
 * (HON-1588); a starter staple (salt, black pepper, water) and a vague
 * component ("to taste") get no row.
 */
export function computeDeductions(
  components: MealComponent[],
  servings: number,
  pantryItems: PantryItemFull[],
): PantryDeductionItem[] {
  const pantryMap = new Map(pantryItems.map((item) => [item.ingredientId, item]))

  // A meal can list one ingredient in two components; the server charges the
  // sum, so the preview does too.
  const amountUsed = new Map<string, number>()
  for (const component of components) {
    amountUsed.set(
      component.ingredientId,
      (amountUsed.get(component.ingredientId) ?? 0) + component.quantityPerServing * servings,
    )
  }

  const deductions: PantryDeductionItem[] = []
  const seen = new Set<string>()

  for (const component of components) {
    if (seen.has(component.ingredientId)) continue
    seen.add(component.ingredientId)

    const pantryItem = pantryMap.get(component.ingredientId)
    if (!pantryItem) continue

    const deductionAmount = amountUsed.get(component.ingredientId) ?? 0

    if (pantryItem.isStaple) {
      if (pantryItem.starterStaple || component.isVague) continue
      deductions.push({
        ingredientId: component.ingredientId,
        ingredientName: component.ingredient.name,
        unit: displayUnit(component.ingredient),
        currentQuantity: null,
        deductionAmount,
        newQuantity: null,
        willBeRemoved: false,
        outcome: 'someLeft',
        isStaple: true,
        low: pantryItem.low ?? false,
      })
      continue
    }

    const currentQuantity = pantryItem.quantity
    const outcome = defaultCookOutcome({
      pantryQuantity: currentQuantity,
      isStaple: pantryItem.isStaple,
      // The page's pantry carries the Prisma enum as a plain string.
      category: pantryItem.ingredient.category as IngredientCategory,
      subcategory: pantryItem.ingredient.subcategory ?? null,
      defaultUnit: pantryItem.ingredient.defaultUnit,
      amountUsed: deductionAmount,
    })
    // Never null: staples are handled above.
    if (outcome === null) continue

    const newQuantity = currentQuantity === null ? null : currentQuantity - deductionAmount

    deductions.push({
      ingredientId: component.ingredientId,
      ingredientName: component.ingredient.name,
      unit: displayUnit(component.ingredient),
      currentQuantity,
      deductionAmount,
      newQuantity: newQuantity === null || newQuantity <= 0 ? null : newQuantity,
      willBeRemoved: newQuantity !== null && newQuantity <= 0,
      outcome,
      isStaple: false,
      low: pantryItem.low ?? false,
    })
  }

  return deductions
}

type FormatQuantityFn = (quantity: number | null, unit: DisplayUnit) => string

export function PantryDeductionModal({
  open,
  onOpenChange,
  mealName,
  components,
  householdServings,
  pantryItems,
  sides = NO_SIDES,
  onConfirm,
  isLoading = false,
  onCloseAutoFocus,
}: PantryDeductionModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        {/* Radix unmounts the content on close, so each opening starts from
            the defaults again: the card and the past-meals row keep this
            dialog mounted. */}
        <DeductionContent
          mealName={mealName}
          components={components}
          householdServings={householdServings}
          pantryItems={pantryItems}
          sides={sides}
          onCancel={() => onOpenChange(false)}
          onConfirm={onConfirm}
          isLoading={isLoading}
        />
      </DialogContent>
    </Dialog>
  )
}

function DeductionContent({
  mealName,
  components,
  householdServings,
  pantryItems,
  sides,
  onCancel,
  onConfirm,
  isLoading,
}: {
  mealName: string
  components: MealComponent[]
  householdServings: number
  pantryItems: PantryItemFull[]
  sides: readonly PlanEntrySide[]
  onCancel: () => void
  onConfirm: (answer?: CookAnswer, made?: SidesMade) => void
  isLoading: boolean
}) {
  const t = useTranslations('meal-plan.deduction')
  const tPantry = useTranslations('pantry')
  const tCommon = useTranslations('common')
  // Only the rows the cook changed; the rest read their default, so a row
  // that appears while the dialog is open (a refreshed pantry) gets one too.
  const [choices, setChoices] = useState<Record<string, HaveSomeChoice>>({})
  // The sides unchecked under "Made": not made, so their rows leave the sum.
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set())
  const madeSides = useMemo(() => sidesToCharge(sides), [sides])
  const madeLegendId = useId()
  const deductions = useMemo(
    () =>
      computeDeductions(
        [
          ...components,
          ...slotComponents(
            [],
            0,
            madeSides.filter((side) => !skipped.has(side.entryId)),
          ),
        ],
        householdServings,
        pantryItems,
      ),
    [components, madeSides, skipped, householdServings, pantryItems],
  )

  const formatQuantity: FormatQuantityFn = (quantity, unit) => {
    if (quantity === null) return t('someQuantity')
    if (unit === 'piece') {
      return t('pieceQuantity', { count: quantity })
    }
    // A liquid reads in ml, 1 g = 1 ml (HON-1054).
    if (unit === 'ml') {
      return t('millilitresQuantity', { count: Math.round(quantity) })
    }
    return t('gramsQuantity', { count: Math.round(quantity) })
  }

  // A row already running low opens at "Running low", so the dialog shows
  // its state. Else a known row opens at what the sum says, and a "have some"
  // row or a staple at its default. Nothing opens at "Running low" otherwise.
  // "Some left" is more than "Running low", so switching a low row to it
  // clears the mark (HON-1592).
  const choiceOf = (item: PantryDeductionItem): HaveSomeChoice =>
    choices[item.ingredientId] ??
    (item.low
      ? 'runningLow'
      : item.currentQuantity === null
        ? item.outcome === 'usedUp'
          ? 'usedUp'
          : 'someLeft'
        : item.willBeRemoved
          ? 'usedUp'
          : 'someLeft')

  // What a known row will read after Confirm. "Some left" on a row the sum
  // runs out has an unknown amount, so it reads "some", and "Running low" on
  // one reads "a little".
  const resultOf = (item: PantryDeductionItem) => {
    const choice = choiceOf(item)
    if (choice === 'usedUp') return tPantry('ranOut')
    if (choice === 'runningLow') {
      return item.newQuantity === null
        ? t('lowQuantity')
        : t('lowResult', { quantity: formatQuantity(item.newQuantity, item.unit) })
    }
    return formatQuantity(item.newQuantity, item.unit)
  }

  const choiceOptions = [
    { value: 'usedUp', label: t('usedUp') },
    { value: 'runningLow', label: t('runningLow') },
    { value: 'someLeft', label: t('someLeft') },
  ]

  function confirm(answer?: CookAnswer) {
    if (madeSides.length === 0) {
      // No answer is no argument, so the caller's default reads as before.
      if (answer) onConfirm(answer)
      else onConfirm()
      return
    }
    onConfirm(answer, {
      skippedSideIds: madeSides
        .filter((side) => skipped.has(side.entryId))
        .map((side) => side.entryId),
    })
  }

  function handleConfirm() {
    if (deductions.length === 0) {
      confirm()
      return
    }
    const usedUp = deductions.filter((item) => choiceOf(item) === 'usedUp')
    const someLeft = deductions.filter((item) => choiceOf(item) === 'someLeft')
    const low = deductions.filter((item) => choiceOf(item) === 'runningLow')
    confirm({
      usedUpIngredientIds: usedUp
        .filter((item) => !item.willBeRemoved)
        .map((item) => item.ingredientId),
      // A "have some" row at "Some left" goes here so it stays: the server
      // gives a row in no list its default, so a row added after this dialog
      // loaded still gets one (HON-1582). The default never touches a staple,
      // so a staple goes here only when it is low. A known row goes here when the sum
      // runs it out, so it reads "have some", or when it is low, so its mark
      // clears. Any other known row is in no list, so the server subtracts
      // from the live pantry and a row emptied since this dialog loaded reads
      // "ran out".
      someLeftIngredientIds: someLeft
        .filter(
          (item) =>
            (item.currentQuantity === null && !item.isStaple) || item.willBeRemoved || item.low,
        )
        .map((item) => item.ingredientId),
      lowIngredientIds: low.map((item) => item.ingredientId),
      usedUpCount: usedUp.length,
      someLeftCount: someLeft.length,
      lowCount: low.length,
      stapleRows: deductions.filter((item) => item.isStaple).length,
    })
  }

  const hasDeductions = deductions.length > 0

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>
          {hasDeductions ? t('willDeduct', { mealName }) : t('noDeduction', { mealName })}
        </DialogDescription>
      </DialogHeader>

      {madeSides.length > 0 && (
        <div role="group" aria-labelledby={madeLegendId}>
          <Body id={madeLegendId} variant="small">
            {t('madeLegend')}
          </Body>
          <ul className="mt-1">
            {madeSides.map((side) => (
              <li key={side.entryId}>
                <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                  <Checkbox
                    checked={!skipped.has(side.entryId)}
                    onCheckedChange={(checked) =>
                      setSkipped((prev) => {
                        const next = new Set(prev)
                        if (checked === true) next.delete(side.entryId)
                        else next.add(side.entryId)
                        return next
                      })
                    }
                    disabled={isLoading}
                  />
                  {side.mealName}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hasDeductions && (
        <div className="max-h-80 overflow-y-auto">
          <ul className="space-y-2">
            {deductions.map((item) => (
              // Wraps the control under a long name on a phone.
              <li
                key={item.ingredientId}
                className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm"
              >
                <span className="flex items-center gap-1 font-medium">
                  {item.ingredientName}
                  {item.isStaple && (
                    <>
                      <Star aria-hidden className="fill-warning text-warning size-4" />
                      <span className="sr-only">{t('staple')}</span>
                    </>
                  )}
                </span>
                <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                  {item.currentQuantity !== null ? (
                    <span className="text-muted-foreground">
                      {formatQuantity(item.currentQuantity, item.unit)}
                      {' → '}
                      {resultOf(item)}
                    </span>
                  ) : (
                    // No amount to subtract from: only "Running low" changes the text.
                    choiceOf(item) === 'runningLow' && (
                      <span className="text-muted-foreground">
                        {'→ '}
                        {t('lowQuantity')}
                      </span>
                    )
                  )}
                  <ChoiceChips
                    aria-label={t('choiceLabel', { name: item.ingredientName })}
                    size="sm-touch"
                    value={choiceOf(item)}
                    onValueChange={(value) =>
                      setChoices((prev) => ({
                        ...prev,
                        [item.ingredientId]: value as HaveSomeChoice,
                      }))
                    }
                    options={choiceOptions}
                    disabled={isLoading}
                  />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasDeductions && <Body variant="muted">{t('noPantryItemsBody')}</Body>}

      <DialogFooter>
        <Button variant="outline" onClick={onCancel} disabled={isLoading}>
          {tCommon('cancel')}
        </Button>
        <Button onClick={handleConfirm} disabled={isLoading}>
          {isLoading ? t('updating') : t('confirm')}
        </Button>
      </DialogFooter>
    </>
  )
}
