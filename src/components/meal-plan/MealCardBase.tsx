'use client'

import type { ReactNode } from 'react'
import { Clock, ExternalLink } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Body, Heading, type HeadingTag } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { getIngredientAvailabilitySets } from './AvailabilityIndicator'
import { KidFriendlyBadge } from './KidFriendlyBadge'
import { mealImageTitleWidth, type MealImageFields } from './MealImageCard'
import { NutritionSummary } from './NutritionSummary'
import type { MealComponent, NutritionData, PantryIngredient } from './types'
import type { MealType } from '@/generated/prisma/enums'

/**
 * The image fields are read by the `MealImageCard` a caller wraps this in, not
 * rendered here: the tint and the image belong to the card, which this
 * component deliberately does not own.
 */
export interface MealCardBaseData extends MealImageFields {
  name: string
  description?: string | null
  sourceUrl?: string | null
  timeMinutes?: number | null
  kidFriendly: boolean
  primaryProteinType: string
  suitableFor?: MealType[]
  components: MealComponent[]
  nutrition: NutritionData
}

interface MealCardBaseProps {
  meal: MealCardBaseData
  /** When provided, ingredients are color-coded by pantry availability */
  pantryIngredients?: PantryIngredient[]
  /**
   * HTML tag for the meal name. The visual level is always the `h4` title size;
   * this only moves the tag in the document outline. Pass `h3` when the card is
   * rendered directly under a Dialog title (an `h2`) so axe's heading-order rule
   * stays valid.
   */
  nameHeadingTag?: HeadingTag
  /**
   * The card's actions, aligned right on the name's row (docs/DESIGN.md →
   * Composition, "Actions sit on the title row"). For a `layout="bottom"`
   * card, whose title row nothing else shares.
   */
  titleActions?: ReactNode
}

function MealTypeList({ types }: { types: MealType[] }) {
  const t = useTranslations('enums.MealType')
  return <>{types.map((value) => t(value)).join(', ')}</>
}

function ProteinTypeBody({ type }: { type: string }) {
  const t = useTranslations('enums.ProteinType')
  return <>{t(type)}</>
}

/**
 * Shared meal card content used by both My Recipes and Add meal modal.
 * Renders: name, description, nutrition, prep time + badges, meal types + protein type, ingredient list.
 * Does NOT include Card wrapper or action buttons — consumers provide their own layout.
 */
export function MealCardBase({
  meal,
  pantryIngredients,
  nameHeadingTag = 'h4',
  titleActions,
}: MealCardBaseProps) {
  const tDetail = useTranslations('meal-plan.detail')
  // Staples alone are not pantry data: every household starts with salt, black
  // pepper and water as staples (HON-769), so counting them would paint every
  // other ingredient amber for a household that has never used the pantry.
  const hasPantryData = pantryIngredients?.some((p) => !p.isStaple) ?? false
  const { availableIds, stapleIds } =
    hasPantryData && pantryIngredients
      ? getIngredientAvailabilitySets(pantryIngredients)
      : { availableIds: null, stapleIds: null }

  return (
    <div className="flex flex-col gap-1.5">
      {/* 1. Meal name — wraps before the image on a tinted `MealImageCard`, full
          width anywhere else (HON-749) */}
      <div className="flex items-start justify-between gap-2">
        <div className={mealImageTitleWidth()}>
          <Heading variant="h4" as={nameHeadingTag}>
            {meal.name}
          </Heading>
        </div>
        {titleActions ? (
          <div className="flex shrink-0 items-center gap-1">{titleActions}</div>
        ) : null}
      </div>

      {/* 2. Description */}
      {meal.description && <Body variant="muted">{meal.description}</Body>}

      {/* 2b. Source URL */}
      {meal.sourceUrl && /^https?:\/\//i.test(meal.sourceUrl) && (
        <a
          href={meal.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:text-primary/80 inline-flex items-center gap-1 text-sm underline"
        >
          {tDetail('viewSource')}
          <ExternalLink className="size-3.5" />
        </a>
      )}

      {/* 3. Nutrition summary */}
      <NutritionSummary nutrition={meal.nutrition} components={meal.components} compact />

      {/* 4. Prep time + badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {meal.timeMinutes && (
          <div className="text-muted-foreground flex items-center gap-1">
            <Clock className="size-3.5" />
            <Body variant="small">{tDetail('timeMinutes', { count: meal.timeMinutes })}</Body>
          </div>
        )}
        {meal.kidFriendly && <KidFriendlyBadge />}
      </div>

      {/* 5. Meal types + protein type */}
      <div className="flex flex-wrap items-center gap-1.5">
        {meal.suitableFor && meal.suitableFor.length > 0 && (
          <Body variant="caption">
            <MealTypeList types={meal.suitableFor} />
          </Body>
        )}
        {meal.suitableFor && meal.suitableFor.length > 0 && <Body variant="caption">&middot;</Body>}
        <Body variant="caption">
          <ProteinTypeBody type={meal.primaryProteinType} />
        </Body>
      </div>

      {/* 6. Ingredient list (names only, color-coded when pantry data available) */}
      <ul className={cn('ml-4 list-disc text-sm', !hasPantryData && 'text-muted-foreground')}>
        {meal.components.map((comp) => {
          const isAvailable =
            availableIds !== null &&
            (stapleIds!.has(comp.ingredientId) || availableIds.has(comp.ingredientId))
          const isMissing = availableIds !== null && !isAvailable

          return (
            <li
              key={comp.ingredientId}
              className={cn(isAvailable && 'text-success', isMissing && 'text-warning')}
            >
              {comp.ingredient.name}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
