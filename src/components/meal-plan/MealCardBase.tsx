'use client'

import { Clock, ExternalLink, Users } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Body, Heading, type HeadingTag } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { getIngredientAvailabilitySets } from './AvailabilityIndicator'
import { NutritionSummary } from './NutritionSummary'
import type { MealComponent, NutritionData, PantryIngredient } from './types'
import type { MealType } from '@/generated/prisma/enums'

export interface MealCardBaseData {
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
}: MealCardBaseProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const hasPantryData = pantryIngredients && pantryIngredients.length > 0
  const { availableIds, stapleIds } = hasPantryData
    ? getIngredientAvailabilitySets(pantryIngredients)
    : { availableIds: null, stapleIds: null }

  return (
    <div className="flex flex-col gap-1.5">
      {/* 1. Meal name */}
      <Heading variant="h4" as={nameHeadingTag}>
        {meal.name}
      </Heading>

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
          <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {/* 3. Nutrition summary */}
      <NutritionSummary nutrition={meal.nutrition} components={meal.components} compact />

      {/* 4. Prep time + badges */}
      <div className="flex flex-wrap items-center gap-1.5">
        {meal.timeMinutes && (
          <div className="text-muted-foreground flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <Body variant="small">{tDetail('timeMinutes', { count: meal.timeMinutes })}</Body>
          </div>
        )}
        {meal.kidFriendly && (
          <Badge variant="secondary" className="text-xs">
            <Users className="mr-1 h-3 w-3" />
            {tDetail('kidFriendly')}
          </Badge>
        )}
      </div>

      {/* 5. Meal types + protein type */}
      <div className="flex flex-wrap items-center gap-1.5">
        {meal.suitableFor && meal.suitableFor.length > 0 && (
          <Body variant="small" className="text-muted-foreground">
            <MealTypeList types={meal.suitableFor} />
          </Body>
        )}
        {meal.suitableFor && meal.suitableFor.length > 0 && (
          <Body variant="small" className="text-muted-foreground">
            &middot;
          </Body>
        )}
        <Body variant="small" className="text-muted-foreground">
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
              className={cn(
                isAvailable && 'text-green-700 dark:text-green-400',
                isMissing && 'text-amber-700 dark:text-amber-400',
              )}
            >
              {comp.ingredient.name}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
