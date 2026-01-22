'use client'

import { useMemo } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Body, Ul, Li } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { AvailabilityIndicator } from './AvailabilityIndicator'
import type { MealAvailability, MealComponent, PantryIngredient } from './types'

interface IngredientListProps {
  components: MealComponent[]
  householdSize: number
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for loading state) */
  togglingIds?: Set<string>
  /** If provided, renders availability badge inline with header */
  availability?: MealAvailability | null
  /** If true, hides checkboxes and missing ingredient styling (for completed/skipped meals) */
  hideAvailability?: boolean
  /** If true, uses smaller typography for compact layouts */
  compact?: boolean
}

/**
 * Format quantity for display in meal detail view.
 *
 * Note: Quantities are stored in grams for all ingredients.
 * When defaultUnit is 'piece', we convert using gramsPerPiece.
 */
function formatQuantity(
  quantityPerServingInGrams: number,
  householdSize: number,
  unit: 'g' | 'piece',
  gramsPerPiece: number | null | undefined,
): string {
  const totalQuantityInGrams = quantityPerServingInGrams * householdSize

  if (unit === 'piece') {
    // Convert grams to pieces
    if (gramsPerPiece && gramsPerPiece > 0) {
      const pieces = totalQuantityInGrams / gramsPerPiece
      // Round to one decimal for display, remove .0 for whole numbers
      const rounded = Math.round(pieces * 10) / 10
      return rounded % 1 === 0 ? String(Math.floor(rounded)) : rounded.toFixed(1)
    }
    // Fallback: if no gramsPerPiece, show as grams
    return `${Math.round(totalQuantityInGrams)}g`
  }

  // For grams, round to nearest integer and add unit
  return `${Math.round(totalQuantityInGrams)}g`
}

export function IngredientList({
  components,
  householdSize,
  pantryIngredients,
  onToggleAvailability,
  togglingIds,
  availability,
  hideAvailability = false,
  compact = false,
}: IngredientListProps) {
  // Build maps for availability and staple status
  const { availableIds, stapleIds } = useMemo(() => {
    if (!pantryIngredients) {
      return { availableIds: null, stapleIds: new Set<string>() }
    }
    return {
      availableIds: new Set(pantryIngredients.map((p) => p.ingredientId)),
      stapleIds: new Set(pantryIngredients.filter((p) => p.isStaple).map((p) => p.ingredientId)),
    }
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

  // Format staples line: "Staples: garlic (15g), olive oil (45g)"
  const staplesLine = useMemo(() => {
    if (stapleComponents.length === 0) return null

    const items = stapleComponents.map((comp) => {
      const qty = formatQuantity(
        comp.quantityPerServing,
        householdSize,
        comp.ingredient.defaultUnit,
        comp.ingredient.gramsPerPiece,
      )
      return `${comp.ingredient.name} (${qty})`
    })

    return `Staples: ${items.join(', ')}`
  }, [stapleComponents, householdSize])

  return (
    <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-3')}>
      <div className="flex items-center gap-2">
        <Body variant="small" className={cn('font-semibold', compact && 'text-[10px]')}>
          Ingredients (serves {householdSize})
        </Body>
        {availability && <AvailabilityIndicator availability={availability} />}
      </div>
      <Ul className={cn('my-0 ml-4', compact && 'text-[10px] leading-tight')}>
        {regularComponents.map((comp) => {
          const hasIt = availableIds ? availableIds.has(comp.ingredientId) : true
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
              )}
            >
              {showCheckbox && (
                <Checkbox
                  checked={hasIt}
                  onCheckedChange={(checked) => handleCheckedChange(comp.ingredientId, checked)}
                  disabled={isToggling}
                  className={cn('h-4 w-4', compact && 'h-3 w-3')}
                  aria-label={`Mark ${comp.ingredient.name} as ${hasIt ? 'not available' : 'available'}`}
                />
              )}
              <span>{comp.ingredient.name}</span>
              <span
                className={cn(
                  'whitespace-nowrap',
                  showMissingStyle ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}
              >
                {formatQuantity(
                  comp.quantityPerServing,
                  householdSize,
                  comp.ingredient.defaultUnit,
                  comp.ingredient.gramsPerPiece,
                )}
              </span>
            </Li>
          )
        })}
      </Ul>
      {staplesLine && (
        <Body variant="muted" className={cn(compact && 'text-[10px]')}>
          {staplesLine}
        </Body>
      )}
    </div>
  )
}
