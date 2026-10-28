import 'server-only'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { suggestForSlot } from '@/lib/meal-planning/slot-suggestions'
import { findSwapMeal, swapEntryData, writeSwappedEntry } from '@/lib/meal-planning/swap-entry'
import { mealTranslationsInclude, translateMeal } from '@/lib/i18n/content'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { NO_REPEAT_DAYS } from '@/lib/meal-planning/candidates'
import { findLastPlannedDate } from '@/lib/meal-plans/last-planned'
import { defineTool, ToolInputError, WRITE_ANNOTATIONS } from '@/lib/mcp/context'
import { assertMealFitsSlot } from './meal-fit'
import { findPlanSlot, slotInput, writableDays } from './plan-slot'

const mealOutput = z.object({ id: z.string(), name: z.string() })

export const swapMeal = defineTool({
  name: 'swap_meal',
  title: 'Swap a planned meal',
  description: `Replaces the meal planned for one day and meal type. When the user names the meal, pass its mealId from list_meals, and this one call swaps it. Omit mealId only to get up to 3 suggestions, the same ones the app offers; they leave out meals planned from ${NO_REPEAT_DAYS} days ago onward, and each call can return different ones. The meal must suit the meal type and fit the household's diet, allergens and avoided ingredients. A meal planned recently is allowed; lastPlannedOn says when it was last planned, so you can mention the repeat. The swap puts the servings back on the household default and removes the entry's ingredient changes; set_meal_servings sets the servings again. On a past day the meal is logged as cooked, because the household ate it, and the pantry does not change. A meal already cooked cannot be swapped.`,
  annotations: { ...WRITE_ANNOTATIONS, idempotentHint: false },
  inputSchema: z.object({
    ...slotInput,
    mealId: z
      .string()
      .min(1)
      .optional()
      .describe(
        'The meal to plan instead, from list_meals or the suggestions. Omit it to get the suggestions.',
      ),
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
    lastPlannedOn: z.iso
      .date()
      .nullable()
      .describe(
        'For outcome swapped or unchanged: the latest earlier day meal was planned, or null if never. Always null for suggestions.',
      ),
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
        lastPlannedOn: null,
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
      return {
        outcome: 'unchanged' as const,
        date,
        mealType,
        meal: current,
        lastPlannedOn: await findLastPlannedDate(household.id, mealId, date),
        suggestions: [],
      }
    }

    // A meal the user chose takes the `plan_meal` check, not the suggestion
    // pool: the pool leaves out every meal planned from NO_REPEAT_DAYS ago
    // onward, and a household that cooks from a rotation repeats meals on
    // purpose (HON-1392). A past slot logs what the household ate (HON-1382).
    const isPast = date < writableDays(household.timezone).today
    await assertMealFitsSlot(household, mealId, mealType, isPast ? 'logged' : 'planned')
    const lastPlannedOn = await findLastPlannedDate(household.id, mealId, date)

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
    // the same write, with no pantry change, and saved as already charged so a
    // later planned → cooked never charges it (HON-1391).
    const swapped = await writeSwappedEntry(slot.id, {
      ...swapEntryData(slot.mealId, mealId),
      ...(isPast
        ? { status: 'completed' as const, pantryDeductedAt: new Date() }
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
      lastPlannedOn,
      suggestions: [],
    }
  },
})
