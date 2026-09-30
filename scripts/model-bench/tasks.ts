/**
 * One entry per benchmarked AI call (HON-795): how to build its request, how to
 * score its output, which metrics the report shows, and the route budget its
 * latency is held against.
 *
 * Every request comes from the same pure builder production calls (HON-796),
 * so the benchmark sends exactly what the app sends apart from the model.
 * `generateObject` is called with no `abortSignal`: a call that outlives its
 * budget must still finish, so its real duration is recorded.
 */

import { generateObject, type FinishReason, type LanguageModel, type LanguageModelUsage } from 'ai'
import { buildMealPlanRequest } from '../../src/lib/ai/prompts'
import { buildRecipeRequest } from '../../src/lib/ai/recipe-prompt'
import { buildImagineRequest } from '../../src/lib/ai/imagine-request'
import { buildReviewRequest } from '../../src/lib/ai/review-request'
import {
  buildFullTipsRequest,
  buildSupplementaryTipsRequest,
} from '../../src/lib/ai/preparation-tips'
import {
  IMAGINE_AI_BUDGET_MS,
  PLAN_AI_BUDGET_MS,
  RECIPE_PARSE_AI_BUDGET_MS,
  REVIEW_AI_BUDGET_MS,
  TIPS_AI_BUDGET_MS,
} from '../../src/lib/ai/budgets'
import type { BenchCase, CaseOf, Task } from './case-schema'
import {
  derivePlanContext,
  scoreImagine,
  scorePlan,
  scoreRecipe,
  scoreReview,
  scoreTips,
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
}

/** What the runner needs from a case: the request, ready to send to any model. */
export interface PreparedCase {
  /** Every text part of the request, for the dry-run input estimate. */
  promptText: string
  generate(
    model: LanguageModel,
  ): Promise<{ object: unknown; usage: LanguageModelUsage; finishReason: FinishReason }>
  score(object: unknown): Scores
}

export interface TaskSpec<T extends Task> {
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

const plan: TaskSpec<'plan'> = {
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
    },
    { key: 'validAfterRepair', label: 'Valid after repair', format: 'percent', onError: 0 },
    { key: 'structureValid', label: 'Structure valid', format: 'percent', onError: 0 },
    { key: 'outOfPoolIds', label: 'Out-of-pool meal IDs', format: 'number', onError: null },
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
      promptText: textOf(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scorePlan(ctx, object as Parameters<typeof scorePlan>[1]),
    }
  },
}

const recipe: TaskSpec<'recipe'> = {
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
    },
    {
      key: 'precision',
      label: 'Ingredient precision',
      format: 'percent',
      onError: 0,
      regressionDrop: 0.05,
    },
    { key: 'quantityUnitMatch', label: 'Quantity + unit exact', format: 'percent', onError: null },
    { key: 'confidenceAgrees', label: 'Confidence tier agrees', format: 'percent', onError: 0 },
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
      promptText: textOf(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreRecipe(input, object as Parameters<typeof scoreRecipe>[1]),
    }
  },
}

const imagine: TaskSpec<'imagine'> = {
  budgetMs: IMAGINE_AI_BUDGET_MS,
  budgetLabel: 'IMAGINE_AI_BUDGET_MS',
  dryRunOutputTokens: 3_500,
  metrics: [
    { key: 'allChecksPass', label: 'All checks pass', format: 'percent', onError: 0 },
    { key: 'exactlyThreeMeals', label: 'Exactly 3 meals', format: 'percent', onError: 0 },
    { key: 'servingsMatch', label: 'Servings = household size', format: 'percent', onError: 0 },
    { key: 'minTwoIngredients', label: '≥ 2 ingredients each', format: 'percent', onError: 0 },
    {
      key: 'noForbiddenIngredients',
      label: 'No forbidden ingredient',
      format: 'percent',
      onError: 0,
      // Stricter than every other metric: this is the dietary and allergen
      // check, so a consistent drop means meat in a vegetarian meal, not a dip
      // in quality. 0 is the smallest value `compareMetric` supports (it
      // breaches on `delta < -regressionDrop`): any drop outside noise is a
      // regression, and a baseline at 100% on every run measures no range.
      regressionDrop: 0,
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
      promptText: textOf(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreImagine(input, object as Parameters<typeof scoreImagine>[1]),
    }
  },
}

const review: TaskSpec<'review'> = {
  budgetMs: REVIEW_AI_BUDGET_MS,
  budgetLabel: 'REVIEW_AI_BUDGET_MS',
  dryRunOutputTokens: 1_500,
  metrics: [
    { key: 'allIdsOnce', label: 'Every ID exactly once', format: 'percent', onError: 0 },
    {
      key: 'seededCorrected',
      label: 'Seeded errors corrected (±25%)',
      format: 'percent',
      onError: 0,
    },
    { key: 'unchangedKept', label: 'Correct quantities kept', format: 'percent', onError: 0 },
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
      promptText: textOf(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreReview(input, object as Parameters<typeof scoreReview>[1]),
    }
  },
}

const tips: TaskSpec<'tips'> = {
  budgetMs: TIPS_AI_BUDGET_MS,
  budgetLabel: 'TIPS_AI_BUDGET_MS',
  // Both ceilings in `preparation-tips.ts` (2000 full, 1200 supplementary)
  // are upper bounds; this sits between them.
  dryRunOutputTokens: 1_500,
  metrics: [{ key: 'countsInRange', label: 'Item counts in range', format: 'percent', onError: 0 }],
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
      const request = buildFullTipsRequest(base)
      return {
        promptText: textOf(request),
        generate: (model) => generateObject({ ...request, model }),
        score,
      }
    }
    const request = buildSupplementaryTipsRequest({
      ...base,
      preparationNotes: input.preparationNotes,
    })
    return {
      promptText: textOf(request),
      generate: (model) => generateObject({ ...request, model }),
      score,
    }
  },
}

export const TASK_SPECS: { [T in Task]: TaskSpec<T> } = { plan, recipe, imagine, review, tips }

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
