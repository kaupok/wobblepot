/**
 * Meal Image Spike (HON-717, HON-732)
 *
 * HON-717 compared 3 models × 3 styles on 4 meals. HON-732 reuses the harness
 * to make the chosen style *accurate*: a V2 illustration prompt that claims
 * less, `preparationNotes` in the prompt, and a Claude vision judge that checks
 * every image against the meal's ingredients and a sample of generated prep
 * steps. Default run: flare + sunburst × illustration V1/V2 × 6 trap meals = 24
 * images, 24 judge calls and 6 prep calls. No production surface: no schema,
 * no storage, no env schema, no AiUsage ledger.
 *
 * COSTS REAL MONEY (~$1.80 for the default run). Without `--confirm` it is a
 * dry run: it prints the job matrix and the estimated total, then exits.
 *
 * Needs OPENAI_API_KEY (and GOOGLE_GENERATIVE_AI_API_KEY for Gemini) in
 * `.env` (HON-731), plus ANTHROPIC_API_KEY for the prep sample and the judge.
 * They are read straight from process.env on purpose — `src/lib/env.ts` throws
 * on missing required keys, which would break every other surface.
 *
 * Output: .temp/spike-meal-images/<timestamp>/index.html (gitignored)
 *
 * HON-733 adds V3 (V2 plus a one-person portion), a production-shaped judge
 * (no prep sample — production tips belong to a plan entry, the image to a
 * meal) and a sample of real seed meals, because six trap meals say little
 * about tacos, gyoza or a bagel:
 *   pnpm spike:meal-images --models=flare --versions=v3 --meals=seed
 *
 * Usage: pnpm spike:meal-images [--confirm] [--no-judge]
 *          [--models=flare,sunburst,nano-banana-2] [--styles=photo,illustration,flat]
 *          [--versions=v1,v2,v3] [--meals=traps,seed] [--repeats=N]
 *          [--rejudge=<run dir>]   judge a previous run's V3 images again, no image spend
 */

import 'dotenv/config'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createAnthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { generateImage, generateObject, type ImageModel, type ImageModelUsage } from 'ai'
import { z } from 'zod'
import { REVIEW_MODEL, TIPS_MODEL } from '../src/lib/ai/models'
import {
  buildFullTipsPrompt,
  buildSupplementaryTipsPrompt,
  fullTipsSchema,
  supplementaryTipsSchema,
} from '../src/lib/ai/preparation-tips'
import { estimateCostUsd } from '../src/lib/ai/pricing'

// ============================================
// MEALS
// ============================================

export interface SpikeComponent {
  name: string
  /** Per serving, as `MealComponent.quantityPerServing`. */
  quantity: number
  /** The ingredient's `defaultUnit` — 'g', 'ml', 'piece', … */
  unit: string
}

export interface SpikeMeal {
  slug: string
  name: string
  description: string
  /** In seed order — V1 lists them in this order, so its prompt stays unchanged. */
  components: SpikeComponent[]
  preparationNotes?: string
}

const g = (name: string, quantity: number): SpikeComponent => ({ name, quantity, unit: 'g' })
const ml = (name: string, quantity: number): SpikeComponent => ({ name, quantity, unit: 'ml' })

// Trap meals (HON-732): each one is a dish whose usual form contradicts our
// data, so an image drawn from the model's idea of the dish fails visibly.
export const MEALS: SpikeMeal[] = [
  // prisma/seed.ts — Greek Salad with Feta. Trap: no olives, no oregano.
  {
    slug: 'greek-salad',
    name: 'Greek Salad with Feta',
    description: 'Fresh salad with tomatoes, cucumber, and feta cheese',
    components: [
      g('feta cheese', 100),
      g('tomato', 120),
      g('cucumber', 100),
      g('onion', 30),
      ml('olive oil', 20),
    ],
  },
  // Inline. Trap: bolognese without meat or parmesan.
  {
    slug: 'lentil-bolognese',
    name: 'Lentil Bolognese',
    description: 'Hearty green-lentil ragù with spaghetti',
    components: [
      g('green lentils', 80),
      g('spaghetti', 100),
      g('tomato sauce', 150),
      g('onion', 50),
      g('carrot', 40),
      g('celery', 30),
      g('garlic', 5),
    ],
  },
  // prisma/seed-expansion.ts — Irish Lamb Stew. Trap: a brown stew with no tomato.
  {
    slug: 'lamb-stew',
    name: 'Irish Lamb Stew',
    description: 'Hearty lamb and potato stew',
    components: [
      g('lamb shank', 200),
      g('potato', 150),
      g('carrot', 80),
      g('onion', 60),
      ml('beef stock', 300),
      g('thyme', 3),
    ],
  },
  // prisma/seed.ts — Baked Chicken Thighs, with inlined notes (seed meals all
  // have preparationNotes: null). Trap: the notes set a cut and a serving form
  // the model would not guess — cubed potatoes, shredded chicken, no skin.
  {
    slug: 'chicken-thighs',
    name: 'Baked Chicken Thighs',
    description: 'Herb-roasted chicken thighs with potatoes',
    components: [
      g('chicken thigh', 200),
      g('potato', 150),
      ml('olive oil', 15),
      g('rosemary', 2),
      g('thyme', 2),
      g('garlic', 10),
    ],
    preparationNotes:
      'Cut the potatoes into 2cm cubes and roast them in a single layer. Roast the thighs on a separate tray, then pull the meat off the bone in large shreds, discard the skin, and pile the chicken over the potatoes.',
  },
  // prisma/seed.ts — Ratatouille. Trap: method-ambiguous — a stovetop stew or
  // a baked tian of sliced vegetables.
  {
    slug: 'ratatouille',
    name: 'Ratatouille',
    description: 'Classic French Provençal vegetable stew',
    components: [
      g('eggplant', 150),
      g('zucchini', 100),
      g('bell pepper', 80),
      g('tomato', 150),
      g('onion', 60),
      g('garlic', 10),
      ml('olive oil', 20),
      g('thyme', 2),
    ],
  },
  // Inline, "Imagine a meal"-style: exists nowhere else, so the model cannot
  // lean on a memorised reference. Kept from HON-717; pins the V1 prompt test.
  {
    slug: 'beetroot-gratin',
    name: 'Miso-glazed Beetroot & Rhubarb Gratin',
    description:
      'Layered beetroot and rhubarb baked under a white miso cream, finished with toasted buckwheat',
    components: [
      g('beetroot', 150),
      g('rhubarb', 60),
      g('white miso', 15),
      ml('heavy cream', 80),
      g('buckwheat', 20),
      g('thyme', 2),
    ],
  },
]

// ============================================
// SEED SAMPLE (HON-733)
// ============================================

export interface SeedMealInput {
  name: string
  description: string
  components: { ingredient: string; quantity: number }[]
}

export const SEED_SAMPLE_SIZE = 24

export const slugify = (name: string): string =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

export function toSpikeMeal(meal: SeedMealInput, units: Map<string, string>): SpikeMeal {
  return {
    slug: slugify(meal.name),
    name: meal.name,
    description: meal.description,
    components: meal.components.map((c) => ({
      name: c.ingredient,
      quantity: c.quantity,
      unit: units.get(c.ingredient) ?? 'g',
    })),
  }
}

/** Every `step`-th meal, so the sample spans the seed file's protein sections. */
export function sampleEvenly<T>(items: T[], size: number): T[] {
  const step = Math.max(1, Math.floor(items.length / size))
  return items.filter((_, i) => i % step === Math.floor(step / 2)).slice(0, size)
}

/**
 * Imported lazily: `prisma/seed.ts` constructs a Prisma client at module load,
 * which the unit test and a traps-only run should not pay for.
 */
async function loadSeedSample(): Promise<SpikeMeal[]> {
  const [{ baseIngredients }, { newIngredients, newMeals }] = await Promise.all([
    import('../prisma/seed'),
    import('../prisma/seed-expansion'),
  ])
  const units = new Map<string, string>(
    [...baseIngredients, ...newIngredients].map((i) => [i.name, i.defaultUnit]),
  )
  return sampleEvenly(newMeals, SEED_SAMPLE_SIZE).map((m) => toSpikeMeal(m, units))
}

// ============================================
// STYLES AND PROMPT VERSIONS
// ============================================

export type StyleId = 'photo' | 'illustration' | 'flat'
export type PromptVersion = 'v1' | 'v2' | 'v3'

export const PROMPT_VERSIONS: PromptVersion[] = ['v1', 'v2', 'v3']
/** HON-732's comparison. V3 is opt-in, so that default run stays reproducible. */
export const DEFAULT_VERSIONS: PromptVersion[] = ['v1', 'v2']

export interface SpikeStyle {
  id: StyleId
  label: string
  /** V1 prompt prefix — swappable and versioned so the follow-up reuses whichever wins. */
  prefix: string
  /** V2 prefix; only the chosen style (HON-726) has one. */
  prefixV2?: string
  /** V3 prefix (HON-733): V2 with the portion pinned to one person. */
  prefixV3?: string
}

export const STYLE_PREFIX_PHOTO_V1 =
  'Overhead food photograph, natural window light, shallow depth of field, served on a simple ceramic plate on a wooden table. Realistic, appetising home cooking, not restaurant plating.'
export const STYLE_PREFIX_ILLUSTRATION_V1 =
  'Warm stylised illustration of a home-cooked dish, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle.'
export const STYLE_PREFIX_FLAT_V1 =
  'Flat vector illustration of a dish, simple geometric shapes, limited palette of four to five colours, no gradients, no shadows, centred on a plain light background.'

/** HON-732: claims less — one served portion, nothing around it. */
export const STYLE_PREFIX_ILLUSTRATION_V2 =
  'Warm stylised illustration of one served portion of a home-cooked dish, on a single plain plate or in a single bowl, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle on a plain, uncluttered surface.'

/** HON-733: V2 heaped several servings onto one platter twice in twelve images. */
export const STYLE_PREFIX_ILLUSTRATION_V3 =
  'Warm stylised illustration of a single modest serving for one person of a home-cooked dish, on a single plain dinner plate or in a single bowl with space around the food, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle on a plain, uncluttered surface.'

export const STYLES: SpikeStyle[] = [
  { id: 'photo', label: 'Photoreal overhead', prefix: STYLE_PREFIX_PHOTO_V1 },
  {
    id: 'illustration',
    label: 'Stylised illustration',
    prefix: STYLE_PREFIX_ILLUSTRATION_V1,
    prefixV2: STYLE_PREFIX_ILLUSTRATION_V2,
    prefixV3: STYLE_PREFIX_ILLUSTRATION_V3,
  },
  { id: 'flat', label: 'Flat / iconographic', prefix: STYLE_PREFIX_FLAT_V1 },
]

const PROMPT_SUFFIX =
  'A single dish, landscape 3:2 composition with the food filling the frame. No text, no labels, no logos, no hands, no people.'

/**
 * V2's exclusion sentence. Names the HON-717 failures explicitly: added
 * garnish and olives, raw-ingredient props, and whole pots or baking dishes.
 */
export const V2_EXCLUSIONS =
  'Show only the finished, cooked dish as it is served. Nothing that is not in that list: no garnish, no herbs beyond those listed, no olives, bread or side dishes. No raw ingredients, cutting boards, pots, pans, baking dishes or other props around it.'

/** Largest amount first, as the prep route's quantities would rank them. */
export function ingredientsByQuantity(meal: SpikeMeal): string[] {
  return [...meal.components].sort((a, b) => b.quantity - a.quantity).map((c) => c.name)
}

function buildPromptV1(meal: SpikeMeal, style: SpikeStyle): string {
  return [
    style.prefix,
    `The dish: ${meal.name} — ${meal.description}.`,
    `Key ingredients: ${meal.components.map((c) => c.name).join(', ')}.`,
    PROMPT_SUFFIX,
  ].join(' ')
}

/** V2 and V3 share a body; only the prefix differs. */
function buildPromptV2(meal: SpikeMeal, style: SpikeStyle, version: 'v2' | 'v3' = 'v2'): string {
  const prefix = version === 'v2' ? style.prefixV2 : style.prefixV3
  if (!prefix) throw new Error(`Style "${style.id}" has no ${version.toUpperCase()} prefix`)
  const notes = meal.preparationNotes?.trim()
  return [
    prefix,
    `The dish: ${meal.name} — ${meal.description}.`,
    // Phrased as what the dish is made from, not a list to display — the V1
    // "Key ingredients:" line drew the raw ingredients around the plate.
    `It is made from exactly these ingredients, largest amount first: ${ingredientsByQuantity(meal).join(', ')}.`,
    ...(notes
      ? [`How it is prepared: ${notes} Show the ingredients cut and cooked exactly as described.`]
      : []),
    V2_EXCLUSIONS,
    PROMPT_SUFFIX,
  ].join(' ')
}

export function buildPrompt(meal: SpikeMeal, style: SpikeStyle, version: PromptVersion): string {
  return version === 'v1' ? buildPromptV1(meal, style) : buildPromptV2(meal, style, version)
}

// ============================================
// MODELS
// ============================================

export type ModelKey = 'flare' | 'sunburst' | 'nano-banana-2'

/** USD per 1M tokens. */
export interface TokenRate {
  inputPerM: number
  outputPerM: number
  /**
   * Rate for thinking/text output tokens when the provider bills them apart
   * from image output tokens. The AI SDK folds them into `outputTokens`.
   */
  thinkingPerM?: number
}

type ImageCallOptions = Pick<
  Parameters<typeof generateImage>[0],
  'size' | 'aspectRatio' | 'providerOptions'
>

export interface SpikeModel {
  key: ModelKey
  label: string
  modelId: string
  /** Lazy, so a dry run never constructs a provider or touches a key. */
  model: () => ImageModel
  callOptions: ImageCallOptions
  rate: TokenRate
  /** Flat fallback when the result carries no token usage. */
  estPerImageUsd: number
  apiKeyEnv: 'OPENAI_API_KEY' | 'GOOGLE_GENERATIVE_AI_API_KEY'
}

// Rates checked 2026-09-21:
// OpenAI — https://developers.openai.com/api/docs/pricing (GPT Image 2.5: text in $5, image out $30 per 1M)
// Google — https://ai.google.dev/gemini-api/docs/pricing (3.1 Flash Image: in $0.50, image out $60, text and thinking out $3 per 1M; 1K ≈ 1120 tokens ≈ $0.067)
const OPENAI_IMAGE_RATE: TokenRate = { inputPerM: 5, outputPerM: 30 }
const OPENAI_CALL_OPTIONS: ImageCallOptions = {
  size: '1536x1024',
  // `max` costs ~4× and a dialog hero won't show the difference (research comment on HON-717).
  providerOptions: { openai: { quality: 'high', outputFormat: 'png' } },
}

export const MODELS: SpikeModel[] = [
  {
    key: 'flare',
    label: 'GPT Image 2.5 Flare (high)',
    modelId: 'gpt-image-2.5-flare',
    model: () => openai.image('gpt-image-2.5-flare'),
    callOptions: OPENAI_CALL_OPTIONS,
    rate: OPENAI_IMAGE_RATE,
    estPerImageUsd: 0.05,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    key: 'sunburst',
    label: 'GPT Image 2.5 Sunburst (high)',
    modelId: 'gpt-image-2.5-sunburst',
    model: () => openai.image('gpt-image-2.5-sunburst'),
    callOptions: OPENAI_CALL_OPTIONS,
    rate: OPENAI_IMAGE_RATE,
    estPerImageUsd: 0.05,
    apiKeyEnv: 'OPENAI_API_KEY',
  },
  {
    key: 'nano-banana-2',
    label: 'Gemini 3.1 Flash Image (1K)',
    modelId: 'gemini-3.1-flash-image',
    model: () => google.image('gemini-3.1-flash-image'),
    callOptions: {
      aspectRatio: '3:2',
      providerOptions: { google: { imageConfig: { imageSize: '1K' } } },
    },
    rate: { inputPerM: 0.5, outputPerM: 60, thinkingPerM: 3 },
    estPerImageUsd: 0.067,
    apiKeyEnv: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
]

/** HON-732 narrows the default run to the chosen provider and style. */
const DEFAULT_MODELS: ModelKey[] = ['flare', 'sunburst']
const DEFAULT_STYLES: StyleId[] = ['illustration']

// Flat estimates for the dry run; the real run prices measured tokens.
// Judge: a ~1.6k-token image + ~700-token prompt in, ~800 out (with thinking).
export const JUDGE_EST_USD = 0.02
// Prep: the route's full-tips call, ~400 in and up to ~900 out.
export const PREP_EST_USD = 0.015

// ============================================
// PREP SAMPLE AND JUDGE
// ============================================

/** Servings the prep sample is generated for — a typical household of two. */
export const PREP_SERVINGS = 2

/** The prep route's `ingredientsList` format, scaled to `servings`. */
export function ingredientsListFor(meal: SpikeMeal, servings: number): string {
  return meal.components
    .map((c) => `- ${c.name}: ${Math.round(c.quantity * servings)}${c.unit}`)
    .join('\n')
}

export interface PrepSample {
  mealSlug: string
  /** `supplementary` when the meal has notes — the route then returns no steps. */
  kind: 'full' | 'supplementary'
  equipment: string[]
  steps: string[]
  pitfalls: string[]
  tip?: string
  latencyMs: number
  usd: number
  error?: string
}

export const judgeSchema = z.object({
  extraIngredients: z
    .array(z.string())
    .describe('Foods visible in or around the dish that are not in the ingredient list'),
  missingIngredients: z
    .array(z.string())
    .describe('Listed ingredients that should clearly be visible in the finished dish but are not'),
  prepContradictions: z
    .array(z.string())
    .describe('Each place the image contradicts the method, as "steps: X; image: Y"'),
  notes: z.string().describe('One sentence on anything else worth knowing').optional(),
})

export type JudgeFindings = z.infer<typeof judgeSchema>

export interface JudgeResult extends JudgeFindings {
  /** Computed from the findings, never taken from the model. */
  pass: boolean
  latencyMs: number
  usd: number
}

export function computePass(findings: JudgeFindings): boolean {
  return (
    findings.extraIngredients.length === 0 &&
    findings.missingIngredients.length === 0 &&
    findings.prepContradictions.length === 0
  )
}

export function buildJudgePrompt(meal: SpikeMeal, prep: PrepSample | undefined): string {
  const notes = meal.preparationNotes?.trim()
  const method: string[] = []
  if (notes) method.push(`The cook's own preparation notes:\n${notes}`)
  if (prep && !prep.error) {
    if (prep.steps.length > 0) {
      method.push(
        `Preparation steps shown to the user next to this image:\n${prep.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`,
      )
    }
    if (prep.equipment.length > 0) method.push(`Equipment: ${prep.equipment.join(', ')}`)
    if (prep.tip) method.push(`Tip: ${prep.tip}`)
  }

  return `You are checking a generated illustration of a meal against the meal's own recipe data. Judge only what is visibly in the image, not the art style.

Meal: ${meal.name} — ${meal.description}

Ingredients per serving (the complete list):
${ingredientsListFor(meal, 1)}

${method.length > 0 ? method.join('\n\n') : 'No preparation method is known.'}

Report:
- extraIngredients: foods visible in or around the dish that are not in the ingredient list — garnishes, herbs, olives, bread, sauces, side dishes. Name each once.
- missingIngredients: listed ingredients that should clearly be visible in the finished dish but are not. Ignore ingredients that are normally invisible once cooked, such as garlic, spices, dried herbs, stock, oil, miso or cream.
- prepContradictions: every place the image contradicts the method above — the cut (diced vs rings), the cooking method (stewed vs baked), the serving (a whole pot, tray or baking dish instead of one served portion), or raw ingredients or cookware displayed beside the dish. Write each as "steps: X; image: Y".

Leave a list empty when there is nothing to report. Do not report lighting, colour or composition.`
}

// ============================================
// JUDGE V2 (HON-733)
// ============================================

// HON-732's judge flagged garlic and thyme as missing although its prompt said
// to ignore them. Removing them in code means it is never asked about them.
const INVISIBLE_WHEN_COOKED =
  /garlic|ginger|stock|broth|\boil\b|butter|\bsalt\b|seasoning|powder|masala|cumin|paprika|cinnamon|turmeric|saffron|nutmeg|chili flakes|thyme|rosemary|oregano|\bsage\b|bay lea|miso|cream\b|yogurt|mayonnaise|vinegar|soy sauce|fish sauce|honey|syrup|sugar|flour|breadcrumbs|mustard|wine|tomato paste|lemon|lime/i

/** `pepper` alone is the spice; `bell pepper` is a vegetable. */
const isInvisible = (name: string): boolean =>
  /^(black |white )?pepper$/i.test(name) || INVISIBLE_WHEN_COOKED.test(name)

/** The ingredients a viewer should be able to point at in the finished dish. */
export function visibleIngredients(meal: SpikeMeal): string[] {
  return ingredientsByQuantity(meal).filter((name) => !isInvisible(name))
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

export interface JudgeV2Result extends JudgeV2Findings {
  /** No serious finding: nothing added, nothing beside the dish. The likely production gate. */
  pass: boolean
  /** `pass`, and nothing missing, and one serving. */
  strictPass: boolean
  latencyMs: number
  usd: number
}

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
export function dropListedExtras(extras: string[], meal: SpikeMeal): string[] {
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
export function dropServingware(props: string[], meal?: SpikeMeal): string[] {
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

/** No prep sample: production tips are per plan entry, so a production judge never sees them. */
export function buildJudgeV2Prompt(meal: SpikeMeal): string {
  const notes = meal.preparationNotes?.trim()
  return `You are checking a generated illustration of a meal against the meal's own recipe data. Judge only what is visibly in the image, not the art style.

Meal: ${meal.name} — ${meal.description}

Ingredients per serving — the complete list. Those marked "(may not be visible)" usually disappear into the dish, but are still part of it:
${meal.components
  .map(
    (c) =>
      `- ${c.name}: ${c.quantity}${c.unit}${isInvisible(c.name) ? ' (may not be visible)' : ''}`,
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

// ============================================
// PURE HELPERS
// ============================================

export interface Job {
  model: SpikeModel
  meal: SpikeMeal
  style: SpikeStyle
  version: PromptVersion
  /** 1-based; above 1 only with `--repeats`, to measure variance per prompt. */
  repeat: number
}

export interface JobResult {
  modelKey: ModelKey
  mealSlug: string
  styleId: StyleId
  version: PromptVersion
  repeat: number
  prompt: string
  latencyMs: number
  /** Relative to the run dir; absent when generation failed. */
  file?: string
  usd?: number
  costMeasured?: boolean
  usage?: { inputTokens?: number; outputTokens?: number }
  warnings?: string[]
  /** Raw provider metadata — Gemini's per-modality token breakdown lives here. */
  providerMetadata?: unknown
  error?: string
  /** V1 and V2 images: HON-732's judge, against the prep sample. */
  judge?: JudgeResult
  /** V3 images: the production-shaped judge. */
  judgeV2?: JudgeV2Result
  judgeError?: string
}

export type MealSet = 'traps' | 'seed'
const MEAL_SETS: MealSet[] = ['traps', 'seed']

export interface ParsedArgs {
  confirm: boolean
  judge: boolean
  models: ModelKey[]
  styles: StyleId[]
  versions: PromptVersion[]
  mealSets: MealSet[]
  repeats: number
  /** A previous run's directory: judge its V3 images again, generate nothing. */
  rejudge?: string
}

export function parseArgs(argv: string[]): ParsedArgs {
  const list = (flag: string): string[] | undefined => {
    const arg = argv.find((a) => a.startsWith(`--${flag}=`))
    return arg
      ?.slice(flag.length + 3)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  const allModels = MODELS.map((m) => m.key)
  const allStyles = STYLES.map((s) => s.id)
  const models = list('models') ?? DEFAULT_MODELS
  const styles = list('styles') ?? DEFAULT_STYLES
  const versions = list('versions') ?? DEFAULT_VERSIONS
  const mealSets = list('meals') ?? ['traps']
  const badSet = mealSets.find((m) => !MEAL_SETS.includes(m as MealSet))
  if (badSet) throw new Error(`Unknown meal set "${badSet}". Known: ${MEAL_SETS.join(', ')}`)
  const repeats = Number(list('repeats')?.[0] ?? 1)
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 4) {
    throw new Error('--repeats must be a whole number from 1 to 4')
  }
  const badModel = models.find((m) => !allModels.includes(m as ModelKey))
  if (badModel) throw new Error(`Unknown model "${badModel}". Known: ${allModels.join(', ')}`)
  const badStyle = styles.find((s) => !allStyles.includes(s as StyleId))
  if (badStyle) throw new Error(`Unknown style "${badStyle}". Known: ${allStyles.join(', ')}`)
  const badVersion = versions.find((v) => !PROMPT_VERSIONS.includes(v as PromptVersion))
  if (badVersion) {
    throw new Error(`Unknown version "${badVersion}". Known: ${PROMPT_VERSIONS.join(', ')}`)
  }
  for (const v of ['v2', 'v3'] as const) {
    if (!versions.includes(v)) continue
    const key = v === 'v2' ? 'prefixV2' : 'prefixV3'
    const without = STYLES.filter((s) => styles.includes(s.id) && !s[key]).map((s) => s.id)
    if (without.length > 0) {
      throw new Error(`Version ${v} is defined only for illustration, not ${without.join(', ')}`)
    }
  }
  return {
    confirm: argv.includes('--confirm'),
    judge: !argv.includes('--no-judge'),
    models: models as ModelKey[],
    styles: styles as StyleId[],
    versions: versions as PromptVersion[],
    mealSets: mealSets as MealSet[],
    repeats,
    rejudge: list('rejudge')?.[0],
  }
}

export function buildJobs(
  args: Pick<ParsedArgs, 'models' | 'styles' | 'versions'> & { repeats?: number },
  meals: SpikeMeal[] = MEALS,
): Job[] {
  const jobs: Job[] = []
  for (const model of MODELS.filter((m) => args.models.includes(m.key))) {
    for (const meal of meals) {
      for (const { style, version, repeat } of variantsFor(args)) {
        jobs.push({ model, meal, style, version, repeat })
      }
    }
  }
  return jobs
}

/** Only V1 and V2 images are judged against a prep sample. */
const needsPrep = (job: Pick<Job, 'version'>): boolean => job.version !== 'v3'

export function estimateTotalUsd(jobs: Job[], opts: { judge: boolean }): number {
  const images = jobs.reduce((sum, job) => sum + job.model.estPerImageUsd, 0)
  if (!opts.judge) return images
  const meals = new Set(jobs.filter(needsPrep).map((j) => j.meal.slug)).size
  return images + jobs.length * JUDGE_EST_USD + meals * PREP_EST_USD
}

/**
 * `measured` is true only when every billed token could be priced at its own
 * rate. When the model bills thinking separately and the thinking count is
 * missing, all output is priced at the image rate — an upper bound, not a
 * measurement.
 */
export function costFromUsage(
  usage: Partial<ImageModelUsage> | undefined,
  rate: TokenRate,
  estPerImageUsd: number,
  thinkingTokens?: number,
): { usd: number; measured: boolean } {
  if (usage?.outputTokens == null) return { usd: estPerImageUsd, measured: false }
  const splitThinking = rate.thinkingPerM != null && thinkingTokens != null
  const thinking = splitThinking ? Math.min(thinkingTokens, usage.outputTokens) : 0
  const usd =
    ((usage.inputTokens ?? 0) * rate.inputPerM +
      (usage.outputTokens - thinking) * rate.outputPerM +
      thinking * (rate.thinkingPerM ?? 0)) /
    1_000_000
  return { usd, measured: rate.thinkingPerM == null || splitThinking }
}

/** Gemini's `thoughtsTokenCount`, surfaced through the image result's provider metadata. */
export function thinkingTokensFrom(providerMetadata: unknown): number | undefined {
  const count = (
    providerMetadata as
      { google?: { usageMetadata?: { thoughtsTokenCount?: unknown } } } | undefined
  )?.google?.usageMetadata?.thoughtsTokenCount
  return typeof count === 'number' ? count : undefined
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp

/** Distinct model × version pairs, in first-seen order. */
function groups(results: JobResult[]): { model: ModelKey; version: PromptVersion }[] {
  const seen = new Map<string, { model: ModelKey; version: PromptVersion }>()
  for (const r of results) {
    seen.set(`${r.modelKey}|${r.version}`, { model: r.modelKey, version: r.version })
  }
  return [...seen.values()]
}

export interface ModelSummary {
  model: ModelKey
  version: PromptVersion
  ok: number
  failed: number
  meanLatencyS: number
  minLatencyS: number
  maxLatencyS: number
  meanUsd: number
  totalUsd: number
  cost: 'measured' | 'est.' | 'mixed' | 'n/a'
}

export function summarize(results: JobResult[]): ModelSummary[] {
  return groups(results).map(({ model, version }) => {
    const all = results.filter((r) => r.modelKey === model && r.version === version)
    const ok = all.filter((r) => !r.error)
    const latencies = ok.map((r) => r.latencyMs / 1000)
    const usds = ok.map((r) => r.usd ?? 0)
    const total = usds.reduce((a, b) => a + b, 0)
    const measured = ok.filter((r) => r.costMeasured).length
    return {
      model,
      version,
      ok: ok.length,
      failed: all.length - ok.length,
      meanLatencyS: ok.length ? round(latencies.reduce((a, b) => a + b, 0) / ok.length, 1) : 0,
      minLatencyS: ok.length ? round(Math.min(...latencies), 1) : 0,
      maxLatencyS: ok.length ? round(Math.max(...latencies), 1) : 0,
      meanUsd: ok.length ? round(total / ok.length, 4) : 0,
      totalUsd: round(total, 4),
      cost:
        ok.length === 0
          ? 'n/a'
          : measured === ok.length
            ? 'measured'
            : measured === 0
              ? 'est.'
              : 'mixed',
    }
  })
}

export interface PassRate {
  model: ModelKey
  version: PromptVersion
  /** Images with a judge verdict — a failed image or judge call is not judged. */
  judged: number
  /** V3: no serious finding. V1 and V2: HON-732's strict rule, so equal to `strictPassed`. */
  passed: number
  strictPassed: number
  /** Percent of `judged`; null when nothing was judged. */
  ratePct: number | null
}

const verdictOf = (r: JobResult): JudgeResult | JudgeV2Result | undefined => r.judge ?? r.judgeV2

export function passRates(results: JobResult[]): PassRate[] {
  return groups(results).map(({ model, version }) => {
    const judged = results.filter(
      (r) => r.modelKey === model && r.version === version && verdictOf(r),
    )
    const passed = judged.filter((r) => verdictOf(r)?.pass).length
    return {
      model,
      version,
      judged: judged.length,
      passed,
      strictPassed: judged.filter((r) => r.judgeV2?.strictPass ?? r.judge?.pass).length,
      ratePct: judged.length ? Math.round((passed / judged.length) * 100) : null,
    }
  })
}

export interface JudgeSummary {
  judged: number
  errors: number
  meanLatencyS: number
  maxLatencyS: number
  meanUsd: number
  totalUsd: number
}

export function judgeSummary(results: JobResult[]): JudgeSummary {
  const judged = results.flatMap((r) => verdictOf(r) ?? [])
  const latencies = judged.map((j) => j.latencyMs / 1000)
  const total = judged.reduce((a, j) => a + j.usd, 0)
  return {
    judged: judged.length,
    errors: results.filter((r) => r.judgeError).length,
    meanLatencyS: judged.length
      ? round(latencies.reduce((a, b) => a + b, 0) / judged.length, 1)
      : 0,
    maxLatencyS: judged.length ? round(Math.max(...latencies), 1) : 0,
    meanUsd: judged.length ? round(total / judged.length, 4) : 0,
    totalUsd: round(total, 4),
  }
}

export function extensionFor(mediaType: string): string {
  const sub = mediaType.split('/')[1] ?? 'bin'
  return sub === 'jpeg' ? 'jpg' : sub
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface Variant {
  style: SpikeStyle
  version: PromptVersion
  repeat: number
}

export function variantsFor(
  args: Pick<ParsedArgs, 'styles' | 'versions'> & { repeats?: number },
): Variant[] {
  const repeats = Array.from({ length: args.repeats ?? 1 }, (_, i) => i + 1)
  return STYLES.filter((s) => args.styles.includes(s.id)).flatMap((style) =>
    PROMPT_VERSIONS.filter((v) => args.versions.includes(v)).flatMap((version) =>
      repeats.map((repeat) => ({ style, version, repeat })),
    ),
  )
}

const variantLabel = (v: Variant) =>
  `${v.style.label} ${v.version.toUpperCase()}${v.repeat > 1 ? ` #${v.repeat}` : ''}`

function judgeHtml(r: JobResult): string {
  if (r.judgeError) {
    return `<div class="judge failed">Judge failed: ${escapeHtml(r.judgeError)}</div>`
  }
  const list = (label: string, items: string[]) =>
    items.length
      ? `<div><strong>${label}:</strong><ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>`
      : ''
  if (r.judgeV2) {
    const j = r.judgeV2
    const minor = j.pass && !j.strictPass ? ' <span class="badge minor">minor</span>' : ''
    return `<div class="judge"><span class="badge ${j.pass ? 'pass' : 'fail'}">${j.pass ? 'PASS' : 'FAIL'}</span>${minor}${list('Extra', j.extraIngredients)}${list('Props', j.propsOrCookware)}${list('Missing (minor)', j.missingIngredients)}${j.portion === 'one-serving' ? '' : `<div><strong>Portion (minor):</strong> ${j.portion}</div>`}${j.notes ? `<div class="note">${escapeHtml(j.notes)}</div>` : ''}</div>`
  }
  if (!r.judge) return ''
  const j = r.judge
  return `<div class="judge"><span class="badge ${j.pass ? 'pass' : 'fail'}">${j.pass ? 'PASS' : 'FAIL'}</span>${list('Extra', j.extraIngredients)}${list('Missing', j.missingIngredients)}${list('Contradicts prep', j.prepContradictions)}${j.notes ? `<div class="note">${escapeHtml(j.notes)}</div>` : ''}</div>`
}

function prepHtml(prep: PrepSample[], meals: SpikeMeal[]): string {
  return prep
    .map((p) => {
      const meal = meals.find((m) => m.slug === p.mealSlug)
      const notes = meal?.preparationNotes
        ? `<p class="meta">Notes: ${escapeHtml(meal.preparationNotes)}</p>`
        : ''
      const body = p.error
        ? `<p class="failed">Prep failed: ${escapeHtml(p.error)}</p>`
        : `${p.steps.length ? `<ol>${p.steps.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ol>` : ''}${p.tip ? `<p class="meta">Tip: ${escapeHtml(p.tip)}</p>` : ''}`
      return `<details><summary>${escapeHtml(meal?.name ?? p.mealSlug)} (${p.kind})</summary>${notes}${body}</details>`
    })
    .join('\n')
}

export function renderContactSheet(
  results: JobResult[],
  meta: {
    startedAt: string
    models: SpikeModel[]
    variants: Variant[]
    prep?: PrepSample[]
    /** Defaults to the trap meals. */
    meals?: SpikeMeal[]
  },
): string {
  const meals = meta.meals ?? MEALS
  const cell = (r: JobResult | undefined): string => {
    if (!r) return '<td class="empty">—</td>'
    if (r.error) return `<td class="failed"><strong>Failed</strong><br>${escapeHtml(r.error)}</td>`
    const cost = r.usd == null ? '' : `$${r.usd.toFixed(3)}${r.costMeasured ? '' : ' est.'}`
    return `<td><a href="${escapeHtml(r.file ?? '')}"><img src="${escapeHtml(r.file ?? '')}" alt="${escapeHtml(`${r.mealSlug} — ${r.styleId} ${r.version}`)}" loading="lazy"></a><div class="meta">${(r.latencyMs / 1000).toFixed(1)}s · ${cost}</div>${judgeHtml(r)}</td>`
  }

  const sections = meta.models
    .map((model) => {
      const rows = meals
        .map((meal) => {
          const cells = meta.variants
            .map((v) =>
              cell(
                results.find(
                  (r) =>
                    r.modelKey === model.key &&
                    r.mealSlug === meal.slug &&
                    r.styleId === v.style.id &&
                    r.version === v.version &&
                    r.repeat === v.repeat,
                ),
              ),
            )
            .join('')
          return `<tr><th scope="row">${escapeHtml(meal.name)}</th>${cells}</tr>`
        })
        .join('\n')
      const head = meta.variants
        .map((v) => `<th scope="col">${escapeHtml(variantLabel(v))}</th>`)
        .join('')
      return `<section>
<h2>${escapeHtml(model.label)} <code>${escapeHtml(model.modelId)}</code></h2>
<table><thead><tr><th></th>${head}</tr></thead><tbody>
${rows}
</tbody></table>
</section>`
    })
    .join('\n')

  const summaryRows = summarize(results)
    .map(
      (s) =>
        `<tr><td>${escapeHtml(s.model)}</td><td>${s.version}</td><td>${s.ok}</td><td>${s.failed}</td><td>${s.meanLatencyS}s (${s.minLatencyS}–${s.maxLatencyS})</td><td>$${s.meanUsd.toFixed(4)}</td><td>$${s.totalUsd.toFixed(4)}</td><td>${s.cost}</td></tr>`,
    )
    .join('\n')

  const passRows = passRates(results)
    .map(
      (p) =>
        `<tr><td>${escapeHtml(p.model)}</td><td>${p.version}</td><td>${p.passed}/${p.judged}</td><td>${p.strictPassed}/${p.judged}</td><td>${p.ratePct == null ? '—' : `${p.ratePct}%`}</td></tr>`,
    )
    .join('\n')
  const js = judgeSummary(results)

  const prompts = meta.variants
    .map((v) => {
      const prefix =
        v.version === 'v1'
          ? v.style.prefix
          : ((v.version === 'v2' ? v.style.prefixV2 : v.style.prefixV3) ?? '')
      return `<li><strong>${escapeHtml(variantLabel(v))}:</strong> ${escapeHtml(prefix)}</li>`
    })
    .join('\n')

  const prep = meta.prep?.length
    ? `<h2>Prep sample the judge compared against (${PREP_SERVINGS} servings)</h2>\n${prepHtml(meta.prep, meals)}`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Meal image spike — ${escapeHtml(meta.startedAt)}</title>
<style>
  body { font: 14px/1.4 system-ui, sans-serif; margin: 24px; color: #1c1917; background: #fafaf9; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 32px; }
  table { border-collapse: collapse; }
  th, td { border: 1px solid #d6d3d1; padding: 6px; vertical-align: top; text-align: left; }
  td { max-width: 360px; }
  td img { width: 360px; height: auto; display: block; }
  .meta { color: #57534e; font-size: 12px; margin-top: 4px; }
  .failed { width: 360px; color: #b91c1c; font-size: 12px; }
  .summary td, .summary th { padding: 4px 10px; }
  .judge { font-size: 12px; margin-top: 6px; }
  .judge ul { margin: 2px 0 4px; padding-left: 18px; }
  .badge { display: inline-block; font-weight: 700; padding: 1px 6px; border-radius: 4px; }
  .pass { background: #dcfce7; color: #166534; }
  .fail { background: #fee2e2; color: #991b1b; }
  .minor { background: #fef3c7; color: #92400e; }
  .note { color: #57534e; }
</style>
</head>
<body>
<h1>Meal image spike (HON-717, HON-732, HON-733) — ${escapeHtml(meta.startedAt)}</h1>
<h2>Judge pass rate</h2>
<table class="summary"><thead><tr><th>Model</th><th>Version</th><th>Passed</th><th>Strict</th><th>Rate</th></tr></thead><tbody>
${passRows}
</tbody></table>
<p class="meta">Judge (${escapeHtml(REVIEW_MODEL)}): ${js.judged} calls, ${js.errors} errors, mean ${js.meanLatencyS}s (max ${js.maxLatencyS}s), mean $${js.meanUsd.toFixed(4)}, total $${js.totalUsd.toFixed(4)}.</p>
<h2>Images</h2>
<table class="summary"><thead><tr><th>Model</th><th>Version</th><th>OK</th><th>Failed</th><th>Latency mean (min–max)</th><th>Mean USD</th><th>Total USD</th><th>Cost</th></tr></thead><tbody>
${summaryRows}
</tbody></table>
<h2>Style prefixes</h2>
<ul>${prompts}</ul>
<p class="meta">V1 = prefix + meal name/description + “Key ingredients: …” + suffix. V3 = V2 with its own prefix. V2 = prefix + name/description + ingredients by quantity + preparation notes (when set) + “${escapeHtml(V2_EXCLUSIONS)}” + suffix. Suffix: “${escapeHtml(PROMPT_SUFFIX)}”. Full prompts in results.json.</p>
${prep}
${sections}
</body>
</html>
`
}

// ============================================
// MAIN
// ============================================

function isOrgVerificationError(error: unknown): boolean {
  const parts: string[] = []
  if (error instanceof Error) parts.push(error.message)
  if (error && typeof error === 'object' && 'responseBody' in error) {
    parts.push(String((error as { responseBody?: unknown }).responseBody ?? ''))
  }
  return /organization must be verified/i.test(parts.join(' '))
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

type Anthropic = ReturnType<typeof createAnthropic>

function claudeUsd(
  model: string,
  usage: { inputTokens?: number; outputTokens?: number } | undefined,
): number {
  // No prompt caching here, so the SDK's total input count is all uncached.
  return estimateCostUsd({
    model,
    inputTokens: usage?.inputTokens ?? 0,
    outputTokens: usage?.outputTokens ?? 0,
  })
}

/** One prep call per meal, through the same prompts and schemas the prep route uses. */
async function generatePrepSample(anthropic: Anthropic, meal: SpikeMeal): Promise<PrepSample> {
  const input = {
    mealName: meal.name,
    householdSize: PREP_SERVINGS,
    timeMinutes: null,
    ingredientsList: ingredientsListFor(meal, PREP_SERVINGS),
    locale: 'en',
  }
  const notes = meal.preparationNotes?.trim()
  const t0 = performance.now()
  try {
    if (notes) {
      // Same token ceilings as the prep route (HON-693).
      const result = await generateObject({
        model: anthropic(TIPS_MODEL),
        schema: supplementaryTipsSchema,
        prompt: buildSupplementaryTipsPrompt({ ...input, preparationNotes: notes }),
        maxOutputTokens: 1200,
        maxRetries: 2,
      })
      return {
        mealSlug: meal.slug,
        kind: 'supplementary',
        equipment: [],
        steps: [],
        pitfalls: result.object.pitfalls,
        tip: result.object.tip,
        latencyMs: performance.now() - t0,
        usd: claudeUsd(TIPS_MODEL, result.usage),
      }
    }
    const result = await generateObject({
      model: anthropic(TIPS_MODEL),
      schema: fullTipsSchema,
      prompt: buildFullTipsPrompt(input),
      maxOutputTokens: 2000,
      maxRetries: 2,
    })
    return {
      mealSlug: meal.slug,
      kind: 'full',
      ...result.object,
      latencyMs: performance.now() - t0,
      usd: claudeUsd(TIPS_MODEL, result.usage),
    }
  } catch (error) {
    return {
      mealSlug: meal.slug,
      kind: notes ? 'supplementary' : 'full',
      equipment: [],
      steps: [],
      pitfalls: [],
      latencyMs: performance.now() - t0,
      usd: 0,
      error: messageOf(error),
    }
  }
}

async function judgeImage(
  anthropic: Anthropic,
  image: Uint8Array,
  mediaType: string,
  meal: SpikeMeal,
  prep: PrepSample | undefined,
): Promise<JudgeResult> {
  const t0 = performance.now()
  const result = await generateObject({
    model: anthropic(REVIEW_MODEL),
    schema: judgeSchema,
    messages: [
      {
        role: 'user',
        content: [
          // A `file` part — ai@7 deprecates the `image` content part.
          { type: 'file', data: image, mediaType },
          { type: 'text', text: buildJudgePrompt(meal, prep) },
        ],
      },
    ],
    maxOutputTokens: 2000,
    maxRetries: 2,
  })
  return {
    ...result.object,
    pass: computePass(result.object),
    latencyMs: performance.now() - t0,
    usd: claudeUsd(REVIEW_MODEL, result.usage),
  }
}

async function judgeImageV2(
  anthropic: Anthropic,
  image: Uint8Array,
  mediaType: string,
  meal: SpikeMeal,
): Promise<JudgeV2Result> {
  const t0 = performance.now()
  const result = await generateObject({
    model: anthropic(REVIEW_MODEL),
    schema: judgeV2Schema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: image, mediaType },
          { type: 'text', text: buildJudgeV2Prompt(meal) },
        ],
      },
    ],
    maxOutputTokens: 2000,
    maxRetries: 2,
  })
  const findings = {
    ...result.object,
    extraIngredients: dropListedExtras(result.object.extraIngredients, meal),
    // A listed lime wedge on the plate came back as a prop.
    propsOrCookware: dropServingware(result.object.propsOrCookware, meal),
  }
  return {
    ...findings,
    ...computePassV2(findings),
    latencyMs: performance.now() - t0,
    usd: claudeUsd(REVIEW_MODEL, result.usage),
  }
}

/**
 * Judge iteration without image spend: reads a run's results.json, judges its
 * V3 images again with the current judge, and writes `*-rejudged` beside it.
 */
async function rejudge(dir: string, confirm: boolean) {
  const runDir = resolve(dir)
  const run = JSON.parse(readFileSync(join(runDir, 'results.json'), 'utf8')) as {
    startedAt: string
    results: JobResult[]
  }
  const all = [...MEALS, ...(await loadSeedSample())]
  const targets = run.results.filter((r) => r.file && r.version === 'v3')
  console.log(
    `\nRejudge ${targets.length} V3 images in ${runDir} — ~$${(targets.length * JUDGE_EST_USD).toFixed(2)}`,
  )
  if (!confirm) return console.log('Dry run — pass --confirm to spend.')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('Missing ANTHROPIC_API_KEY in .env')
  const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  for (const r of targets) {
    const meal = all.find((m) => m.slug === r.mealSlug)
    if (!meal || !r.file) continue
    const mediaType = r.file.endsWith('.png') ? 'image/png' : 'image/jpeg'
    try {
      const j = await judgeImageV2(anthropic, readFileSync(join(runDir, r.file)), mediaType, meal)
      r.judgeV2 = j
      delete r.judgeError
      console.log(
        `${r.mealSlug.padEnd(30)} ${j.pass ? 'PASS' : 'FAIL'}${j.pass && !j.strictPass ? ' (minor)' : ''}  extra=${JSON.stringify(j.extraIngredients)} props=${JSON.stringify(j.propsOrCookware)} missing=${JSON.stringify(j.missingIngredients)} ${j.portion}`,
      )
    } catch (error) {
      r.judgeError = messageOf(error)
    }
  }
  const meals = all.filter((m) => run.results.some((r) => r.mealSlug === m.slug))
  const repeats = Math.max(...run.results.map((r) => r.repeat ?? 1))
  const models = MODELS.filter((m) => run.results.some((r) => r.modelKey === m.key))
  const variants = variantsFor({ styles: ['illustration'], versions: ['v3'], repeats })
  writeFileSync(join(runDir, 'results-rejudged.json'), JSON.stringify(run, null, 2))
  const sheet = join(runDir, 'index-rejudged.html')
  writeFileSync(
    sheet,
    renderContactSheet(run.results, { startedAt: run.startedAt, models, variants, meals }),
  )
  console.table(passRates(run.results))
  console.table([judgeSummary(run.results)])
  console.log(`\nContact sheet: ${pathToFileURL(sheet).href}`)
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.rejudge) return rejudge(args.rejudge, args.confirm)
  const meals = [
    ...(args.mealSets.includes('traps') ? MEALS : []),
    ...(args.mealSets.includes('seed') ? await loadSeedSample() : []),
  ]
  const jobs = buildJobs(args, meals)
  const prepMeals = meals.filter((meal) => jobs.some((j) => j.meal === meal && needsPrep(j)))
  const models = MODELS.filter((m) => args.models.includes(m.key))
  const variants = variantsFor(args)
  const line = (label: string, n: number, each: number) =>
    console.log(`  ${label.padEnd(32)} ${n} × ~$${each.toFixed(3)} = ~$${(n * each).toFixed(2)}`)

  console.log(`\nMeal image spike — ${jobs.length} images`)
  console.log(`  Meals:    ${meals.map((m) => m.name).join(', ')}`)
  console.log(`  Variants: ${variants.map(variantLabel).join(', ')}`)
  for (const m of models) {
    line(m.label, jobs.filter((j) => j.model.key === m.key).length, m.estPerImageUsd)
  }
  if (args.judge) {
    line(`Judge (${REVIEW_MODEL})`, jobs.length, JUDGE_EST_USD)
    line(`Prep sample (${TIPS_MODEL})`, prepMeals.length, PREP_EST_USD)
  } else {
    console.log('  Judge and prep sample skipped (--no-judge)')
  }
  const estimate = estimateTotalUsd(jobs, { judge: args.judge })
  console.log(`  Estimated total: ~$${estimate.toFixed(2)}\n`)

  if (!args.confirm) {
    console.log(`Dry run — pass --confirm to spend ~$${estimate.toFixed(2)}.`)
    return
  }

  const keys: string[] = models.map((m) => m.apiKeyEnv)
  if (args.judge) keys.push('ANTHROPIC_API_KEY')
  const missing = [...new Set(keys)].filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing ${missing.join(', ')} in .env (see HON-731).`)
  }

  const startedAt = new Date().toISOString()
  const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
  const outDir = join(repoRoot, '.temp', 'spike-meal-images', startedAt.replace(/[:.]/g, '-'))
  for (const m of models) mkdirSync(join(outDir, m.key), { recursive: true })

  const anthropic = args.judge
    ? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
    : undefined

  // The judge compares every image of a meal against the same prep sample.
  const prep: PrepSample[] = []
  if (anthropic) {
    for (const meal of prepMeals) {
      const sample = await generatePrepSample(anthropic, meal)
      prep.push(sample)
      console.log(
        `[prep] ${meal.slug.padEnd(16)} ${(sample.latencyMs / 1000).toFixed(1)}s  $${sample.usd.toFixed(4)}  ${sample.error ? `FAILED: ${sample.error}` : `${sample.kind}, ${sample.steps.length} steps`}`,
      )
    }
    writeFileSync(join(outDir, 'prep.json'), JSON.stringify(prep, null, 2))
    console.log('')
  }

  const results: JobResult[] = []
  // Set when the run must stop early. Outputs are still written below, so
  // images already paid for keep their latency and cost data.
  let abortReason: string | undefined
  for (const [i, job] of jobs.entries()) {
    const prompt = buildPrompt(job.meal, job.style, job.version)
    const base = {
      modelKey: job.model.key,
      mealSlug: job.meal.slug,
      styleId: job.style.id,
      version: job.version,
      repeat: job.repeat,
      prompt,
    }
    const suffix = job.repeat > 1 ? `-r${job.repeat}` : ''
    const tag = `[${String(i + 1).padStart(2)}/${jobs.length}] ${job.model.key} · ${job.meal.slug} · ${job.style.id} ${job.version}${suffix}`
    const t0 = performance.now()
    try {
      const result = await generateImage({
        model: job.model.model(),
        prompt,
        ...job.model.callOptions,
        maxRetries: 1,
      })
      const latencyMs = performance.now() - t0
      // Gemini returns JPEG even though OpenAI honours outputFormat: 'png'.
      const file = `${job.model.key}/${job.meal.slug}-${job.style.id}-${job.version}${suffix}.${extensionFor(result.image.mediaType)}`
      writeFileSync(join(outDir, file), result.image.uint8Array)
      const cost = costFromUsage(
        result.usage,
        job.model.rate,
        job.model.estPerImageUsd,
        thinkingTokensFrom(result.providerMetadata),
      )
      const warnings = result.warnings.map((w) => JSON.stringify(w))
      const row: JobResult = {
        ...base,
        latencyMs,
        file,
        usd: cost.usd,
        costMeasured: cost.measured,
        usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens },
        warnings,
        providerMetadata: result.providerMetadata,
      }
      let verdict = ''
      if (anthropic && job.version === 'v3') {
        try {
          const j = await judgeImageV2(
            anthropic,
            result.image.uint8Array,
            result.image.mediaType,
            job.meal,
          )
          row.judgeV2 = j
          verdict = `  judge ${j.pass ? 'PASS' : 'FAIL'}${j.pass && !j.strictPass ? ' (minor)' : ''} (+${j.extraIngredients.length} props ${j.propsOrCookware.length} −${j.missingIngredients.length} ${j.portion}) ${(j.latencyMs / 1000).toFixed(1)}s $${j.usd.toFixed(4)}`
        } catch (error) {
          row.judgeError = messageOf(error)
          verdict = `  judge FAILED: ${row.judgeError}`
        }
      } else if (anthropic) {
        try {
          const j = await judgeImage(
            anthropic,
            result.image.uint8Array,
            result.image.mediaType,
            job.meal,
            prep.find((p) => p.mealSlug === job.meal.slug),
          )
          row.judge = j
          verdict = `  judge ${j.pass ? 'PASS' : 'FAIL'} (+${j.extraIngredients.length} −${j.missingIngredients.length} ≠${j.prepContradictions.length}) ${(j.latencyMs / 1000).toFixed(1)}s $${j.usd.toFixed(4)}`
        } catch (error) {
          // A judge failure costs its verdict, not the image or the run.
          row.judgeError = messageOf(error)
          verdict = `  judge FAILED: ${row.judgeError}`
        }
      }
      results.push(row)
      console.log(
        `${tag}  ${(latencyMs / 1000).toFixed(1)}s  $${cost.usd.toFixed(4)}${cost.measured ? '' : ' est.'}${verdict}${warnings.length ? `  warnings: ${warnings.join('; ')}` : ''}`,
      )
    } catch (error) {
      const latencyMs = performance.now() - t0
      const message = messageOf(error)
      results.push({ ...base, latencyMs, error: message })
      console.log(`${tag}  FAILED after ${(latencyMs / 1000).toFixed(1)}s: ${message}`)
      if (isOrgVerificationError(error)) {
        abortReason =
          'OpenAI returned 403 "Organization must be verified" — a console fix, not a code bug. Verify the org (see HON-731) and rerun the remaining models with --models=.'
        break
      }
    }
  }

  writeFileSync(join(outDir, 'results.json'), JSON.stringify({ startedAt, prep, results }, null, 2))
  const sheet = join(outDir, 'index.html')
  writeFileSync(sheet, renderContactSheet(results, { startedAt, models, variants, prep, meals }))

  console.log('\nImages per model × version:')
  console.table(summarize(results))
  if (anthropic) {
    console.log('\nJudge pass rate per model × version:')
    console.table(passRates(results))
    console.log(`\nJudge (${REVIEW_MODEL}) cost and latency:`)
    console.table([judgeSummary(results)])
    const prepUsd = prep.reduce((a, p) => a + p.usd, 0)
    console.log(`Prep sample (${TIPS_MODEL}): ${prep.length} calls, $${prepUsd.toFixed(4)} total`)
  }
  console.log(`\nContact sheet: ${pathToFileURL(sheet).href}`)

  if (abortReason) throw new Error(abortReason)
}

// Guarded so the unit test can import the pure helpers without spending money.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(`\nspike-meal-images failed: ${messageOf(error)}`)
    process.exitCode = 1
  })
}
