import 'server-only'
import { z } from 'zod'
import { Allergen, DietaryType, MealType } from '@/generated/prisma/enums'
import { matchExcludedIngredients } from '@/lib/household/excluded-ingredients'
import { listMembersForAssistant } from '@/lib/household/members'
import { sumPortions } from '@/lib/meal-planning/servings'
import { defineTool } from '@/lib/mcp/context'

export const SERVINGS_RULE =
  "The sum of the members' portion sizes, rounded to the nearest 0.5, at least 1. A planned entry's own servings, when set, win."

export const NO_MATCH_NOTE = 'Matches no ingredient, so it excludes no meal.'

/** What each rule controls, so the assistant can explain a refusal or a missing meal. */
export const RULES = {
  filters:
    'allergensToAvoid and ingredientsToAvoid filter list_meals, plan_meal, swap_meal and plan generation; dietaryType filters plan_meal, swap_meal and plan generation but not list_meals, so check a listed meal against the diet yourself. A meal that breaks a filter is left out or refused.',
  notesForAi:
    'restrictions ("Notes for the AI" on the settings page) goes to the AI prompt in four features: plan generation, Imagine, Adjust recipe (adjust_meal) and the cook question. list_meals, plan_meal and swap_meal ignore it, so check these notes yourself before you plan or suggest a meal.',
}

/**
 * The household's setup, for an assistant that sees its effects (meals left
 * out, a refused plan_meal, a servings count) and needs the cause (HON-1323).
 * Meal-planning facts only: no email, reminder, invite, token or AI cost cap,
 * because they plan nothing and some are secrets.
 */
export const getHousehold = defineTool({
  name: 'get_household',
  title: 'Get household',
  description:
    "Returns the household's setup: the meals it plans each day, its diet, allergens and ingredients to avoid (each with the ingredients it excludes), its notes for the AI, its members with their portion sizes, and the default servings. Use it before you plan several days, before you suggest a meal for a particular person, and when plan_meal refused a meal or a meal is missing from list_meals, to find out why.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    household: z.object({
      name: z.string(),
      timezone: z.string(),
      weekdayMealTypes: z.array(z.enum(MealType)),
      weekendMealTypes: z.array(z.enum(MealType)),
      dietaryType: z.enum(DietaryType).nullable(),
      allergensToAvoid: z.array(z.enum(Allergen)),
      restrictions: z.array(z.string()),
      ingredientsToAvoid: z.array(
        z.object({
          name: z.string(),
          excludes: z.array(z.string()),
          note: z.string().nullable(),
        }),
      ),
    }),
    members: z.array(
      z.object({
        name: z.string().nullable(),
        linked: z.boolean(),
        portionMultiplier: z.number(),
      }),
    ),
    servings: z.object({ default: z.number(), rule: z.string() }),
    rules: z.object({ filters: z.string(), notesForAi: z.string() }),
  }),
  run: async (household) => {
    const preferences = household.preferences
    const [members, matches] = await Promise.all([
      listMembersForAssistant(household.id),
      matchExcludedIngredients(household.id, preferences?.excludedIngredients ?? []),
    ])
    return {
      household: {
        name: household.name,
        timezone: household.timezone,
        // The column defaults, for a household that never saved its preferences.
        weekdayMealTypes: preferences?.weekdayMealTypes ?? ['dinner'],
        weekendMealTypes: preferences?.weekendMealTypes ?? ['dinner'],
        dietaryType: preferences?.dietaryType ?? null,
        allergensToAvoid: preferences?.allergensToAvoid ?? [],
        restrictions: preferences?.restrictions ?? [],
        ingredientsToAvoid: matches.map((match) => ({
          name: match.tag,
          excludes: match.ingredients.map((ingredient) => ingredient.name),
          note: match.ingredients.length === 0 ? NO_MATCH_NOTE : null,
        })),
      },
      members,
      servings: {
        // From the members listed above, so the two cannot disagree.
        default: sumPortions(
          members.map((member) => ({
            preferences: { portionMultiplier: member.portionMultiplier },
          })),
        ),
        rule: SERVINGS_RULE,
      },
      rules: RULES,
    }
  },
})
