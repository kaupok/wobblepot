/**
 * The "Adjust recipe" task (HON-1244): its scorer and its `TaskSpec`, apart
 * from `tasks.ts` and `scorers.ts` because both sit near the file-size cap.
 *
 * The request comes from the builder the route calls, and the scorer resolves
 * each original with `resolveChanges`, the function the route resolves it
 * with, so a change the route would drop scores as dropped here.
 */

import { generateObject } from 'ai'
import { buildAdjustRecipeRequest, type AdjustRecipeOutput } from '../../src/lib/ai/adjust-recipe'
import { normalizeFoodName } from '../../src/lib/ai/forbidden-foods'
import { ADJUST_AI_BUDGET_MS } from '../../src/lib/ai/budgets'
import { ADJUST_MODEL } from '../../src/lib/ai/models'
import { resolveChanges } from '../../src/lib/meal-planning/adjust-proposal'
import type { AdjustCase } from './case-schema'
import { requestTexts } from './request-texts'
import type { Scores } from './scorers'
import type { TaskSpec } from './tasks'

const pass = (ok: boolean) => (ok ? 1 : 0)

type Expected = NonNullable<AdjustCase['expected']['changes']>[number]
type Change = AdjustRecipeOutput['changes'][number]

function meets(change: Change, expected: Expected): boolean {
  if (change.op !== expected.op) return false
  if (expected.original) {
    const original = normalizeFoodName(change.original ?? '')
    if (!expected.original.some((name) => normalizeFoodName(name) === original)) return false
  }
  if (expected.replacementAny) {
    const replacement = normalizeFoodName(change.replacement ?? '')
    if (!expected.replacementAny.some((name) => replacement.includes(normalizeFoodName(name)))) {
      return false
    }
  }
  return true
}

export function scoreAdjust(input: AdjustCase, output: AdjustRecipeOutput): Scores {
  const { changes } = output
  const { expected } = input

  // The route's own resolution: a replace or remove whose original matches no
  // listed ingredient is dropped there, so it is a miss here.
  const components = input.components.map((c, i) => ({ ingredientId: `c${i}`, name: c.name }))
  const named = changes.filter((c) => c.op !== 'add')
  const resolved = resolveChanges(named, components, []).length
  const brought = changes.filter((c) => c.op !== 'remove')

  const replacements = brought.map((c) => normalizeFoodName(c.replacement ?? ''))
  const forbidden = (expected.forbiddenKeywords ?? []).map(normalizeFoodName)

  return {
    answered: 1,
    originalsResolve: named.length > 0 ? pass(resolved === named.length) : null,
    amountsGiven:
      brought.length > 0
        ? pass(brought.every((c) => (c.quantityPerServing ?? 0) > 0 && c.unit !== null))
        : null,
    expectedChanges: expected.changes
      ? pass(expected.changes.every((e) => changes.some((c) => meets(c, e))))
      : null,
    noChangeEmpty: expected.noChange ? pass(changes.length === 0) : null,
    stepsFlagged:
      expected.followInSteps === undefined
        ? null
        : pass(output.followInSteps === expected.followInSteps),
    avoidsForbidden: expected.forbiddenKeywords
      ? pass(replacements.every((name) => !forbidden.some((word) => name.includes(word))))
      : null,
  }
}

export const adjust: TaskSpec<'adjust'> = {
  productionModel: ADJUST_MODEL,
  budgetMs: ADJUST_AI_BUDGET_MS,
  budgetLabel: 'ADJUST_AI_BUDGET_MS',
  // The request's 1500-token ceiling, which thinking shares.
  dryRunOutputTokens: 1_500,
  metrics: [
    {
      key: 'answered',
      label: 'Answered without error',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'originalsResolve',
      label: 'Every original is a listed ingredient',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'amountsGiven',
      label: 'Every replacement has an amount and a unit',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'expectedChanges',
      label: 'Proposes the expected changes',
      format: 'percent',
      onError: null,
      // Which ingredient the model picks is a judgement, as the cook
      // question's expected answer is: one odd pick must not fail the record.
      gate: { min: 0.9 },
    },
    {
      key: 'noChangeEmpty',
      label: 'No change when none is needed',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'stepsFlagged',
      label: 'Flags an instruction only the steps can follow',
      format: 'percent',
      onError: null,
      // A judgement on wording ("less salt" with no salt listed), so one odd
      // call in a case's three runs must not fail the record.
      gate: { min: 0.8 },
    },
    {
      key: 'avoidsForbidden',
      label: 'No forbidden replacement',
      format: 'percent',
      onError: null,
      regressionDrop: 0,
      safety: true,
      gate: { min: 1 },
    },
  ],
  inapplicableMetrics(input) {
    return [
      ...(input.expected.changes ? [] : ['expectedChanges']),
      ...(input.expected.noChange ? [] : ['noChangeEmpty']),
      ...(input.expected.followInSteps === undefined ? ['stepsFlagged'] : []),
      ...(input.expected.forbiddenKeywords ? [] : ['avoidsForbidden']),
    ]
  },
  prepare({ input }) {
    const request = buildAdjustRecipeRequest({
      mealName: input.mealName,
      servings: input.servings,
      components: input.components,
      pantry: input.pantry,
      restrictions: input.restrictions,
      instruction: input.instruction,
      locale: input.locale,
    })
    return {
      ...requestTexts(request),
      generate: (model) => generateObject({ ...request, model }),
      score: (object) => scoreAdjust(input, object as AdjustRecipeOutput),
    }
  },
}
