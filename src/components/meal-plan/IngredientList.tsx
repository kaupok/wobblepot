'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import {
  EntryChangeRowActions,
  LeftOutRow,
  StaleChangeRow,
  AddIngredientButton,
} from './IngredientChangeRows'
import { Body, Heading, Ul, Li } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { formatQuantity as formatLocaleQuantity } from '@/lib/i18n/format-number'
import { displayUnit, formatMeasure, withPieceUnit } from '@/lib/i18n/format-shopping-quantity'
import { formatPieceFraction, recipePieceCount } from '@/lib/i18n/format-piece-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { useEnumLabel, useVaguePhrase } from '@/lib/i18n/enum-label'
import { AvailabilityStatus, getIngredientAvailabilitySets } from './AvailabilityIndicator'
import type { EntryChange, MealAvailability, MealComponent, PantryIngredient } from './types'

/**
 * The change controls of a planned entry (HON-1243). Omitted for a cooked or
 * skipped entry, whose changes stay visible but read-only.
 */
export interface IngredientChangeControls {
  onReplace: (component: MealComponent) => void
  onLeaveOut: (component: MealComponent) => void
  onAdd: () => void
  onUndo: (change: EntryChange) => void
  /** The change an Undo is in flight for. */
  undoingId?: string
  /** A change is being stored: the controls wait. */
  disabled?: boolean
  /**
   * "Add an ingredient": where focus goes after a change, because the row
   * that held focus is replaced when the list comes back (docs/DESIGN.md →
   * Focus management).
   */
  addButtonRef?: React.Ref<HTMLButtonElement>
}

interface IngredientListProps {
  components: MealComponent[]
  /** Number of servings to calculate quantities for */
  servings: number
  /** Household servings, the members' portions summed (for display label reference) */
  householdServings?: number
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for pending indicator) */
  togglingIds?: Set<string>
  /** Optimistic availability overrides from in-flight toggles */
  optimisticOverrides?: Map<string, boolean>
  /** If provided, the pantry's verdict follows the heading as text */
  availability?: MealAvailability | null
  /** If true, hides checkboxes and missing ingredient styling (for completed/skipped meals) */
  hideAvailability?: boolean
  /**
   * If false, rows the pantry lacks are not styled as missing, while the
   * checkboxes stay: a pantry holding only staples says nothing yet (HON-824).
   */
  showMissingStyle?: boolean
  /**
   * The entry's own ingredient changes (HON-1243). `components` already has
   * them merged; these mark the replaced and added rows and bring back the
   * left-out and stale ones.
   */
  changes?: EntryChange[]
  changeControls?: IngredientChangeControls
}

/**
 * Format quantity for display in meal detail view.
 *
 * Quantities are stored in native units (pieces for piece-based ingredients,
 * grams for weight-based ingredients). No conversion needed.
 *
 * For vague quantities, returns the phrase in the household's language
 * (e.g., "to taste" / "maitse järgi"). Piece counts carry `pieceLabel`
 * ("1.5 pc" / "1,5 tk", HON-956).
 *
 * A gram-stored vegetable under the piece rule shows quarter pieces first and
 * keeps its grams as `grams`, so a cook who wants precision still has it:
 * "¾ pc" and "83g" (HON-1312).
 */
function formatQuantity(
  comp: MealComponent,
  servings: number,
  locale: Locale,
  vaguePhrase: (phrase: string) => string,
  pieceLabel: string,
): { amount: string; grams: string | null } {
  // For vague quantities, show the phrase instead of calculated amount
  if (comp.isVague && comp.originalPhrase) {
    return { amount: vaguePhrase(comp.originalPhrase), grams: null }
  }

  const totalQuantity = comp.quantityPerServing * servings
  const unit = displayUnit(comp.ingredient)

  if (unit === 'piece') {
    // Quantity is already in pieces. Locale-aware so `et` renders "1,5" not
    // "1.5"; whole counts collapse to "3" and fractions pick up the locale
    // decimal separator (maximumFractionDigits: 1 matches the prior rounding).
    return {
      amount: withPieceUnit(
        formatLocaleQuantity(totalQuantity, locale, { maximumFractionDigits: 1 }),
        pieceLabel,
      ),
      grams: null,
    }
  }

  // Grams switch to kg at 1000g, as on the shopping list and pantry (HON-950);
  // a liquid shows in ml and switches to l (HON-1054).
  const measure = formatMeasure(totalQuantity, unit, locale)
  const pieces = recipePieceCount(totalQuantity, comp.ingredient)
  if (pieces == null) return { amount: measure, grams: null }
  return { amount: withPieceUnit(formatPieceFraction(pieces, locale), pieceLabel), grams: measure }
}

export function IngredientList({
  components,
  servings,
  householdServings: _householdServings,
  pantryIngredients,
  onToggleAvailability,
  togglingIds,
  optimisticOverrides,
  availability,
  hideAvailability = false,
  showMissingStyle = true,
  changes = [],
  changeControls,
}: IngredientListProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const tAvailability = useTranslations('meal-plan.availability')
  const tChanges = useTranslations('meal-plan.changes')
  const locale = useLocale() as Locale
  const vaguePhrase = useVaguePhrase()
  const pieceLabel = useEnumLabel('Unit', 'piece')
  // Build maps for availability and staple status
  const { availableIds, stapleIds } = useMemo(() => {
    if (!pantryIngredients) {
      return { availableIds: null as Set<string> | null, stapleIds: new Set<string>() }
    }
    return getIngredientAvailabilitySets(pantryIngredients)
  }, [pantryIngredients])

  // The change behind each merged row, by the ingredient now in the row: a
  // replacement or an added ingredient. Left-out and stale changes have no row
  // in `components`, so they render on their own below.
  const changeByIngredient = useMemo(() => {
    const map = new Map<string, EntryChange>()
    for (const change of changes) {
      if (!change.stale && change.replacement) map.set(change.replacement.id, change)
    }
    return map
  }, [changes])
  const hasCheckboxes = !!onToggleAvailability && !hideAvailability
  const leftOut = changes.filter((c) => !c.stale && !c.replacement && c.original)
  const stale = changes.filter((c) => c.stale)

  // Separate regular ingredients from staples. A changed ingredient is always
  // a row, so its change and its Undo stay visible.
  const { regularComponents, stapleComponents } = useMemo(() => {
    const regular: MealComponent[] = []
    const staples: MealComponent[] = []

    for (const comp of components) {
      if (stapleIds.has(comp.ingredientId) && !changeByIngredient.has(comp.ingredientId)) {
        staples.push(comp)
      } else {
        regular.push(comp)
      }
    }

    return { regularComponents: regular, stapleComponents: staples }
  }, [components, stapleIds, changeByIngredient])

  const handleCheckedChange = (ingredientId: string, checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate' || !onToggleAvailability) return
    onToggleAvailability(ingredientId, checked)
  }

  // Format staples line: "Staples: garlic (15g), olive oil (45g)" or "garlic (to taste)"
  const staplesLine = useMemo(() => {
    if (stapleComponents.length === 0) return null

    const items = stapleComponents.map((comp) => {
      const { amount, grams } = formatQuantity(comp, servings, locale, vaguePhrase, pieceLabel)
      return `${comp.ingredient.name} (${grams ? `${amount}, ${grams}` : amount})`
    })

    return tDetail('staplesPrefix', { list: items.join(', ') })
  }, [stapleComponents, servings, tDetail, locale, vaguePhrase, pieceLabel])

  return (
    <div className="flex flex-col gap-3">
      {/* A section of the cook view, at the Title level (docs/DESIGN.md →
          "Cook view", HON-932), then the pantry's verdict as text on its
          baseline: "Ingredients 1 to buy" (HON-1025). Serves is in the badge
          row above, with the meal's other facts. */}
      {/* The list's action ends its title row (HON-1357): the heading and
          the status share a baseline inside their own group, the row centres
          the button on that group, and on a wrap `ml-auto` holds the button
          to the right edge, under the status, never over it. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <Heading variant="h4" as="h3" className="whitespace-nowrap">
            {tDetail('ingredientsTitle')}
          </Heading>
          {availability && <AvailabilityStatus availability={availability} />}
        </div>
        {changeControls && (
          <AddIngredientButton
            controls={changeControls}
            buttonRef={changeControls.addButtonRef}
            className="ml-auto"
          />
        )}
      </div>
      {/* Rows are read from a counter and tapped with a knuckle (HON-932):
          18px, at least 44px tall, quantity first in a fixed-width column so
          the names line up, and the whole row is the checkbox's label. */}
      <Ul variant="plain">
        {regularComponents.map((comp) => {
          // Use optimistic override if available, otherwise fall back to server state
          const serverHasIt = availableIds ? availableIds.has(comp.ingredientId) : true
          const hasIt = optimisticOverrides?.has(comp.ingredientId)
            ? optimisticOverrides.get(comp.ingredientId)!
            : serverHasIt
          const isMissing = !hasIt
          const isToggling = togglingIds?.has(comp.ingredientId) ?? false

          // When hideAvailability is true, don't show checkboxes or missing styling
          const markMissing = isMissing && !hideAvailability && showMissingStyle
          const showCheckbox = onToggleAvailability && !hideAvailability

          const { amount, grams } = formatQuantity(comp, servings, locale, vaguePhrase, pieceLabel)
          // The grams under a piece count go on their own line, so the
          // column keeps its width and the names stay lined up (HON-1312).
          const quantity = (
            <span
              className={cn(
                'flex w-24 shrink-0 flex-col tabular-nums',
                markMissing ? 'text-warning' : 'text-muted-foreground',
                comp.isVague && 'italic',
              )}
            >
              <span>{amount}</span>
              {grams && <span className="text-muted-foreground text-sm">{grams}</span>}
            </span>
          )

          const change = changeByIngredient.get(comp.ingredientId)
          const name = (
            // A change reads as a muted line under the name, never a badge
            // beside it, so the name keeps its column and wraps inside it
            // (HON-1370).
            <span className="flex min-w-0 flex-col wrap-break-word">
              <span>{comp.ingredient.name}</span>
              {change && (
                <span className="text-muted-foreground text-base">
                  {change.original
                    ? tChanges('insteadOf', { name: change.original.name })
                    : tChanges('added')}
                </span>
              )}
            </span>
          )

          return (
            <Li
              key={comp.ingredient.name}
              tone={markMissing ? 'warning' : 'default'}
              className={cn('flex items-center gap-2', isToggling && 'opacity-60')}
            >
              {showCheckbox ? (
                // A `label` around the checkbox, so a tap anywhere on the row
                // toggles it. The checkbox keeps its own `aria-label`, which
                // carries the action as well as the name.
                <label className="min-h-touch flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1 text-base">
                  <Checkbox
                    size="lg"
                    checked={hasIt}
                    onCheckedChange={(checked) => handleCheckedChange(comp.ingredientId, checked)}
                    aria-label={tAvailability('ariaToggle', {
                      name: comp.ingredient.name,
                      state: hasIt
                        ? tAvailability('stateUnavailable')
                        : tAvailability('stateAvailable'),
                    })}
                  />
                  {quantity}
                  {name}
                </label>
              ) : (
                <div className="min-h-touch flex min-w-0 flex-1 items-center gap-3 py-1 text-base">
                  {quantity}
                  {name}
                </div>
              )}
              <EntryChangeRowActions component={comp} change={change} controls={changeControls} />
            </Li>
          )
        })}
        {leftOut.map((change) => (
          <LeftOutRow
            key={change.id}
            change={change}
            controls={changeControls}
            checkboxColumn={hasCheckboxes}
          />
        ))}
        {stale.map((change) => (
          <StaleChangeRow
            key={change.id}
            change={change}
            controls={changeControls}
            checkboxColumn={hasCheckboxes}
          />
        ))}
      </Ul>
      {staplesLine && <Body variant="paragraph">{staplesLine}</Body>}
    </div>
  )
}
