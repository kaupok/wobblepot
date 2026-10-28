import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { loadSlotCandidates, suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { findSwapMeal, swapEntryData, writeSwappedEntry } from '@/lib/meal-planning/swap-entry'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { NO_REPEAT_DAYS } from '@/lib/meal-planning/candidates'
import { isMealAllowedForSlot } from '@/lib/meal-planning/meal-allowed-for-slot'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS, type McpHousehold } from '@/lib/mcp/context'
import { findPlanSlot, slotInput, writableDays, type SlotMealType } from './plan-slot'

const mealOutput = z.object({ id: z.string(), name: z.string() })

export const swapMeal = defineTool({
  name: 'swap_meal',
  title: 'Swap a planned meal',
  description: `Replaces the meal planned for one day and meal type. Call it first without mealId: it returns up to 3 suggestions that fit the household's diet, allergens and avoided ingredients, the same ones the app offers. Then call it again with the mealId the user chose. A mealId from list_meals is accepted too when it suits the meal type, fits the household, and is not planned anywhere from ${NO_REPEAT_DAYS} days ago onward; any other meal is refused. On a past day the meal is logged as cooked, because the household ate it, and the pantry does not change; there a mealId from list_meals needs only to suit the meal type and fit the household, so a repeat is allowed. A meal already cooked cannot be swapped. Each call can return different suggestions.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    mealId: z
      .string()
      .min(1)
      .optional()
      .describe('The meal to plan instead, from the suggestions. Omit it to get the suggestions.'),
  }),
  outputSchema: z.object({
    outcome: z
      .enum(['suggestions', 'swapped', 'unchanged'])
      .describe(
        'suggestions: nothing changed, pick from suggestions. swapped: the slot now has meal. unchanged: meal was already planned there.',
      ),
    date: z.iso.date(),
    mealType: z.enum(['breakfast', 'lunch', 'dinner']),
    meal: mealOutput.nullable().describe('The meal planned for the slot after this call.'),
    suggestions: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          timeMinutes: z.number().nullable(),
          kidFriendly: z.boolean(),
          isOwnRecipe: z.boolean(),
          householdRating: z
            .enum(['liked', 'disliked'])
            .nullable()
            .describe("Set when the household's own thumbs moved this meal up or down."),
        }),
      )
      .describe('Only for outcome suggestions; empty when no meal fits the slot.'),
  }),
  run: async (household, { date, mealType, mealId }) => {
    const locale = resolveHouseholdLocale(household)
    const slot = await findPlanSlot(household, date, mealType)
    const current = slot.mealId ? { id: slot.mealId, name: slot.mealName! } : null

    // A completed entry records what was cooked and what the pantry was
    // charged for, so it is never repointed (HON-633).
    if (slot.status === 'completed') {
      throw new ToolInputError(
        `The ${mealType} on ${date} was already cooked, so it cannot be swapped. Nothing was changed.`,
      )
    }

    // The app's choice of list: `/regenerate` for an entry with a meal,
    // `/suggestions` for an empty one (`use-meal-alternatives.ts`).
    const mode = slot.mealId ? 'swap' : 'add'

    if (!mealId) {
      const suggestions = await suggestForSlot(household, slot, mode, locale)
      return {
        outcome: 'suggestions' as const,
        date,
        mealType,
        meal: current,
        suggestions: suggestions.map((meal) => ({
          id: meal.id,
          name: meal.name,
          description: meal.description ?? null,
          timeMinutes: meal.timeMinutes,
          kidFriendly: meal.kidFriendly,
          isOwnRecipe: meal.isCustom ?? false,
          householdRating: meal.ratingSignal ?? null,
        })),
      }
    }

    // A re-select is a no-op, as in the app (HON-703).
    if (mealId === slot.mealId) {
      return { outcome: 'unchanged' as const, date, mealType, meal: current, suggestions: [] }
    }

    // A past slot logs what the household ate (HON-1382), so it takes the
    // `plan_meal` check: the pool's no-repeat rule would refuse "we ate the
    // trout again".
    const isPast = date < writableDays(household.timezone).today
    if (isPast) {
      await assertMealFitsPastSlot(household, mealId, mealType)
    } else {
      // The suggestions are the top of this pool, which carries the diet,
      // allergen and avoided-ingredient filters. Checked against the pool, not
      // the top 3: the top 3 has a fresh random tie-break on every request
      // (HON-709), so it would refuse a meal this tool had just offered.
      const pool = await loadSlotCandidates(household, slot, mode)
      if (!pool.some((candidate) => candidate.id === mealId)) {
        throw new ToolInputError(
          `Wobblepot would not suggest this meal for ${mealType} on ${date}: it does not fit the household's diet, allergens or avoided ingredients, is not a ${mealType}, or is planned already. Call swap_meal without mealId for the suggestions. Nothing was changed.`,
        )
      }
    }

    // The app's swap, from here on: visibility, the resets, and the write
    // that refuses an entry completed in the meantime.
    const meal = await findSwapMeal(household.id, mealId)
    if (!meal) {
      throw new ToolInputError(
        'This meal was deleted while this ran. Call swap_meal without mealId for the suggestions. Nothing was changed.',
      )
    }
    // A skipped slot gets its new meal planned: the skip was for the meal that
    // left. The app does the same from the card (`MealCard.handleSwapComplete`,
    // HON-1125); here it is part of the one write. A past slot is completed in
    // the same write, with no pantry change.
    const swapped = await writeSwappedEntry(slot.id, {
      ...swapEntryData(slot.mealId, mealId),
      ...(isPast
        ? { status: 'completed' as const }
        : slot.status === 'skipped'
          ? { status: 'planned' as const }
          : {}),
    })
    if (!swapped) {
      throw new ToolInputError(
        `The ${mealType} on ${date} was cooked while this ran, so it cannot be swapped. Nothing was changed.`,
      )
    }

    const named = await prisma.meal.findUniqueOrThrow({
      where: { id: mealId },
      select: { name: true, ...mealTranslationsInclude(locale) },
    })
    return {
      outcome: 'swapped' as const,
      date,
      mealType,
      meal: { id: mealId, name: translateMeal(named, locale).name },
      suggestions: [],
    }
  },
})

/** `plan_meal`'s check, for a meal logged in a past slot. */
async function assertMealFitsPastSlot(
  household: McpHousehold,
  mealId: string,
  mealType: SlotMealType,
) {
  const fit = await isMealAllowedForSlot(household, mealId, mealType)
  if (fit === 'notFound') {
    throw new ToolInputError(
      'No meal with this id. Use list_meals to find the meal. Nothing was changed.',
    )
  }
  if (fit === 'unsuitable') {
    throw new ToolInputError(
      `This meal is not a ${mealType}, so it cannot be logged for ${mealType}. Nothing was changed.`,
    )
  }
  if (fit === 'ruledOut') {
    throw new ToolInputError(
      "This meal does not fit the household's diet, allergens or avoided ingredients. Nothing was changed.",
    )
  }
}
