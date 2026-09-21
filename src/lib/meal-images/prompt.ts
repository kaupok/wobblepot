import { DEFAULT_GRAMS_PER_PIECE } from '@/lib/ai/recipe-quantities'

/**
 * Meal illustration prompt, V3 (HON-726 decision, proven by the HON-733 spike).
 *
 * Deliberately free of `server-only`: `scripts/spike-meal-images.ts` runs under
 * `tsx` and imports these builders, and the module holds no secrets.
 */

/** Stored on `Meal.imagePromptVersion`, so a later prompt change can find old images. */
export const MEAL_IMAGE_PROMPT_VERSION = 'v3'

/** HON-733: V2 heaped several servings onto one platter twice in twelve images. */
export const STYLE_PREFIX_ILLUSTRATION_V3 =
  'Warm stylised illustration of a single modest serving for one person of a home-cooked dish, on a single plain dinner plate or in a single bowl with space around the food, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle on a plain, uncluttered surface.'

/**
 * V2's exclusion sentence, kept by V3. Names the HON-717 failures explicitly:
 * added garnish and olives, raw-ingredient props, and whole pots or baking dishes.
 */
export const V2_EXCLUSIONS =
  'Show only the finished, cooked dish as it is served. Nothing that is not in that list: no garnish, no herbs beyond those listed, no olives, bread or side dishes. No raw ingredients, cutting boards, pots, pans, baking dishes or other props around it.'

export const PROMPT_SUFFIX =
  'A single dish, landscape 3:2 composition with the food filling the frame. No text, no labels, no logos, no hands, no people.'

export interface MealImageComponent {
  name: string
  /** Per serving, as `MealComponent.quantityPerServing`. */
  quantity: number
  /** The ingredient's `defaultUnit` — 'g' or 'piece' in the database; the spike also uses 'ml'. */
  unit: string
  gramsPerPiece?: number | null
  densityGPerMl?: number | null
}

export interface MealImageMeal {
  name: string
  description: string | null
  components: MealImageComponent[]
  preparationNotes?: string | null
}

/** A component's weight, so a piece of pita no longer sorts below 3 g of cumin. */
export function gramsOf(component: MealImageComponent): number {
  switch (component.unit) {
    case 'piece':
      return component.quantity * (component.gramsPerPiece ?? DEFAULT_GRAMS_PER_PIECE)
    case 'ml':
      return component.quantity * (component.densityGPerMl ?? 1)
    default:
      return component.quantity
  }
}

/** Ingredient names, heaviest first. Ties keep the meal's own order. */
export function ingredientsByWeight(meal: Pick<MealImageMeal, 'components'>): string[] {
  return [...meal.components].sort((a, b) => gramsOf(b) - gramsOf(a)).map((c) => c.name)
}

function dishLine(meal: MealImageMeal): string {
  // Imagined meals often end their description with a full stop; the template adds its own.
  const description = meal.description?.trim().replace(/\.+$/, '')
  return description ? `The dish: ${meal.name} — ${description}.` : `The dish: ${meal.name}.`
}

/** Everything after the style prefix. The spike puts its V2 prefix in front of the same body. */
export function buildMealImagePromptBody(meal: MealImageMeal): string {
  const notes = meal.preparationNotes?.trim()
  return [
    dishLine(meal),
    // Phrased as what the dish is made from, not a list to display — the V1
    // "Key ingredients:" line drew the raw ingredients around the plate.
    `It is made from exactly these ingredients, largest amount first: ${ingredientsByWeight(meal).join(', ')}.`,
    ...(notes
      ? [`How it is prepared: ${notes} Show the ingredients cut and cooked exactly as described.`]
      : []),
    V2_EXCLUSIONS,
    PROMPT_SUFFIX,
  ].join(' ')
}

/** The production prompt: V3 prefix and body. */
export function buildMealImagePrompt(meal: MealImageMeal): string {
  return `${STYLE_PREFIX_ILLUSTRATION_V3} ${buildMealImagePromptBody(meal)}`
}
