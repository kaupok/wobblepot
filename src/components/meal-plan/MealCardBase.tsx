'use client'

import type { ReactNode } from 'react'
import { Check, Clock, ExternalLink, Minus } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { Body, Heading, type HeadingTag } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import { getIngredientAvailabilitySets, hasPantryData } from './AvailabilityIndicator'
import { KidFriendlyBadge } from './KidFriendlyBadge'
import { mealImageTitleWidth, type MealImageFields } from './MealImageCard'
import { MealTypeBadge } from './MealTypeBadge'
import { MyRecipeBadge } from './MyRecipeBadge'
import { ProteinBadge } from './ProteinBadge'
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
  /** One of the household's own recipes; marked with `MyRecipeBadge` (HON-948) */
  isCustom?: boolean
  components: MealComponent[]
  nutrition: NutritionData
}

interface MealCardBaseProps {
  meal: MealCardBaseData
  /**
   * When provided, each ingredient is marked by pantry availability: an icon,
   * visually hidden state text and the colour (docs/DESIGN.md → Color).
   */
  pantryIngredients?: PantryIngredient[]
  /**
   * HTML tag for the meal name. The visual level is always Section: a card sits
   * under a page or dialog title and never repeats the Title size (HON-784,
   * docs/DESIGN.md → Type scale). This only moves the tag in the document
   * outline. `variant="section"` would otherwise render an `h2`, so pick the tag
   * one level below the enclosing title: `h2` under a page `h1`, `h3` under a
   * Dialog title (an `h2`), so axe's heading-order rule stays valid.
   */
  nameHeadingTag?: HeadingTag
  /**
   * Whether the ingredient list renders. `'never'` leaves it out of the DOM,
   * for the recipe library: there the list is uncoloured names only, it made a
   * phone card nearly two screens tall (HON-784) and a desktop card nearly one
   * viewport (HON-819), and the edit page and meal detail carry the full list
   * with quantities. The alternatives grid keeps `'always'`, because there the
   * list is colour-coded against the pantry. The imagine panel and results keep
   * it too, left unchanged by HON-784's scope decision even though they pass no
   * pantry data.
   */
  ingredients?: 'always' | 'never'
  /**
   * Whether the `suitableFor` slot badges render. `'hide'` is for the meal
   * selector, whose title already names the slot being filled, so "Breakfast"
   * on every card repeats it and pushes the kid-friendly and protein badges to
   * a second row on a phone (HON-945). Everywhere else a meal's slots are news.
   */
  mealTypes?: 'show' | 'hide'
  /**
   * Whether an own recipe (`meal.isCustom`) carries the "My recipe" badge.
   * `'hide'` is for the My recipes page, where every card is one, so the badge
   * would say nothing (HON-948). Elsewhere it tells an own recipe apart from
   * the library meals beside it.
   */
  ownRecipe?: 'show' | 'hide'
  /**
   * The card's actions, aligned right on the name's row (docs/DESIGN.md →
   * Composition, "Actions sit on the title row"). For a `layout="bottom"`
   * card, whose title row nothing else shares.
   */
  titleActions?: ReactNode
}

/**
 * Shared meal card content used by both My Recipes and Add meal modal.
 * Renders: slot, kid-friendly, protein and own-recipe badges, name, description, nutrition, prep time, ingredient list.
 * Does NOT include Card wrapper or action buttons — consumers provide their own layout.
 */
export function MealCardBase({
  meal,
  pantryIngredients,
  nameHeadingTag = 'h4',
  ingredients = 'always',
  mealTypes = 'show',
  ownRecipe = 'show',
  titleActions,
}: MealCardBaseProps) {
  const tDetail = useTranslations('meal-plan.detail')
  const tAvailability = useTranslations('meal-plan.availability')
  const availability =
    hasPantryData(pantryIngredients) && pantryIngredients
      ? getIngredientAvailabilitySets(pantryIngredients)
      : null

  return (
    <div className="flex flex-col gap-1.5">
      {/* 0. Slot, kid-friendly, protein and own-recipe badges — the card's first row, as
          on the planner card, so a meal says when it fits and what it is
          before its name. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {mealTypes === 'show' &&
          meal.suitableFor?.map((type) => <MealTypeBadge key={type} mealType={type} />)}
        {meal.kidFriendly && <KidFriendlyBadge compact />}
        <ProteinBadge proteinType={meal.primaryProteinType} />
        {ownRecipe === 'show' && meal.isCustom && <MyRecipeBadge compact />}
      </div>

      {/* 1. Meal name — Section, not Title: the page or dialog title above owns
          that size (HON-784). Wraps before the image on a tinted
          `MealImageCard`, full width anywhere else (HON-749) */}
      <div className="flex items-start justify-between gap-2">
        <div className={mealImageTitleWidth()}>
          <Heading variant="section" as={nameHeadingTag}>
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

      {/* 4. Prep time — a `surface` badge, the page background on the tint:
          the time is a fact about cooking, not the meal's own colour. */}
      {/* `> 0`, not truthiness: `0 && …` renders a stray "0", and a zero-minute meal
          has no prep time worth a badge (HON-711). */}
      {meal.timeMinutes != null && meal.timeMinutes > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="surface">
            <Clock aria-hidden="true" />
            {tDetail('timeMinutes', { count: meal.timeMinutes })}
          </Badge>
        </div>
      )}

      {/* 6. Ingredient list. Names only and muted without pantry data. With
          it, each row's icon, hidden state text and colour say whether the
          pantry has it: colour is never the only cue (HON-816). Staples count
          as available. Left out entirely with `ingredients="never"`. */}
      {ingredients === 'never' ? null : availability ? (
        <ul className="flex flex-col text-sm">
          {meal.components.map((comp) => {
            const isAvailable =
              availability.stapleIds.has(comp.ingredientId) ||
              availability.availableIds.has(comp.ingredientId)
            const Icon = isAvailable ? Check : Minus

            return (
              <li
                key={comp.ingredientId}
                className={cn(
                  'flex items-start gap-1.5',
                  isAvailable ? 'text-success' : 'text-warning',
                )}
              >
                {/* A box one `text-sm` line tall centres the icon on the first
                    line, so a wrapped name keeps it beside that line. */}
                <span className="flex h-5 shrink-0 items-center">
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
                <span>{comp.ingredient.name}</span>
                <span className="sr-only">
                  {', '}
                  {tAvailability(isAvailable ? 'stateAvailable' : 'stateUnavailable')}
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <ul className="text-muted-foreground ml-4 list-disc text-sm">
          {meal.components.map((comp) => (
            <li key={comp.ingredientId}>{comp.ingredient.name}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
