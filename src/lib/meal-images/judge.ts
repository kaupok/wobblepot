import { z } from 'zod'
import { ingredientsByWeight, type MealImageMeal } from './prompt'

/**
 * Vision judge for generated meal illustrations (HON-733 "judge V2", chosen by
 * HON-726). Pure: the model call lives in `generate.ts`, so the spike can share
 * the prompt and the filters without pulling in server-only code.
 *
 * Only serious findings — an added ingredient, or props and cookware beside the
 * dish — fail an image. Missing ingredients and portion are too noisy to gate on.
 */

// HON-732's judge flagged garlic and thyme as missing although its prompt said
// to ignore them. Marking them in code means it is never asked about them.
const INVISIBLE_WHEN_COOKED =
  /garlic|ginger|stock|broth|\boil\b|butter|\bsalt\b|seasoning|powder|masala|cumin|paprika|cinnamon|turmeric|saffron|nutmeg|chili flakes|thyme|rosemary|oregano|\bsage\b|bay lea|miso|cream\b|yogurt|mayonnaise|vinegar|soy sauce|fish sauce|honey|syrup|sugar|flour|breadcrumbs|mustard|wine|tomato paste|lemon|lime/i

/** `pepper` alone is the spice; `bell pepper` is a vegetable. */
const isInvisible = (name: string): boolean =>
  /^(black |white )?pepper$/i.test(name) || INVISIBLE_WHEN_COOKED.test(name)

/** The ingredients a viewer should be able to point at in the finished dish. */
export function visibleIngredients(meal: Pick<MealImageMeal, 'components'>): string[] {
  return ingredientsByWeight(meal).filter((name) => !isInvisible(name))
}

export const judgeV2Schema = z.object({
  extraIngredients: z
    .array(z.string())
    .describe('Foods visible in or on the dish that are not in the full ingredient list'),
  propsOrCookware: z
    .array(z.string())
    .describe(
      'Anything beside the dish: raw ingredients, side dishes, cutlery, boards, pots, pans, baking dishes',
    ),
  missingIngredients: z
    .array(z.string())
    .describe('Names from the expected-visible list that cannot be found in the image'),
  portion: z
    .enum(['one-serving', 'several-servings', 'whole-dish'])
    .describe('How much food the image shows'),
  notes: z.string().describe('One sentence on anything else worth knowing').optional(),
})

export type JudgeV2Findings = z.infer<typeof judgeV2Schema>

const words = (s: string): string[] =>
  (s.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => w.replace(/(es|s)$/, ''))

// A head noun shared by unrelated foods: "feta cheese" must not excuse "parmesan cheese".
const GENERIC_HEADS = new Set([
  'cheese',
  'oil',
  'sauce',
  'cream',
  'bean',
  'bread',
  'rice',
  'pepper',
  'stock',
  'seed',
  'leav',
  'powder',
  'paste',
  'juice',
  'milk',
  'flour',
  'butter',
  'onion',
  'sheet',
  'meat',
])

const DERIVED_HEADS = new Set([
  'oil',
  'sauce',
  'paste',
  'juice',
  'powder',
  'stock',
  'milk',
  'flour',
  'butter',
])

/** True when `text` names `ingredient`: every word of it, or its distinctive head noun ("greek yogurt" → yogurt). */
function names(text: string, ingredient: string): boolean {
  const have = new Set(words(text))
  const name = words(ingredient)
  if (name.length === 0) return false
  if (name.every((w) => have.has(w))) return true
  const head = name[name.length - 1]!
  if (!GENERIC_HEADS.has(head)) return have.has(head)
  // "feta cheese" is named by "crumbled feta". A derived product is not named
  // by its source: "olive oil" must not be matched by "black olives".
  const modifiers = name.slice(0, -1)
  return !DERIVED_HEADS.has(head) && modifiers.length > 0 && modifiers.every((w) => have.has(w))
}

/**
 * Drops an "extra" that names a listed ingredient. The first HON-733 run failed
 * 13 of 24 images on listed sour cream, sage, lemon and paprika — a gate that
 * regenerates on extras cannot leave that to the prompt alone. Matching is by
 * whole name or head noun, never by any shared word: "olive oil" must not
 * excuse "black olives", nor "green lentils" "green olives".
 */
export function dropListedExtras(
  extras: string[],
  meal: Pick<MealImageMeal, 'components'>,
): string[] {
  return extras.filter((extra) => !meal.components.some((c) => names(extra, c.name)))
}

const SERVINGWARE =
  /^(the |a |one |single |serving |dinner |plain |white |metal |wooden |bamboo )*(plate|bowl|skewers?)$/i
const GARNISH_FORM = new Set([
  'wedge',
  'slice',
  'half',
  'halv',
  'piece',
  'sprig',
  'the',
  'and',
  'plate',
])

/**
 * Drops only what the judge misreports as a prop: the serving plate itself,
 * kofta skewers, and a listed ingredient served on the plate ("lime wedge").
 * Anything longer — "raw carrot on a cutting board", "casserole dish",
 * "bowl of parmesan beside the plate" — stays a serious finding.
 */
export function dropServingware(
  props: string[],
  meal?: Pick<MealImageMeal, 'components'>,
): string[] {
  return props.filter((p) => {
    if (SERVINGWARE.test(p.trim())) return false
    if (!meal) return true
    const listed = new Set(meal.components.flatMap((c) => words(c.name)))
    const rest = words(p).filter((w) => !listed.has(w) && !GARNISH_FORM.has(w))
    return !(rest.length === 0 && meal.components.some((c) => names(p, c.name)))
  })
}

/** Serious findings mislead (an allergen that is not there); the rest only look off. */
export function computePassV2(f: JudgeV2Findings): { pass: boolean; strictPass: boolean } {
  const pass = f.extraIngredients.length === 0 && f.propsOrCookware.length === 0
  return {
    pass,
    strictPass: pass && f.missingIngredients.length === 0 && f.portion === 'one-serving',
  }
}

export interface JudgeVerdict {
  /** What the model said, before the code-level filters. Logged so a filter that hid a real extra can be found later. */
  raw: JudgeV2Findings
  /** After `dropListedExtras` and `dropServingware` — what the gate reads. */
  filtered: JudgeV2Findings
  /** No serious finding: nothing added, nothing beside the dish. The regenerate gate. */
  pass: boolean
  /** `pass`, and nothing missing, and one serving. Informational only. */
  strictPass: boolean
}

/** Apply the code-level filters to a raw judge response and compute the verdict. */
export function applyJudgeFilters(
  raw: JudgeV2Findings,
  meal: Pick<MealImageMeal, 'components'>,
): JudgeVerdict {
  const filtered = {
    ...raw,
    extraIngredients: dropListedExtras(raw.extraIngredients, meal),
    // A listed lime wedge on the plate came back as a prop.
    propsOrCookware: dropServingware(raw.propsOrCookware, meal),
  }
  return { raw, filtered, ...computePassV2(filtered) }
}

const formatQuantity = (n: number): string => String(Math.round(n * 10) / 10)

/** No prep steps: production tips are per plan entry, so the judge never sees them. */
export function buildJudgeV2Prompt(meal: MealImageMeal): string {
  const notes = meal.preparationNotes?.trim()
  const description = meal.description?.trim()
  return `You are checking a generated illustration of a meal against the meal's own recipe data. Judge only what is visibly in the image, not the art style.

Meal: ${meal.name}${description ? ` — ${description}` : ''}

Ingredients per serving — the complete list. Those marked "(may not be visible)" usually disappear into the dish, but are still part of it:
${meal.components
  .map(
    (c) =>
      `- ${c.name}: ${formatQuantity(c.quantity)}${c.unit}${isInvisible(c.name) ? ' (may not be visible)' : ''}`,
  )
  .join('\n')}
${notes ? `\nThe cook's own preparation notes:\n${notes}\n` : ''}
Report:
- extraIngredients: foods visible in or on the dish that appear nowhere in the list above — garnishes, fresh herbs, olives, cheese, sauces. Name each once. Every listed ingredient is allowed to be visible, marked or not: a listed herb, spice, lemon wedge or spoonful of yogurt is not an extra. Nor is a sauce, glaze, browned surface or cooking juice made from listed ingredients. Report food only — a skewer or a plate is not an ingredient.
- propsOrCookware: anything beside the dish — raw ingredients, side dishes, cutlery, napkins, cutting boards, pots, pans or baking dishes. The one plate or bowl the food is served on is not a prop, and neither is a listed ingredient served on that plate.
- missingIngredients: only unmarked ingredients that you cannot find anywhere in the image. An ingredient that is present but cut or cooked differently than you would expect is not missing.
- portion: "one-serving" for a normal plate or bowl for one person, "several-servings" for a heaped platter or a sharing bowl, "whole-dish" for an entire pie, tray or pot.

Leave a list empty when there is nothing to report. Do not report lighting, colour, composition or how ingredients are cut.`
}
