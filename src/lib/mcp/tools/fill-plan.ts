import 'server-only'

import { z } from 'zod'

import { PLAN_AI_BUDGET_MS } from '@/lib/ai/budgets'
import { InsufficientCandidatesError, NoEmptySlotsError } from '@/lib/ai/types'
import { AiCostCapExceededError, assertUnderCap, capResetDate } from '@/lib/ai/usage'
import { getServerFlag } from '@/lib/feature-flags'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { parseLocalDate, toDateString } from '@/lib/meal-planning/dates'
import { fillHouseholdEmptySlots, MAX_PLAN_DAYS } from '@/lib/meal-plans/fill-empty'
import { findOrCreateMealPlan } from '@/lib/meal-plans/plans'
import { prisma } from '@/lib/prisma'
import { checkRateLimit } from '@/lib/rate-limit'

import { MAX_DAYS_AHEAD, writableDays } from './plan-slot'

export const fillPlan = defineTool({
  name: 'fill_plan',
  title: 'Fill the empty days of the meal plan',
  description: `Plans meals for every empty slot in a range of days, the way the app's Fill empty days does: Wobblepot's planner picks from the household's recipes, fits its diet, allergens and avoided ingredients, plans the fish and legume dinners the household needs, and does not plan one dinner twice. Use it to plan several days at once, then swap_meal or plan_meal for single changes. It never changes a slot that has a meal, a fridge meal, or was cooked or skipped; a slot with only a note gets a meal and keeps the note. On today, a meal that is over is left empty. The range starts today or later and ends at most ${MAX_DAYS_AHEAD} days ahead. The meal types per day are the household's. Each call uses the household's AI allowance.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    startDate: z.iso.date().describe('The first day to fill, YYYY-MM-DD.'),
    days: z
      .number()
      .int()
      .min(1)
      .max(MAX_PLAN_DAYS)
      .describe(`How many days to fill from startDate, 1 to ${MAX_PLAN_DAYS}.`),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['filled', 'unchanged'])
      .describe('filled: the meals in entries were planned. unchanged: no slot was empty.'),
    entries: z
      .array(
        z.object({
          date: z.iso.date(),
          mealType: z.enum(['breakfast', 'lunch', 'dinner']),
          entryId: z.string(),
          meal: z.object({ id: z.string(), name: z.string() }),
        }),
      )
      .describe('The entries this call planned. Every other entry is as it was.'),
  }),
  run: async (household, { startDate, days }, caller) => {
    const { today, lastDay } = writableDays(household.timezone)
    if (startDate < today) {
      throw new ToolInputError(
        `${startDate} is in the past. Start on ${today} or later. Nothing was changed.`,
      )
    }
    const start = parseLocalDate(startDate)
    const end = new Date(start)
    end.setDate(end.getDate() + days)
    const last = new Date(end)
    last.setDate(last.getDate() - 1)
    if (toDateString(last) > lastDay) {
      throw new ToolInputError(
        `The range ends on ${toDateString(last)}, more than ${MAX_DAYS_AHEAD} days ahead. End it on ${lastDay} or earlier. Nothing was changed.`,
      )
    }

    // The guards in the generate route's order: a refusal costs no model call.
    const limit = await checkRateLimit(household.id, 'plan-generation')
    if (!limit.allowed) {
      throw new ToolInputError(
        `This household has planned with AI too often (at most ${limit.limit} times an hour). Try again after ${limit.resetAt.toISOString()}. Nothing was changed.`,
      )
    }
    // Read with the user's id, as the route does, so PostHog records the call per user.
    if (!(await getServerFlag('ai_generation_enabled', caller.userId))) {
      throw new ToolInputError(
        'Planning with AI is turned off in Wobblepot for now. Try again later. Nothing was changed.',
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

    const locale = resolveHouseholdLocale(household)
    const planId = await findOrCreateMealPlan(household.id)
    let result
    try {
      result = await fillHouseholdEmptySlots(household, {
        planId,
        startDate: start,
        endDate: end,
        locale,
        aiBudgetMs: PLAN_AI_BUDGET_MS,
      })
    } catch (error) {
      // Thrown before the model call, so nothing was written.
      if (error instanceof NoEmptySlotsError) return { outcome: 'unchanged' as const, entries: [] }
      if (error instanceof InsufficientCandidatesError) {
        throw new ToolInputError(
          `${error.message}, so the required dinners cannot be planned. Add or favourite such a recipe, or change the household's diet, then try again. Nothing was changed.`,
        )
      }
      // A provider error or the budget's timeout is thrown on: `runTool`
      // reports it once and the client gets its plain sentence, which says to
      // try again.
      throw error
    }

    const filledIds = new Set(result.filledEntryIds)
    const filled = result.entries.flatMap((entry) =>
      filledIds.has(entry.id) && entry.meal ? [{ ...entry, meal: entry.meal }] : [],
    )
    const named = await prisma.meal.findMany({
      where: { id: { in: filled.map((entry) => entry.meal.id) } },
      select: { id: true, name: true, ...mealTranslationsInclude(locale) },
    })
    const names = new Map(named.map((meal) => [meal.id, translateMeal(meal, locale).name]))

    return {
      outcome: 'filled' as const,
      entries: filled.map((entry) => ({
        date: entry.date,
        mealType: entry.mealType,
        entryId: entry.id,
        meal: { id: entry.meal.id, name: names.get(entry.meal.id) ?? entry.meal.name },
      })),
    }
  },
})
