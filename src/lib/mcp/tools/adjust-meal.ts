import 'server-only'

import { z } from 'zod'

import { ADJUST_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { AiCostCapExceededError, assertUnderCap, capResetDate } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'
import { displayUnit } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { proposeAdjustment } from '@/lib/meal-planning/adjust-entry'
import { type AdjustProposal, type MatchedReplacement } from '@/lib/meal-planning/adjust-proposal'
import { ADJUST_INSTRUCTION_MAX_LENGTH } from '@/lib/meal-planning/components-schema'
import { loadEntryForAi } from '@/lib/meal-plans/entry-context'
import { checkRateLimit } from '@/lib/rate-limit'

import {
  acceptedOf,
  ingredientsOutput,
  loadChangeableEntry,
  mealIngredients,
  unitOutput,
  writeChanges,
} from './meal-changes'
import { slotInput } from './plan-slot'

export const adjustMeal = defineTool({
  name: 'adjust_meal',
  title: 'Change a planned meal’s ingredients',
  description:
    'Changes the ingredients of the meal planned for one day and meal type, from an instruction in plain words ("no cream, use yoghurt", "less spicy", "make it for a toddler"). When the user names the ingredients to replace, add or leave out, use change_meal_ingredients instead: it needs no AI. Wobblepot\'s AI turns the instruction into ingredient changes, the same way the app\'s Adjust recipe does, and applies them at once: the planner shows the meal with a Changed badge, the shopping list follows, and the steps are written again for the new ingredients. Only that one entry changes, never the recipe. A replacement Wobblepot cannot find in its ingredient list is not applied and is returned in unmatched; ask the user for another name and call again with an instruction that names it. An ingredient the meal does not have is returned in notInMeal, and a name that fits several of its ingredients in ambiguous; ask the user which one they meant. When part of an instruction could not be applied, the steps do not follow it until a later call applies it in full. A second call builds on the first. Only a planned meal can change: a cooked or skipped one is refused. Each call uses the household\'s AI allowance.',
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    instruction: z
      .string()
      .trim()
      .min(1)
      .max(ADJUST_INSTRUCTION_MAX_LENGTH)
      .describe("What to change, in the user's words."),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['adjusted', 'note_stored', 'unchanged'])
      .describe(
        'adjusted: the changes in applied were made. note_stored: no ingredient changed, but the steps will follow the instruction. unchanged: nothing was written.',
      ),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: z.object({ id: z.string(), name: z.string() }),
    applied: z.array(
      z.object({
        op: z.enum(['replace', 'remove', 'add']),
        original: z.string().nullable().describe('The ingredient changed; null for an add.'),
        replacement: z
          .string()
          .nullable()
          .describe('The ingredient brought in; null for a remove.'),
        quantityPerServing: z.number().nullable(),
        unit: unitOutput.nullable(),
        reason: z.string(),
      }),
    ),
    unmatched: z
      .array(z.object({ name: z.string(), original: z.string().nullable() }))
      .describe('Replacements not applied, because Wobblepot has no ingredient by that name.'),
    notInMeal: z
      .array(z.string())
      .describe('Ingredients the instruction named that this meal does not have.'),
    ambiguous: z
      .array(z.string())
      .describe(
        'Names that fit several of this meal’s ingredients, so nothing was changed for them.',
      ),
    ingredients: ingredientsOutput,
  }),
  run: async (household, { date, mealType, instruction }, caller) => {
    const locale = resolveHouseholdLocale(household)
    // Context, then the guards, in the adjust route's order: a refusal costs
    // no model call (HON-1244).
    const { slot, context } = await loadChangeableEntry(household, date, mealType, locale)

    const limit = await checkRateLimit(household.id, 'adjust-recipe')
    if (!limit.allowed) {
      throw new ToolInputError(
        `This household has asked for too many ingredient changes (at most ${limit.limit} an hour). Try again after ${limit.resetAt.toISOString()}. Nothing was changed.`,
      )
    }
    // Read with the user's id, as the route does, so PostHog records the call per user.
    if (!(await getServerFlag('ai_generation_enabled', caller.userId))) {
      throw new ToolInputError(
        'Changes by AI are turned off in Wobblepot for now. Try again later. Nothing was changed.',
      )
    }
    try {
      await assertUnderCap(household.id)
    } catch (error) {
      if (error instanceof AiCostCapExceededError) {
        throw new ToolInputError(
          `This household has used its AI allowance for this month. It resets on ${capResetDate(error)}. Nothing was changed.`,
        )
      }
      throw error
    }

    // A provider error or the budget's timeout is thrown on: `runTool`
    // reports it once and the client gets its plain sentence.
    const result = await proposeAdjustment({
      household,
      context,
      instruction,
      locale,
      abortSignal: AbortSignal.timeout(ADJUST_AI_BUDGET_MS),
    })

    // The app's review dialog lets the household pick an ingredient for an
    // unmatched name; here nobody can, so that proposal is left out and its
    // original stays.
    const accepted = result.changes.filter(
      (proposal) => proposal.op === 'remove' || proposal.replacement?.matched,
    )
    const unmatched = result.changes.flatMap((proposal) =>
      proposal.replacement && !proposal.replacement.matched
        ? [{ name: proposal.replacement.name, original: proposal.original?.name ?? null }]
        : [],
    )

    // The steps follow the stored instruction. When part of it was left
    // unapplied (a replacement unmatched) or dropped (an original missing or
    // ambiguous), they would follow a change the ingredients do not make, so
    // the instruction is stored only when all of it applied. The applied
    // changes still reach the steps through the changed ingredient list.
    const appliedAll =
      unmatched.length === 0 && result.notInMeal.length === 0 && result.ambiguous.length === 0
    const outcome: 'adjusted' | 'note_stored' | 'unchanged' =
      accepted.length > 0
        ? 'adjusted'
        : appliedAll && result.followInSteps
          ? 'note_stored'
          : 'unchanged'
    if (outcome !== 'unchanged') {
      // With nothing accepted, the stored set is written back unchanged with
      // the note, so the steps still follow it (`AdjustRecipe.storeNote`).
      await writeChanges(household.id, context, accepted.map(acceptedOf), {
        note: appliedAll ? instruction : null,
        tool: 'adjust_meal',
      })
    }

    const entry =
      outcome === 'unchanged'
        ? context
        : await loadEntryForAi(household.id, slot.planId, slot.id, locale)
    return {
      outcome,
      date,
      mealType,
      meal: { id: slot.mealId, name: slot.mealName ?? '' },
      applied: accepted.map(appliedOf),
      unmatched,
      notInMeal: result.notInMeal,
      ambiguous: result.ambiguous,
      ingredients: mealIngredients(entry, household, locale),
    }
  },
})

function appliedOf(proposal: AdjustProposal) {
  const replacement = proposal.replacement as MatchedReplacement | null
  return {
    op: proposal.op,
    original: proposal.original?.name ?? null,
    replacement: replacement?.ingredient.name ?? null,
    quantityPerServing: replacement?.quantityPerServing ?? null,
    unit: replacement ? displayUnit(replacement.ingredient) : null,
    reason: proposal.reason,
  }
}
