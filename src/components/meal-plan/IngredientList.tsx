'use client'

import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Body, Ul, Li } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
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
  /** If true, uses smaller typography for compact layouts */
  compact?: boolean
  /** Custom header element (e.g., ServingControl) - overrides default "Ingredients (serves X)" */
  headerElement?: React.ReactNode
}

/**
 * Format quantity for display in meal detail view.
 *
 * Quantities are stored in native units (pieces for piece-based ingredients,
 * grams for weight-based ingredients). No conversion needed.
 *
 * For vague quantities, returns the original phrase (e.g., "to taste").
 */
function formatQuantity(
  quantityPerServing: number,
  householdSize: number,
  unit: 'g' | 'piece',
  isVague?: boolean,
  originalPhrase?: string | null,
): string {
  // For vague quantities, show the phrase instead of calculated amount
  if (isVague && originalPhrase) {
    return originalPhrase
  }

  const totalQuantity = quantityPerServing * householdSize

  if (unit === 'piece') {
    // Quantity is already in pieces
    const rounded = Math.round(totalQuantity * 10) / 10
    return rounded % 1 === 0 ? String(Math.floor(rounded)) : rounded.toFixed(1)
  }

  // For grams, round to nearest integer and add unit
  return `${Math.round(totalQuantity)}g`
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
  compact = false,
  headerElement,
}: IngredientListProps) {
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
        comp.isVague,
        comp.originalPhrase,
      )
      return `${comp.ingredient.name} (${qty})`
    })

    return `Staples: ${items.join(', ')}`
  }, [stapleComponents, servings])

  // Default header label
  const defaultHeader = (
    <Body variant="small" className={cn('font-semibold', compact && 'text-xs')}>
      Ingredients (serves {servings})
    </Body>
  )

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-3')}>
      <div className="flex items-center gap-2">
        {headerElement ?? defaultHeader}
        {availability && <AvailabilityIndicator availability={availability} />}
      </div>
      <Ul className={cn('my-0 ml-0', compact && 'text-xs leading-tight')}>
        {regularComponents.map((comp) => {
          // Use optimistic override if available, otherwise fall back to server state
          const serverHasIt = availableIds ? availableIds.has(comp.ingredientId) : true
          const hasIt = optimisticOverrides?.has(comp.ingredientId)
            ? optimisticOverrides.get(comp.ingredientId)!
            : serverHasIt
          const isMissing = !hasIt
          const isToggling = togglingIds?.has(comp.ingredientId) ?? false

          // When hideAvailability is true, don't show checkboxes or missing styling
          const showMissingStyle = isMissing && !hideAvailability
          const showCheckbox = onToggleAvailability && !hideAvailability

          return (
            <Li
              key={comp.ingredient.name}
              className={cn(
                'flex items-center gap-2',
                showMissingStyle && 'text-amber-600 dark:text-amber-400',
                isToggling && 'opacity-60',
              )}
            >
              {showCheckbox && (
                <Checkbox
                  checked={hasIt}
                  onCheckedChange={(checked) => handleCheckedChange(comp.ingredientId, checked)}
                  className={cn('h-4 w-4', compact && 'h-3 w-3')}
                  aria-label={`Mark ${comp.ingredient.name} as ${hasIt ? 'not available' : 'available'}`}
                />
              )}
              <span>{comp.ingredient.name}</span>
              <span
                className={cn(
                  'whitespace-nowrap',
                  showMissingStyle ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                  comp.isVague && 'italic',
                )}
              >
                {formatQuantity(
                  comp.quantityPerServing,
                  servings,
                  comp.ingredient.defaultUnit,
                  comp.isVague,
                  comp.originalPhrase,
                )}
              </span>
            </Li>
          )
        })}
      </Ul>
      {staplesLine && (
        <Body variant="muted" className={cn(compact && 'text-xs')}>
          {staplesLine}
        </Body>
      )}
    </div>
  )
}
