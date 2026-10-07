/**
 * One entry per benchmarked AI call (HON-795): how to build its request, how to
 * score its output, which metrics the report shows, and the route budget its
 * latency is held against.
 *
 * Every request comes from the same pure builder production calls (HON-796),
 * so the benchmark sends exactly what the app sends apart from the model.
 * `generateObject` (`generateText` for the plain-text cook question) is called
 * with no `abortSignal`: a call that outlives its budget must still finish, so
 * its real duration is recorded.
 */

import {
  asSchema,
  generateObject,
  generateText,
  NoObjectGeneratedError,
  type FinishReason,
  type FlexibleSchema,
  type LanguageModel,
  type LanguageModelUsage,
} from 'ai'
import { buildMealPlanRequest } from '../../src/lib/ai/prompts'
import { buildRecipeRequest } from '../../src/lib/ai/recipe-prompt'
import { buildImagineRequest } from '../../src/lib/ai/imagine-request'
import { buildReviewRequest } from '../../src/lib/ai/review-request'
import {
  buildFullStepsRequest,
  buildSupplementaryStepsRequest,
} from '../../src/lib/ai/preparation-steps'
import { buildCookQuestionRequest } from '../../src/lib/ai/cook-question'
import {
  COOK_QUESTION_AI_BUDGET_MS,
  IMAGINE_AI_BUDGET_MS,
  PLAN_AI_BUDGET_MS,
  RECIPE_PARSE_AI_BUDGET_MS,
  REVIEW_AI_BUDGET_MS,
  STEPS_AI_BUDGET_MS,
} from '../../src/lib/ai/budgets'
import {
  COOK_QUESTION_MODEL,
  IMAGINE_MODEL,
  PLANNING_MODEL,
  RECIPE_MODEL,
  REVIEW_MODEL,
  STEPS_MODEL,
} from '../../src/lib/ai/models'
import type { BenchCase, CaseOf, Task } from './case-schema'
import {
  derivePlanContext,
  scoreCookQuestion,
  scoreImagine,
  scorePlan,
  scoreRecipe,
  scoreReview,
  scoreTips,
  COOK_QUESTION_MAX_SENTENCES,
  COOK_QUESTION_MAX_WORDS,
  type Scores,
} from './scorers'

export interface MetricDef {
  key: string
  label: string
  /** `percent` renders a 0–1 mean as a percentage and its delta in points. */
  format: 'percent' | 'number'
  /**
   * The value an errored call scores. `0` for pass/fail rates — an error is a
   * failure. `null` for counts and values, which an error must not skew.
   */
  onError: 0 | null
  /**
   * A drop larger than this (candidate minus baseline, in the metric's own
   * units) is a regression, unless the difference is within noise.
   */
  regressionDrop?: number
  /**
   * An allergen or dietary check, scored 0 or 1 per call. The report counts it
   * per call and says what failure rate a clean result still allows, because
   * "no failures in 24 calls" reads as "safe" and is not.
   */
  safety?: true
  /**
   * The absolute bar `--check` holds the metric's mean over all runs to
   * (HON-901): at least `min`, or at most `max`. A metric without one is shown
   * in the check report but never fails it.
   */
  gate?: { min: number } | { max: number }
}

/** What the runner needs from a case: the request, ready to send to any model. */
export interface PreparedCase {
  /** Every text part of the request, for the dry-run input estimate. */
  promptText: string
  /**
   * The output schema as the JSON Schema the AI SDK sends. Its `.describe()`
   * strings are model instructions too, so the golden's `requestHash` covers it.
   */
  schemaText: string
  generate(
    model: LanguageModel,
  ): Promise<{ object: unknown; usage: LanguageModelUsage; finishReason: FinishReason }>
  score(object: unknown): Scores
}

export interface TaskSpec<T extends Task> {
  /** The model the app calls for this task, from `src/lib/ai/models.ts`: what a bare `--check` runs. */
  productionModel: string
  /** The route's AI budget from `src/lib/ai/budgets.ts`. */
  budgetMs: number
  budgetLabel: string
  /**
   * Output tokens per call, reasoning included, for the dry-run cost estimate
   * only. A deliberate overestimate from the HON-693/HON-794 measurements; a
   * real run replaces it with measured usage.
   */
  dryRunOutputTokens: number
  metrics: MetricDef[]
  /**
   * Metrics this case has nothing to measure for — they score `null` even on
   * an error, so a failed call is not counted against a check the case never
   * set up.
   */
  inapplicableMetrics?(input: CaseOf<T>['input']): string[]
  prepare(c: CaseOf<T>): PreparedCase
}

function textOf(request: { system?: string; prompt?: string; messages?: unknown[] }): string {
  const parts: string[] = []
  if (request.system) parts.push(request.system)
  if (request.prompt) parts.push(request.prompt)
  for (const message of request.messages ?? []) {
    const content = (message as { content: unknown }).content
    if (typeof content === 'string') parts.push(content)
    else if (Array.isArray(content)) {
      for (const part of content as { type: string; text?: string }[]) {
        if (part.type === 'text' && part.text) parts.push(part.text)
      }
    }
  }
  return parts.join('\n')
}

/**
 * Not key-sorted: property order is part of what the model receives. Throws
 * rather than hash `{}` if the SDK ever builds the JSON Schema asynchronously.
 */
function schemaTextOf(schema: FlexibleSchema<unknown>): string {
  const json = asSchema(schema).jsonSchema
  if ('then' in json && typeof json.then === 'function') {
    throw new Error(
      'The AI SDK built this JSON Schema asynchronously; schemaTextOf cannot hash it.',
    )
  }
  return JSON.stringify(json)
}

/** The parts of a request that reach the model as instructions. */
function requestTexts(
  request: Parameters<typeof textOf>[0] & { schema: FlexibleSchema<unknown> },
): Pick<PreparedCase, 'promptText' | 'schemaText'> {
  return { promptText: textOf(request), schemaText: schemaTextOf(request.schema) }
}

const plan: TaskSpec<'plan'> = {
  productionModel: PLANNING_MODEL,
  budgetMs: PLAN_AI_BUDGET_MS,
  budgetLabel: 'PLAN_AI_BUDGET_MS',
  dryRunOutputTokens: 2_000,
  metrics: [
    {
      key: 'firstTryValid',
      label: 'First-try valid',
      format: 'percent',
      onError: 0,
      regressionDrop: 0.1,
      gate: { min: 1 },
    },
    {
      key: 'validAfterRepair',
      label: 'Valid after repair',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'structureValid',
      label: 'Structure valid',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'outOfPoolIds',
      label: 'Out-of-pool meal IDs',
      format: 'number',
      onError: null,
      gate: { max: 0 },
    },
    {
      key: 'dinnerProteinVariety',
      label: 'Distinct dinner proteins',
      format: 'number',
      onError: null,
    },
  ],
  prepare({ input }) {
    const ctx = derivePlanContext(input)
    const request = buildMealPlanRequest({
      startDate: ctx.startDate,
      endDate: ctx.endDate,
      slots: ctx.slots,
      requiredSlots: ctx.requiredSlots,
      candidatePools: ctx.candidatePools,
      candidatesByMealType: ctx.candidatesByMealType,
      restrictions: input.restrictions,
      pantryIngredients: input.pantryIngredients,
      locale: input.locale,
    })
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scorePlan(ctx, object as Parameters<typeof scorePlan>[1]),
    }
  },
}

const recipe: TaskSpec<'recipe'> = {
  productionModel: RECIPE_MODEL,
  budgetMs: RECIPE_PARSE_AI_BUDGET_MS,
  budgetLabel: 'RECIPE_PARSE_AI_BUDGET_MS (pasted text)',
  dryRunOutputTokens: 3_000,
  metrics: [
    {
      key: 'recall',
      label: 'Ingredient recall',
      format: 'percent',
      onError: 0,
      regressionDrop: 0.05,
      // HON-859 measured 98.8–99.4%.
      gate: { min: 0.95 },
    },
    {
      key: 'precision',
      label: 'Ingredient precision',
      format: 'percent',
      onError: 0,
      regressionDrop: 0.05,
      gate: { min: 0.95 },
    },
    {
      key: 'quantityUnitMatch',
      label: 'Quantity + unit exact',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'confidenceAgrees',
      label: 'Confidence tier agrees',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    { key: 'stepCountDelta', label: 'Step count delta', format: 'number', onError: null },
  ],
  inapplicableMetrics(input) {
    // A not-a-recipe case expects no ingredients (HON-840).
    return input.expected.ingredients.length === 0
      ? ['recall', 'precision', 'quantityUnitMatch']
      : []
  },
  prepare({ input }) {
    // Trimmed, as `parseRecipeText` does before it builds the request.
    const request = buildRecipeRequest(input.text.trim(), input.locale)
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreRecipe(input, object as Parameters<typeof scoreRecipe>[1]),
    }
  },
}

const imagine: TaskSpec<'imagine'> = {
  productionModel: IMAGINE_MODEL,
  budgetMs: IMAGINE_AI_BUDGET_MS,
  budgetLabel: 'IMAGINE_AI_BUDGET_MS',
  dryRunOutputTokens: 3_500,
  metrics: [
    {
      key: 'allChecksPass',
      label: 'All checks pass',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'exactlyThreeMeals',
      label: 'Exactly 3 meals',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'servingsMatch',
      label: 'Servings = household size',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'minTwoIngredients',
      label: '≥ 2 ingredients each',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'noForbiddenIngredients',
      label: 'No forbidden ingredient',
      format: 'percent',
      // A failed call served no food, so it is "not measured" here rather than
      // a violation: with the zero tolerance below, a candidate that errored on
      // one case every run would otherwise read as an allergen regression. The
      // failure still counts in "All checks pass" and the Errors row.
      onError: null,
      // Stricter than every other metric: this is the dietary and allergen
      // check, so a consistent drop means meat in a vegetarian meal, not a dip
      // in quality. 0 is the smallest value `compareMetric` supports (it
      // breaches on a drop past `regressionDrop`): any drop outside noise is a
      // regression, and a baseline at 100% on every run measures no range.
      regressionDrop: 0,
      safety: true,
      gate: { min: 1 },
    },
  ],
  prepare({ input }) {
    // No image cases in v1: committed base64 bloats the repo and needs visual judging.
    const request = buildImagineRequest({
      prompt: input.prompt,
      household: input.household,
      locale: input.locale,
    })
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreImagine(input, object as Parameters<typeof scoreImagine>[1]),
    }
  },
}

const review: TaskSpec<'review'> = {
  productionModel: REVIEW_MODEL,
  budgetMs: REVIEW_AI_BUDGET_MS,
  budgetLabel: 'REVIEW_AI_BUDGET_MS',
  dryRunOutputTokens: 1_500,
  metrics: [
    {
      key: 'allIdsOnce',
      label: 'Every ID exactly once',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'seededCorrected',
      label: 'Seeded errors corrected (±25%)',
      format: 'percent',
      onError: 0,
      // HON-859 measured 80%.
      gate: { min: 0.7 },
    },
    {
      key: 'unchangedKept',
      label: 'Correct quantities kept',
      format: 'percent',
      onError: 0,
      // HON-859 measured 91.7–93.6%.
      gate: { min: 0.85 },
    },
  ],
  inapplicableMetrics(input) {
    const expectations = Object.values(input.expected)
    return [
      ...(expectations.some((e) => !('unchanged' in e)) ? [] : ['seededCorrected']),
      ...(expectations.some((e) => 'unchanged' in e) ? [] : ['unchangedKept']),
    ]
  },
  prepare({ input }) {
    const request = buildReviewRequest({
      mealName: input.mealName,
      servings: input.servings,
      ingredients: input.ingredients,
      locale: input.locale,
    })
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreReview(input, object as Parameters<typeof scoreReview>[1]),
    }
  },
}

const tips: TaskSpec<'tips'> = {
  productionModel: STEPS_MODEL,
  budgetMs: STEPS_AI_BUDGET_MS,
  budgetLabel: 'STEPS_AI_BUDGET_MS',
  // Both ceilings in `preparation-steps.ts` (2000 full, 1200 supplementary)
  // are upper bounds; this sits between them.
  dryRunOutputTokens: 1_500,
  metrics: [
    {
      // Always 1 from the scorer and 0 on an errored call, so a tips error
      // still fails the check now that `countsInRange` tolerates misses.
      key: 'answered',
      label: 'Answered without error',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'countsInRange',
      label: 'Item counts in range',
      format: 'percent',
      onError: 0,
      // The counts are a soft "2-3 items" prompt instruction that production
      // does not enforce, so 100% failed a record on one 4-pitfall answer
      // (HON-929). Over 8 cases × 3 runs this allows 2 misses in 24.
      gate: { min: 0.9 },
    },
  ],
  prepare({ input }) {
    const base = {
      mealName: input.mealName,
      servings: input.servings,
      timeMinutes: input.timeMinutes,
      components: input.components,
      locale: input.locale,
    }
    const score = (object: unknown) => scoreTips(input, object as Parameters<typeof scoreTips>[1])

    if (input.kind === 'full') {
      const request = buildFullStepsRequest(base)
      return {
        ...requestTexts(request),
        generate: (model) => generateObject({ ...request, model }),
        score,
      }
    }
    const request = buildSupplementaryStepsRequest({
      ...base,
      preparationNotes: input.preparationNotes,
    })
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score,
    }
  },
}

const cookQuestion: TaskSpec<'cook-question'> = {
  productionModel: COOK_QUESTION_MODEL,
  budgetMs: COOK_QUESTION_AI_BUDGET_MS,
  budgetLabel: 'COOK_QUESTION_AI_BUDGET_MS',
  // The request's 1200-token ceiling, which thinking shares; English answers
  // measured about 200 with no thinking (HON-972).
  dryRunOutputTokens: 1_200,
  metrics: [
    {
      key: 'answered',
      label: 'Answered without error',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'metricUnits',
      label: 'Metric units only',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'withinLength',
      label: `≤ ${COOK_QUESTION_MAX_WORDS.answer} words`,
      format: 'percent',
      onError: null,
      // The length is a prompt instruction nothing enforces, as the tips
      // counts are (HON-929): one long answer must not fail the record.
      gate: { min: 0.9 },
    },
    {
      key: 'withinSentences',
      label: `≤ ${COOK_QUESTION_MAX_SENTENCES} sentences`,
      format: 'percent',
      onError: null,
      // As the word ceiling: a prompt instruction, so one fifth sentence must
      // not fail the record (HON-1003).
      gate: { min: 0.9 },
    },
    {
      key: 'offTopicDeclined',
      label: `Off-topic declined (≤ ${COOK_QUESTION_MAX_WORDS.offTopic} words)`,
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'avoidsForbidden',
      label: 'No forbidden suggestion',
      format: 'percent',
      // As imagine's forbidden-ingredient check: a failed call suggested
      // nothing, and `answered` already counts the failure.
      onError: null,
      regressionDrop: 0,
      safety: true,
      gate: { min: 1 },
    },
    {
      key: 'mentionsExpected',
      label: 'Names the expected answer',
      format: 'percent',
      onError: null,
      gate: { min: 0.9 },
    },
  ],
  prepare({ input }) {
    const request = buildCookQuestionRequest({
      mealName: input.mealName,
      servings: input.servings,
      timeMinutes: input.timeMinutes,
      components: input.components,
      preparationNotes: input.preparationNotes,
      steps: input.steps,
      equipment: input.equipment,
      subject: input.subject,
      pitfalls: input.pitfalls,
      tip: input.tip,
      pantry: input.pantry,
      restrictions: input.restrictions,
      question: input.question,
      previous: input.previous,
      locale: input.locale,
    })
    return {
      // Plain text: no output schema instructs the model.
      promptText: textOf(request),
      schemaText: '',
      async generate(model) {
        // `generateText` returns the text `streamText` streams in production;
        // timed around the call, the latency is the time to the last word,
        // which is what the route's budget bounds.
        const result = await generateText({ ...request, model })
        // Production ends the stream in an error on a cut-off answer, so the
        // cook sees half an instruction and Retry. Thrown as the error class
        // the runner reads usage from, so the billed call still counts.
        if (result.finishReason === 'length' || !result.text.trim()) {
          throw new NoObjectGeneratedError({
            message:
              result.finishReason === 'length'
                ? 'Cook question answer was cut off at maxOutputTokens'
                : 'Cook question returned no text',
            text: result.text,
            response: result.response,
            usage: result.usage,
            finishReason: result.finishReason,
          })
        }
        return { object: result.text, usage: result.usage, finishReason: result.finishReason }
      },
      score: (object) => scoreCookQuestion(input, object as string),
    }
  },
}

export const TASK_SPECS: { [T in Task]: TaskSpec<T> } = {
  plan,
  recipe,
  imagine,
  review,
  tips,
  'cook-question': cookQuestion,
}

export function prepareCase(c: BenchCase): PreparedCase {
  return (TASK_SPECS[c.task] as TaskSpec<typeof c.task>).prepare(c as never)
}

/**
 * The scores an errored call records: `onError` for every metric of its task,
 * except `null` for a metric the case has nothing to measure for.
 */
export function errorScores(c: BenchCase): Scores {
  const spec = TASK_SPECS[c.task] as TaskSpec<typeof c.task>
  const inapplicable = new Set(spec.inapplicableMetrics?.(c.input as never) ?? [])
  return Object.fromEntries(
    spec.metrics.map((m) => [m.key, inapplicable.has(m.key) ? null : m.onError]),
  )
}
