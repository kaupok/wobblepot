'use client'

import { useMemo } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { Checkbox } from '@/components/ui/checkbox'
import { Body, Heading, Ul, Li } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { formatInteger, formatQuantity as formatLocaleQuantity } from '@/lib/i18n/format-number'
import type { Locale } from '@/lib/i18n/locales'
import { useVaguePhrase } from '@/lib/i18n/enum-label'
import { AvailabilityIndicator, getIngredientAvailabilitySets } from './AvailabilityIndicator'
import type { MealAvailability, MealComponent, PantryIngredient } from './types'

interface IngredientListProps {
  components: MealComponent[]
  /** Number of servings to calculate quantities for */
  servings: number
  /** Household size (for display label reference) */
  householdSize?: number
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for pending indicator) */
  togglingIds?: Set<string>
  /** Optimistic availability overrides from in-flight toggles */
  optimisticOverrides?: Map<string, boolean>
  /** If provided, renders availability badge inline with header */
  availability?: MealAvailability | null
  /** If true, hides checkboxes and missing ingredient styling (for completed/skipped meals) */
  hideAvailability?: boolean
  /**
   * If false, rows the pantry lacks are not styled as missing, while the
   * checkboxes stay: a pantry holding only staples says nothing yet (HON-824).
   */
  showMissingStyle?: boolean
  /** Custom header element (e.g., ServingControl) - overrides default "Ingredients (serves X)" */
  headerElement?: React.ReactNode
}

/**
 * Format quantity for display in meal detail view.
 *
 * Quantities are stored in native units (pieces for piece-based ingredients,
 * grams for weight-based ingredients). No conversion needed.
 *
 * For vague quantities, returns the phrase in the household's language
 * (e.g., "to taste" / "maitse järgi").
 */
function formatQuantity(
  quantityPerServing: number,
  householdSize: number,
  unit: 'g' | 'piece',
  locale: Locale,
  isVague: boolean | undefined,
  originalPhrase: string | null | undefined,
  vaguePhrase: (phrase: string) => string,
): string {
  // For vague quantities, show the phrase instead of calculated amount
  if (isVague && originalPhrase) {
    return vaguePhrase(originalPhrase)
  }

  const totalQuantity = quantityPerServing * householdSize

  if (unit === 'piece') {
    // Quantity is already in pieces. Locale-aware so `et` renders "1,5" not
    // "1.5"; whole counts collapse to "3" and fractions pick up the locale
    // decimal separator (maximumFractionDigits: 1 matches the prior rounding).
    return formatLocaleQuantity(totalQuantity, locale, { maximumFractionDigits: 1 })
  }

  // For grams, round to nearest integer and add unit. Locale-aware so `et`
  // gets its non-breaking-space thousands separator on ≥1000g values.
  return `${formatInteger(totalQuantity, locale)}g`
}

export function IngredientList({
  components,
  servings,
  householdSize: _householdSize,
  pantryIngredients,
  onToggleAvailability,
  togglingIds,
  optimisticOverrides,
  availability,
  hideAvailability = false,
  showMissingStyle = true,
  headerElement,
}: IngredientListProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const tAvailability = useTranslations('meal-plan.availability')
  const locale = useLocale() as Locale
  const vaguePhrase = useVaguePhrase()
  // Build maps for availability and staple status
  const { availableIds, stapleIds } = useMemo(() => {
    if (!pantryIngredients) {
      return { availableIds: null as Set<string> | null, stapleIds: new Set<string>() }
    }
    return getIngredientAvailabilitySets(pantryIngredients)
  }, [pantryIngredients])

  // Separate regular ingredients from staples
  const { regularComponents, stapleComponents } = useMemo(() => {
    const regular: MealComponent[] = []
    const staples: MealComponent[] = []

    for (const comp of components) {
      if (stapleIds.has(comp.ingredientId)) {
        staples.push(comp)
      } else {
        regular.push(comp)
      }
    }

    return { regularComponents: regular, stapleComponents: staples }
  }, [components, stapleIds])

  const handleCheckedChange = (ingredientId: string, checked: boolean | 'indeterminate') => {
    if (checked === 'indeterminate' || !onToggleAvailability) return
    onToggleAvailability(ingredientId, checked)
  }

  // Format staples line: "Staples: garlic (15g), olive oil (45g)" or "garlic (to taste)"
  const staplesLine = useMemo(() => {
    if (stapleComponents.length === 0) return null

    const items = stapleComponents.map((comp) => {
      const qty = formatQuantity(
        comp.quantityPerServing,
        servings,
        comp.ingredient.defaultUnit,
        locale,
        comp.isVague,
        comp.originalPhrase,
        vaguePhrase,
      )
      return `${comp.ingredient.name} (${qty})`
    })

    return tDetail('staplesPrefix', { list: items.join(', ') })
  }, [stapleComponents, servings, tDetail, locale, vaguePhrase])

  // Default header label: a section of the cook view, at the Title level
  // (docs/DESIGN.md → "Cook view", HON-932).
  const defaultHeader = (
    <Heading variant="h4" as="h3" className="whitespace-nowrap">
      {tDetail('ingredientsHeader', { count: servings })}
    </Heading>
  )

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {headerElement ?? defaultHeader}
        {availability && <AvailabilityIndicator availability={availability} size="lg" />}
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

          const quantity = (
            <span
              className={cn(
                'w-24 shrink-0 tabular-nums',
                markMissing ? 'text-warning' : 'text-muted-foreground',
                comp.isVague && 'italic',
              )}
            >
              {formatQuantity(
                comp.quantityPerServing,
                servings,
                comp.ingredient.defaultUnit,
                locale,
                comp.isVague,
                comp.originalPhrase,
                vaguePhrase,
              )}
            </span>
          )

          return (
            <Li
              key={comp.ingredient.name}
              tone={markMissing ? 'warning' : 'default'}
              className={cn(isToggling && 'opacity-60')}
            >
              {showCheckbox ? (
                // A `label` around the checkbox, so a tap anywhere on the row
                // toggles it. The checkbox keeps its own `aria-label`, which
                // carries the action as well as the name.
                <label className="min-h-touch flex cursor-pointer items-center gap-3 py-1 text-base">
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
                  <span>{comp.ingredient.name}</span>
                </label>
              ) : (
                <div className="min-h-touch flex items-center gap-3 py-1 text-base">
                  {quantity}
                  <span>{comp.ingredient.name}</span>
                </div>
              )}
            </Li>
          )
        })}
      </Ul>
      {staplesLine && <Body variant="muted">{staplesLine}</Body>}
    </div>
  )
}
