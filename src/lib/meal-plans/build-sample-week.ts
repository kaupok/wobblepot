import type { IngredientCategory, MealImageStatus } from '@/generated/prisma/enums'
import { formatDayLong } from '@/lib/i18n/format-dates'
import { displayUnit, formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import type { VaguePhraseLabel } from '@/lib/i18n/vague-phrase'
import {
  aggregateComponents,
  groupByCategory,
  type AggregationComponent,
} from '@/lib/meal-planning/shopping-list'
import { sampleWeekServings, type SampleWeek } from './sample-weeks'

/** The pages are English-only (HON-1073): every quantity and day name is formatted in `en`. */
const LOCALE = 'en'

/** One library meal as `loadSampleWeek` hands it over, already in English. */
export interface SampleMealInput {
  id: string
  name: string
  description: string | null
  kidFriendly: boolean
  timeMinutes: number | null
  primaryProteinType: string
  imageUrl: string | null
  imageStatus: MealImageStatus
  imageHue: number | null
  components: AggregationComponent[]
  /** The fresh English steps from `MealPreparationSteps`, or null when there is no fresh row. */
  steps: string[] | null
}

/** An ingredient with its quantity for the stated household, formatted for display. */
export interface SampleIngredientLine {
  id: string
  name: string
  quantity: string
  /** The quantity is a phrase ("to taste"), not an amount. */
  isVague: boolean
}

export interface SampleDay {
  /** "Monday": the anchor of the day's card and its JSON-LD `url`. */
  dayName: string
  anchor: string
  meal: Omit<SampleMealInput, 'components' | 'steps'>
  ingredients: SampleIngredientLine[]
}

export interface SampleShoppingGroup {
  category: IngredientCategory
  items: SampleIngredientLine[]
}

export interface SampleWeekView {
  servings: number
  days: SampleDay[]
  shoppingList: SampleShoppingGroup[]
  jsonLd: Record<string, unknown>
}

interface BuildOptions {
  /** The page's canonical URL; each recipe's `url` is it plus the day's anchor. */
  pageUrl: string
  /** The page title, as the list's `name`. */
  title: string
  /** `recipeYield` for the week's servings, from the catalog: 3 → "3 servings". */
  recipeYield: (servings: number) => string
  /** `enums.VaguePhrase`, for a "to taste" component. */
  tVague: VaguePhraseLabel
  /** `enums.Unit.piece`: "pc". */
  pieceLabel: string
}

/**
 * The day a meal is cooked on, Monday to Sunday of a fixed week. Only the
 * weekday is ever shown; the dates order the shopping list's rows by the
 * first day each ingredient is needed, as the real list does.
 */
function dayDate(index: number): Date {
  // 2024-01-01 is a Monday.
  return new Date(Date.UTC(2024, 0, 1 + index))
}

/** ISO 8601 duration for `totalTime`: 45 → `PT45M`, 90 → `PT1H30M`. */
export function isoDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return `PT${hours > 0 ? `${hours}H` : ''}${rest > 0 || hours === 0 ? `${rest}M` : ''}`
}

/**
 * Turn a sample week's loaded meals into what its page renders: each day's
 * dinner with its ingredients scaled to the stated household, one shopping
 * list for the week grouped in `categoryConfig` order with no pantry
 * deduction, and the `ItemList` of `Recipe` structured data. The visible
 * quantities and `recipeIngredient` come from the same formatted strings, so
 * the two cannot disagree. Pure: `loadSampleWeek` does the reading.
 */
export function buildSampleWeek(
  week: SampleWeek,
  meals: readonly SampleMealInput[],
  options: BuildOptions,
): SampleWeekView {
  const servings = sampleWeekServings(week)
  const format = (
    quantity: number,
    ingredient: AggregationComponent['ingredient'],
    isVague: boolean,
    originalPhrase: string | null,
  ) =>
    formatShoppingQuantity(
      quantity,
      displayUnit(ingredient),
      LOCALE,
      isVague,
      originalPhrase,
      options.tVague,
      options.pieceLabel,
    )

  const days: SampleDay[] = meals.map((input, index) => {
    const dayName = formatDayLong(dayDate(index), LOCALE, { timeZone: 'UTC' })
    return {
      dayName,
      anchor: dayName.toLowerCase(),
      meal: {
        id: input.id,
        name: input.name,
        description: input.description,
        kidFriendly: input.kidFriendly,
        timeMinutes: input.timeMinutes,
        primaryProteinType: input.primaryProteinType,
        imageUrl: input.imageUrl,
        imageStatus: input.imageStatus,
        imageHue: input.imageHue,
      },
      ingredients: input.components.map((component) => ({
        id: component.ingredientId,
        name: component.ingredient.name,
        quantity: format(
          component.quantityPerServing * servings,
          component.ingredient,
          component.isVague,
          component.originalPhrase,
        ),
        isVague: component.isVague && component.originalPhrase !== null,
      })),
    }
  })

  const needed = aggregateComponents(
    meals.map((meal, index) => ({
      date: dayDate(index),
      servings,
      components: meal.components,
    })),
    LOCALE,
  )
  const shoppingList = groupByCategory(
    [...needed].map(([ingredientId, item]) => ({
      ingredientId,
      ingredient: item.ingredient,
      neededQuantity: item.quantity,
      pantryQuantity: null,
      shoppingQuantity: item.quantity,
      mealCount: item.mealCount,
      earliestNeededDate: item.earliestNeededDate,
      isVague: item.isVague,
      originalPhrase: item.originalPhrase,
    })),
  ).map((group) => ({
    category: group.category,
    items: group.items.map((item) => ({
      id: item.ingredientId,
      name: item.ingredient.name,
      quantity: format(item.neededQuantity, item.ingredient, item.isVague, item.originalPhrase),
      isVague: item.isVague && item.originalPhrase !== null,
    })),
  }))

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: options.title,
    itemListElement: days.map((day, index) => {
      const input = meals[index]!
      return {
        '@type': 'ListItem',
        position: index + 1,
        url: `${options.pageUrl}#${day.anchor}`,
        item: {
          '@type': 'Recipe',
          name: day.meal.name,
          ...(day.meal.description && { description: day.meal.description }),
          ...(day.meal.imageStatus === 'ready' &&
            day.meal.imageUrl && { image: [day.meal.imageUrl] }),
          ...(day.meal.timeMinutes && { totalTime: isoDuration(day.meal.timeMinutes) }),
          recipeYield: options.recipeYield(servings),
          recipeCategory: 'Dinner',
          // "300g pasta", but "salt, to taste".
          recipeIngredient: day.ingredients.map((line) =>
            line.isVague ? `${line.name}, ${line.quantity}` : `${line.quantity} ${line.name}`,
          ),
          ...(input.steps &&
            input.steps.length > 0 && {
              recipeInstructions: input.steps.map((text) => ({ '@type': 'HowToStep', text })),
            }),
          ...(week.diet === 'vegetarian' && {
            suitableForDiet: 'https://schema.org/VegetarianDiet',
          }),
        },
      }
    }),
  }

  return { servings, days, shoppingList, jsonLd }
}

/**
 * `JSON.stringify` for an inline `<script type="application/ld+json">`. Every
 * `<` becomes `<`, so no string in the data (a meal name, a step) can
 * close the script element or open a comment. JSON parsers read the escape
 * back as `<`.
 */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c')
}
