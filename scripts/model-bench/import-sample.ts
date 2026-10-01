/**
 * `pnpm bench:models --import-sample <file> --id <task>/<slug>` (HON-903).
 *
 * Turns one production `[ai-sample]` line (`src/lib/ai/sampling.ts`) into
 * `cases/<task>/<slug>.draft.json`: the case's input filled from what the call
 * site logged, every expectation field present but empty, and the sample's own
 * `input` and `output` under `sampleInput` / `sampleOutput` for reference.
 *
 * A draft is a skeleton, not a case. `loadCases` skips `*.draft.json`, the
 * files are gitignored because they hold a real household's text, and the
 * case schemas are strict at the top level, so a draft renamed with its sample
 * keys still in it fails to load. `cases/README.md` has the steps that finish
 * one.
 *
 * Each call site logs less than a case needs (a plan sample has pool sizes,
 * not pools), so every field the sample cannot fill is left empty and listed
 * in the command's output. Nothing here calls a model.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { SAMPLE_PREFIX, type AiSampleCallSite } from '../../src/lib/ai/sampling'
import { DEFAULT_LOCALE, KNOWN_LOCALES } from '../../src/lib/i18n/locales'
import { TASKS, type Task } from './case-schema'
import { DRAFT_SUFFIX } from './load-cases'

/** A sample this command cannot turn into a draft; the message says why. */
export class ImportSampleError extends Error {}

export const OUT_OF_SCOPE_MESSAGE = "fillEmptySlots is out of the benchmark's scope"

/** The `[ai-sample]` payload, as `logAiSample` writes it. */
const SampleSchema = z.object({
  type: z.literal('ai_sample'),
  callSite: z.string(),
  locale: z.string().nullish(),
  input: z.record(z.string(), z.unknown()),
  output: z.unknown(),
})

export type AiSample = z.infer<typeof SampleSchema>

type SupportedCallSite = Exclude<AiSampleCallSite, 'fill-empty-slots'>

/** Which benchmark task runs the request each call site sends. */
export const CALL_SITE_TASKS: Record<SupportedCallSite, Task> = {
  'generate-plan': 'plan',
  'imagine-meal': 'imagine',
  'parse-recipe': 'recipe',
  'review-quantities': 'review',
  'preparation-tips-full': 'tips',
  'preparation-tips-supplementary': 'tips',
}

// What each call site passes to `logAiSample` as `input`. Kept loose on purpose
// beyond the fields read here: a call site that logs one more field must not
// break the import.

/** `generate-plan.ts`, after `generateObject`. */
const PlanSampleInput = z.object({
  mealTypes: z.array(z.string()),
  totalEntries: z.number(),
  restrictionsCount: z.number(),
  hasPantry: z.boolean(),
  candidatePoolSizes: z.object({ fish: z.number(), legume: z.number(), any: z.number() }),
})

/** `imagine-meal.ts`, after the first call. */
const ImagineSampleInput = z.object({
  prompt: z.string(),
  hasImages: z.boolean().optional(),
  dietaryType: z.string().nullable(),
  allergens: z.array(z.string()),
  excludedIngredients: z.array(z.string()),
  restrictions: z.array(z.string()),
  householdSize: z.number(),
})

/** `parse-recipe.ts`: the first 1000 characters, and the full length. */
const RecipeSampleInput = z.object({
  textPreview: z.string(),
  textLength: z.number(),
})

/** `review-quantities.ts`: the ingredients without their IDs. */
const ReviewSampleInput = z.object({
  mealName: z.string(),
  servings: z.number(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      quantityPerServing: z.number(),
      unit: z.enum(['g', 'piece']),
    }),
  ),
})

/** The preparation-tips route, both kinds. */
const TipsSampleInput = z.object({
  mealName: z.string(),
  householdSize: z.number(),
  timeMinutes: z.number().nullable(),
  ingredientsCount: z.number(),
  hasUserNotes: z.boolean(),
})

export interface Draft {
  task: Task
  /** The case file's contents. */
  draft: Record<string, unknown>
  /** Input fields the sample could not fill, each with what the sample did say. */
  missingInput: string[]
  /** Expectation fields left empty for a human to write. */
  expectations: string[]
  /** Anything else worth reading before finishing the draft. */
  notes: string[]
}

/**
 * Read one sample from a file's text: the JSON object itself (pretty-printed
 * or not), the stdout line with its `[ai-sample] ` prefix (anything before the
 * prefix, such as a Vercel timestamp, is dropped), or one line from
 * `.ai-samples/*.jsonl`.
 */
export function parseSampleText(text: string): AiSample {
  const trimmed = text.trim()
  if (trimmed === '') throw new ImportSampleError('The sample file is empty.')

  const at = trimmed.indexOf(`${SAMPLE_PREFIX} `)
  const json = at === -1 ? trimmed : trimmed.slice(at + SAMPLE_PREFIX.length + 1)

  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch (err) {
    const lines = trimmed.split('\n').filter((l) => l.trim() !== '').length
    if (lines > 1) {
      throw new ImportSampleError(
        `The file holds ${lines} lines and is not one JSON object. Put the one sample you want in a file of its own.`,
      )
    }
    throw new ImportSampleError(`The sample is not valid JSON: ${(err as Error).message}`)
  }

  const parsed = SampleSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ImportSampleError(`Not an [ai-sample] record: ${formatIssues(parsed.error)}`)
  }
  return parsed.data
}

/** `<task>/<slug>`, the same id `loadCases` gives the finished case. */
export function parseCaseId(id: string): { task: Task; slug: string } {
  const match = /^([a-z]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)$/.exec(id)
  if (!match || !(TASKS as readonly string[]).includes(match[1]!)) {
    throw new ImportSampleError(
      `--id takes <task>/<slug>, with a task from ${TASKS.join(', ')} and a lowercase, hyphenated slug (imagine/en-pasta-for-two); got "${id}".`,
    )
  }
  return { task: match[1] as Task, slug: match[2]! }
}

/** Build the draft for a sample. Throws for `fill-empty-slots` and unknown call sites. */
export function draftFromSample(sample: AiSample): Draft {
  if (sample.callSite === 'fill-empty-slots') throw new ImportSampleError(OUT_OF_SCOPE_MESSAGE)
  if (!Object.hasOwn(CALL_SITE_TASKS, sample.callSite)) {
    throw new ImportSampleError(
      `Unknown callSite "${sample.callSite}". The benchmark imports ${Object.keys(CALL_SITE_TASKS).join(', ')}.`,
    )
  }
  const callSite = sample.callSite as SupportedCallSite

  const notes: string[] = []
  const locale = sample.locale ?? DEFAULT_LOCALE
  if (!(KNOWN_LOCALES as readonly string[]).includes(locale)) {
    notes.push(
      `The sample's locale "${locale}" is not one the benchmark runs (${KNOWN_LOCALES.join(', ')}).`,
    )
  }

  const built = buildInput(callSite, sample.input, locale)
  return {
    task: CALL_SITE_TASKS[callSite],
    draft: {
      ...built.fields,
      source: 'ai-sample',
      sampleInput: sample.input,
      sampleOutput: sample.output,
    },
    missingInput: built.missingInput,
    expectations: built.expectations,
    notes: [...notes, ...built.notes],
  }
}

interface BuiltInput {
  fields: Record<string, unknown>
  missingInput: string[]
  expectations: string[]
  notes: string[]
}

function buildInput(callSite: SupportedCallSite, input: unknown, locale: string): BuiltInput {
  switch (callSite) {
    case 'generate-plan':
      return planInput(parseInput(PlanSampleInput, input, callSite), locale)
    case 'imagine-meal':
      return imagineInput(parseInput(ImagineSampleInput, input, callSite), locale)
    case 'parse-recipe':
      return recipeInput(parseInput(RecipeSampleInput, input, callSite), locale)
    case 'review-quantities':
      return reviewInput(parseInput(ReviewSampleInput, input, callSite), locale)
    case 'preparation-tips-full':
    case 'preparation-tips-supplementary':
      return tipsInput(
        parseInput(TipsSampleInput, input, callSite),
        callSite === 'preparation-tips-full' ? 'full' : 'supplementary',
        locale,
      )
  }
}

function planInput(input: z.infer<typeof PlanSampleInput>, locale: string): BuiltInput {
  const { fish, legume, any } = input.candidatePoolSizes
  const missingInput = [
    `startDate, endDate: the sample logs no dates, only that the plan had ${input.totalEntries} slots`,
    `weekdayMealTypes, weekendMealTypes: the sample logs the meal types (${input.mealTypes.join(', ') || 'none'}), not which days take which`,
    'dietaryType: not in the sample',
  ]
  if (input.restrictionsCount > 0) {
    missingInput.push(
      `restrictions: the sample logs only that there were ${input.restrictionsCount}`,
    )
  }
  if (input.hasPantry) {
    missingInput.push('pantryIngredients: the sample logs only that the pantry was not empty')
  }
  missingInput.push(
    `candidatePools, candidatesByMealType: the sample logs only the pool sizes (fish ${fish}, legume ${legume}, any ${any}); a plan case needs 20 to 50 dinner candidates`,
  )

  return {
    fields: {
      startDate: '',
      endDate: '',
      weekdayMealTypes: [],
      weekendMealTypes: [],
      dietaryType: null,
      restrictions: [],
      pantryIngredients: [],
      locale,
      candidatePools: { fish: [], legume: [], any: [] },
      candidatesByMealType: {},
    },
    missingInput,
    expectations: [],
    notes: [
      'A plan case has no expectation to write: every plan is scored on validity and pool membership.',
    ],
  }
}

function imagineInput(input: z.infer<typeof ImagineSampleInput>, locale: string): BuiltInput {
  return {
    fields: {
      prompt: input.prompt,
      household: {
        allergens: input.allergens,
        dietaryType: input.dietaryType,
        excludedIngredients: input.excludedIngredients,
        restrictions: input.restrictions,
        householdSize: input.householdSize,
      },
      locale,
      forbiddenKeywords: [],
      allowedQualifiers: [],
    },
    missingInput: [],
    expectations: [
      'forbiddenKeywords: the excluded ingredients, and any food the shared lists in src/lib/ai/forbidden-foods.ts lack; delete the field if there are none',
      'allowedQualifiers: swaps that excuse one of those keywords ("vegan parmesan"); delete the field if there are none',
    ],
    notes: input.hasImages
      ? [
          'The user also sent images, which the benchmark does not run: check that the prompt alone still says what they asked for.',
        ]
      : [],
  }
}

function recipeInput(input: z.infer<typeof RecipeSampleInput>, locale: string): BuiltInput {
  const truncated = input.textLength > input.textPreview.length
  return {
    fields: {
      text: input.textPreview,
      locale,
      expected: { ingredients: [], lowConfidence: null, stepCount: null },
    },
    missingInput: truncated
      ? [
          `text: the sample kept the first ${input.textPreview.length} of ${input.textLength} characters`,
        ]
      : [],
    expectations: [
      'expected.ingredients: one entry per ingredient, names in the output language',
      'expected.lowConfidence: true only if the app should reject the text as not a recipe',
      'expected.stepCount: the number of steps, or delete the field',
    ],
    notes: [],
  }
}

function reviewInput(input: z.infer<typeof ReviewSampleInput>, locale: string): BuiltInput {
  const ids = new Set<string>()
  const ingredients = input.ingredients.map((ing) => {
    const base = `ing-${slugify(ing.name) || 'ingredient'}`
    let id = base
    for (let n = 2; ids.has(id); n++) id = `${base}-${n}`
    ids.add(id)
    return { ingredientId: id, ...ing }
  })

  return {
    fields: {
      mealName: input.mealName,
      servings: input.servings,
      ingredients,
      locale,
      expected: {},
    },
    missingInput: [],
    expectations: [
      'expected: keyed by ingredientId, a seeded error\'s corrected quantityPerServing or { "min", "max" } range, or { "unchanged": true } for a quantity that must be kept',
    ],
    notes: ["The ingredientIds are made from the names; the IDs in sampleOutput are the app's."],
  }
}

function tipsInput(
  input: z.infer<typeof TipsSampleInput>,
  kind: 'full' | 'supplementary',
  locale: string,
): BuiltInput {
  const missingInput = [
    `components: the sample logs only that the meal had ${input.ingredientsCount} ingredients`,
  ]
  if (kind === 'supplementary') {
    missingInput.push('preparationNotes: the sample logs only that the user wrote notes')
  }
  return {
    fields: {
      kind,
      mealName: input.mealName,
      servings: input.householdSize,
      timeMinutes: input.timeMinutes,
      components: [],
      locale,
      ...(kind === 'supplementary' ? { preparationNotes: '' } : {}),
    },
    missingInput,
    expectations: [],
    notes: [
      'A tips case has no expectation to write: tips are scored on item counts and by the judge.',
    ],
  }
}

/**
 * Read `samplePath`, build the draft and write it as
 * `<casesDir>/<task>/<slug>.draft.json`. Refuses to overwrite a case or a draft.
 */
export function importSample(opts: { samplePath: string; id: string; casesDir: string }): Draft & {
  path: string
} {
  const { task, slug } = parseCaseId(opts.id)
  if (!existsSync(opts.samplePath)) {
    throw new ImportSampleError(`No sample file at ${opts.samplePath}.`)
  }
  const sample = parseSampleText(readFileSync(opts.samplePath, 'utf8'))
  const draft = draftFromSample(sample)
  if (draft.task !== task) {
    throw new ImportSampleError(
      `The sample is from ${sample.callSite}, which the benchmark runs as the ${draft.task} task; --id says ${task}.`,
    )
  }

  const dir = join(opts.casesDir, task)
  for (const file of [`${slug}.json`, `${slug}${DRAFT_SUFFIX}`]) {
    if (existsSync(join(dir, file))) {
      throw new ImportSampleError(
        `${task}/${file} already exists. Pick another slug, or delete the file first.`,
      )
    }
  }

  const path = join(dir, `${slug}${DRAFT_SUFFIX}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(draft.draft, null, 2)}\n`)
  return { ...draft, path }
}

/** What the command prints after writing a draft. */
export function describeDraft(draft: Draft & { path: string }, shownPath: string): string[] {
  const slug = basename(draft.path, DRAFT_SUFFIX)
  const lines = [`Wrote ${shownPath}.`]
  if (draft.missingInput.length > 0) {
    lines.push('', 'Not in the sample, so left empty. Fill in by hand:')
    lines.push(...draft.missingInput.map((l) => `  - ${l}`))
  }
  if (draft.expectations.length > 0) {
    lines.push('', 'Write the expectation:')
    lines.push(...draft.expectations.map((l) => `  - ${l}`))
  }
  if (draft.notes.length > 0) {
    lines.push('', ...draft.notes)
  }
  lines.push(
    '',
    `To finish: rewrite the household's text as synthetic text with the same shape (a committed case never holds a real user's words), delete sampleInput and sampleOutput, and rename the file to ${slug}.json. Until then it is gitignored and never loaded. See scripts/model-bench/cases/README.md.`,
    `The draft and the sample file hold a production log line, which the privacy policy keeps for 1 day: delete the sample file now, and finish or delete the draft today.`,
  )
  return lines
}

function parseInput<T>(schema: z.ZodType<T>, input: unknown, callSite: string): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    throw new ImportSampleError(
      `The ${callSite} sample's input does not have the shape this command reads: ${formatIssues(parsed.error)}. Has the call site's logAiSample changed?`,
    )
  }
  return parsed.data
}

function formatIssues(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

/** Lowercase ASCII words joined by hyphens: "Küüslauk (hakitud)" → "kuuslauk-hakitud". */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
