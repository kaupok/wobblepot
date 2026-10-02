'use client'

import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { Clock } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { Body, Heading } from '@/components/ui/typography'
import { NutritionDisclaimer } from '@/components/NutritionDisclaimer'
import { NutritionSummary } from './NutritionSummary'
import { IngredientList } from './IngredientList'
import { KidFriendlyBadge } from './KidFriendlyBadge'
import { MyRecipeBadge } from './MyRecipeBadge'
import { computeMealAvailability, hasPantryData } from './AvailabilityIndicator'
import { PreparationEquipment, PreparationSteps } from './PreparationTips'
import { ServingControl } from './ServingControl'
import type { MealStatus } from './StatusSelect'
import type { MealData, PantryIngredient, StructuredTips } from './types'

interface MealDetailProps {
  meal: MealData
  /**
   * The meal's hero illustration, rendered first (`MealImage`, HON-737). Pass
   * nothing when there is no image to show, so the title clears the close
   * button instead of sitting under it.
   */
  image?: ReactNode
  /** The meal's name: the dialog's title in the cook view */
  title?: ReactNode
  /** The plan entry's note (`NoteEditor`), below the meta row */
  note?: ReactNode
  householdSize: number
  /** Status of the plan entry this meal belongs to */
  status?: MealStatus
  /** Current effective servings (servingOverride or householdSize) */
  servings?: number
  /** Handler for serving count changes. Ignored for a completed entry. */
  onServingsChange?: (servings: number | null) => Promise<boolean>
  pantryIngredients?: PantryIngredient[]
  /** If provided, renders checkboxes to toggle ingredient availability */
  onToggleAvailability?: (ingredientId: string, hasIt: boolean) => void
  /** Ingredient IDs currently being toggled (for pending indicator) */
  togglingIds?: Set<string>
  /** Optimistic availability overrides from in-flight toggles */
  optimisticOverrides?: Map<string, boolean>
  /** If true, hides checkboxes and missing ingredient styling */
  hideAvailability?: boolean
  /** If true, hides the availability badge on finished meals */
  hideAvailabilityBadge?: boolean
  /** Preparation tips content */
  tips?: StructuredTips | null
  /** Whether tips are currently loading */
  isLoadingTips?: boolean
  /** Error message from loading tips */
  tipsError?: string | null
  /** Retry handler for failed tips fetch */
  onRetryTips?: () => void
  /** Whether tips section is expanded */
  isTipsExpanded?: boolean
  /** Handler for "How to prepare" button click */
  onHowToPrepare?: () => void
  /** Indices of the generated steps marked done */
  doneSteps?: ReadonlySet<number>
  /** Makes each generated step a done / not-done toggle (HON-933) */
  onToggleStep?: (index: number) => void
  /**
   * Renders "Done cooking" after the steps, Watch out and Tip. The caller
   * passes it only for a planned entry it can edit.
   */
  onDoneCooking?: () => void
}

/**
 * The pantry as the checkboxes show it: the server's rows with in-flight
 * toggles applied, so ticking the first ingredient turns the badge on at once
 * rather than after the refresh lands.
 */
function withOverrides(
  pantryIngredients: PantryIngredient[],
  overrides: Map<string, boolean> | undefined,
): PantryIngredient[] {
  if (!overrides?.size) return pantryIngredients
  // Staple rows have no checkbox, so no toggle can remove one.
  const rows = pantryIngredients.filter(
    (p) => p.isStaple || overrides.get(p.ingredientId) !== false,
  )
  for (const [ingredientId, hasIt] of overrides) {
    if (hasIt && !rows.some((p) => p.ingredientId === ingredientId)) {
      rows.push({ ingredientId, isStaple: false })
    }
  }
  return rows
}

/**
 * The cook view's content (docs/DESIGN.md → "Cook view", HON-932). Below `lg`
 * one scrolling column: hero, title, meta, note, ingredients, nutrition, then
 * the steps, so "Done cooking" ends the view. From `lg` two columns that
 * scroll on their own, so scrolling the steps never moves the ingredients:
 * the hero down to nutrition on the left (2/5), the steps on the right (3/5).
 *
 * One tree for both, in one order: the left column is `display: contents`
 * below `lg`, so its children join the single column with no box of their
 * own. The DOM order is the visual order in both layouts, so a screen reader
 * hears what the page shows (WCAG 1.3.2, HON-965).
 */
export function MealDetail({
  meal,
  image,
  title,
  note,
  householdSize,
  status,
  servings,
  onServingsChange,
  pantryIngredients = [],
  onToggleAvailability,
  togglingIds,
  optimisticOverrides,
  hideAvailability = false,
  hideAvailabilityBadge = false,
  tips = null,
  isLoadingTips = false,
  tipsError = null,
  onRetryTips,
  isTipsExpanded = false,
  onHowToPrepare,
  doneSteps,
  onToggleStep,
  onDoneCooking,
}: MealDetailProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const tTips = useTranslations('meal-plan.tips')
  // Effective servings: use explicit prop if provided, otherwise householdSize
  const effectiveServings = servings ?? householdSize

  const effectivePantry = useMemo(
    () => withOverrides(pantryIngredients, optimisticOverrides),
    [pantryIngredients, optimisticOverrides],
  )
  // A pantry holding only staples says nothing yet: keep the checkboxes, which
  // are how the user starts filling it, but claim nothing is missing (HON-824).
  const pantryHasData = hasPantryData(effectivePantry)
  const availability = useMemo(
    () => (pantryHasData ? computeMealAvailability(meal, effectivePantry) : null),
    [meal, effectivePantry, pantryHasData],
  )

  const showPreparationSection = !!onHowToPrepare
  const showTips = showPreparationSection && isTipsExpanded
  // A completed entry's servings are what the pantry was charged for, and the
  // API refuses to change them (409, HON-652) — so show the count as the
  // static header instead of offering an edit that can only fail.
  const showServingControl = !!onServingsChange && status !== 'completed'
  const hasImage = image != null && image !== false

  // WHY `tabIndex={0}` on the three scroll regions: a region that scrolls
  // must be reachable by keyboard, or its arrow keys and Page Down do nothing
  // (axe `scrollable-region-focusable`). Once the steps load, the steps column
  // need not hold a control (a completed entry whose tips have no steps to
  // toggle), and focus opens on the panel, which does not scroll. Below `lg` only the outer region scrolls; from `lg` only the two
  // columns do, and the left one is `display: contents` (no box, so not
  // focusable) below `lg`.
  return (
    <div
      data-slot="cook-view-scroll"
      tabIndex={0}
      className="flex h-full flex-col gap-8 overflow-y-auto lg:grid lg:grid-cols-5 lg:grid-rows-1 lg:gap-0 lg:overflow-hidden"
    >
      <div
        data-testid="cook-view-left"
        tabIndex={0}
        className="contents lg:col-span-2 lg:flex lg:flex-col lg:gap-8 lg:overflow-y-auto lg:pb-8"
      >
        {image}

        <div
          className={cn(
            'flex flex-col gap-6 px-5 md:px-8 lg:px-6',
            // Without a hero the title is the first thing in the view, and
            // the close button sits in the top-right corner over it.
            !hasImage && 'pt-16 lg:pt-8',
          )}
        >
          <div className="flex flex-col gap-2">
            {title}
            {/* Seeded MealTranslation renders in the household locale */}
            {meal.description && <Body variant="muted">{meal.description}</Body>}
          </div>

          {/* `> 0`, not truthiness: `0 && …` renders a stray "0" (HON-711).
              The time is the cards' `surface` clock badge, at the cook view's
              `lg` size, with the cards' gap between badges (HON-951). The
              household's own recipe keeps the mark its card shows (HON-953). */}
          {((meal.timeMinutes != null && meal.timeMinutes > 0) ||
            meal.kidFriendly ||
            meal.isCustom) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {meal.timeMinutes != null && meal.timeMinutes > 0 && (
                <Badge variant="surface" size="lg">
                  <Clock aria-hidden="true" />
                  {tDetail('timeMinutes', { count: meal.timeMinutes })}
                </Badge>
              )}
              {meal.kidFriendly && <KidFriendlyBadge size="lg" />}
              {meal.isCustom && <MyRecipeBadge size="lg" />}
            </div>
          )}

          {note}

          <section className="flex flex-col gap-4">
            <IngredientList
              components={meal.components}
              servings={effectiveServings}
              householdSize={householdSize}
              pantryIngredients={pantryIngredients}
              onToggleAvailability={hideAvailability ? undefined : onToggleAvailability}
              togglingIds={togglingIds}
              optimisticOverrides={optimisticOverrides}
              availability={hideAvailabilityBadge ? null : availability}
              hideAvailability={hideAvailability}
              showMissingStyle={pantryHasData}
              headerElement={
                showServingControl ? (
                  // The control sits beside the title rather than inside
                  // parentheses, where its padding read as stray spaces (HON-763).
                  <div className="flex flex-wrap items-center gap-x-1">
                    <Heading variant="h4" as="h3" className="whitespace-nowrap">
                      {tDetail('ingredientsTitle')}
                    </Heading>
                    <ServingControl
                      servings={effectiveServings}
                      householdSize={householdSize}
                      onServingsChange={onServingsChange}
                      disabled={hideAvailability}
                    />
                  </div>
                ) : undefined
              }
            />
            {showTips && <PreparationEquipment equipment={tips?.equipment} />}
          </section>
        </div>

        {/* Nutrition at the end of the ingredients, with the disclaimer
            directly below the macros and visible, never behind an icon
            (HON-466). Before the steps below `lg`, so the view ends on
            "Done cooking" (HON-965). */}
        {meal.nutrition && (
          <div
            data-testid="cook-view-nutrition"
            className="flex flex-col gap-1 px-5 md:px-8 lg:px-6"
          >
            <NutritionSummary nutrition={meal.nutrition} components={meal.components} compact />
            <NutritionDisclaimer />
          </div>
        )}
      </div>

      {/* `lg:pt-8`, the title's own top without a hero, so "Steps" lines up
          with the meal name (HON-951). The close button is in the far corner,
          clear of a short heading at the column's left. */}
      {showPreparationSection && (
        <section
          data-testid="cook-view-steps"
          tabIndex={0}
          className="flex flex-col gap-6 px-5 pb-8 md:px-8 lg:col-span-3 lg:overflow-y-auto lg:px-10 lg:pt-8"
        >
          <Heading variant="h4" as="h3">
            {tTips('steps')}
          </Heading>
          <PreparationSteps
            tips={showTips ? tips : null}
            isLoading={showTips && isLoadingTips}
            error={showTips ? tipsError : null}
            onRetry={onRetryTips ?? (() => {})}
            preparationNotes={meal.preparationNotes}
            doneSteps={doneSteps}
            onToggleStep={onToggleStep}
          />
          {/* A planned entry generates its steps on open (HON-933); anything
              else asks for them: full width on a phone, label-sized from `md`. */}
          {!isTipsExpanded && (
            <Button size="lg" className="w-full md:w-auto md:self-start" onClick={onHowToPrepare}>
              {tDetail('howToPrepare')}
            </Button>
          )}
          {/* Where cooking ends, the view ends: marks the entry completed,
              which runs the pantry deduction and the rating prompt. It does
              not wait for every step to be ticked. */}
          {onDoneCooking && (
            <Button size="lg" className="w-full md:w-auto md:self-start" onClick={onDoneCooking}>
              {tDetail('doneCooking')}
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
