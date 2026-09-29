import 'server-only'
import { prisma } from '@/lib/prisma'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'
import { getEffectiveServings } from '@/lib/meal-planning/servings'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'

export interface PantryHousehold {
  id: string
  locale: string
  timezone: string
  _count: { members: number }
}

export type PantryResult = Awaited<ReturnType<typeof loadPantry>>

interface NeededInfo {
  quantity: number
  isVague: boolean
  originalPhrase: string | null
}

/**
 * The household's pantry in the shape `GET /api/pantry` returns. The route,
 * `/shopping`, `/pantry` and the Today page all read through this (HON-789).
 *
 * With `days` set, each item the plan needs in the next `days` days also carries
 * the needed quantity for that window; `null` skips the plan read entirely.
 */
export async function loadPantry(household: PantryHousehold, { days }: { days: 7 | 14 | null }) {
  const pantryItems = await prisma.pantryItem.findMany({
    where: { householdId: household.id },
    include: {
      ingredient: {
        select: {
          id: true,
          name: true,
          category: true,
          defaultUnit: true,
          gramsPerPiece: true,
          ...ingredientTranslationsInclude(household.locale),
        },
      },
    },
    orderBy: [{ isStaple: 'desc' }, { ingredient: { name: 'asc' } }],
  })

  // If days is provided, compute needed quantities from meal plans
  // Track quantity and vague status per ingredient
  const neededQuantities: Map<string, NeededInfo> = new Map()

  if (days) {
    const startOfToday = getStartOfTodayInTimezone(household.timezone)
    const endDate = new Date(startOfToday)
    endDate.setDate(endDate.getDate() + days)

    // Get all planned meal entries in the window
    const planEntries = await prisma.mealPlanEntry.findMany({
      where: {
        plan: {
          householdId: household.id,
        },
        status: 'planned',
        date: {
          gte: startOfToday,
          lt: endDate,
        },
      },
      // Explicit `select`: the aggregation below reads exactly these fields,
      // and an `include` would drag every entry scalar (`preparationTips`,
      // `note`) and every `Meal` scalar (`description`, `preparationNotes`,
      // `sourceUrl`, …) across the wire for every entry in the window.
      select: {
        servingOverride: true,
        meal: {
          select: {
            components: {
              select: {
                ingredientId: true,
                quantityPerServing: true,
                isVague: true,
                originalPhrase: true,
              },
            },
          },
        },
      },
    })

    // Rides along on the membership query's `_count` (HON-596). The old
    // `memberCount > 0 ? memberCount : 2` fallback is dropped with it: the
    // requesting user's own row is in this household, so the count is >= 1.
    const householdSize = household._count.members

    // Aggregate quantities per ingredient, tracking vague status
    for (const entry of planEntries) {
      if (!entry.meal) continue
      // Same rule the shopping list and pantry deduction use, so the two
      // numbers /shopping renders side by side agree (HON-614).
      const effectiveServings = getEffectiveServings(entry, householdSize)
      for (const component of entry.meal.components) {
        const qty = component.quantityPerServing * effectiveServings
        const existing = neededQuantities.get(component.ingredientId)

        if (existing) {
          existing.quantity += qty
          // If any component is vague, mark the whole item as vague
          if (component.isVague) {
            if (!existing.isVague) {
              // First vague component encountered
              existing.isVague = true
              existing.originalPhrase = component.originalPhrase
            } else if (
              existing.originalPhrase !== 'some' &&
              component.originalPhrase?.toLowerCase() !== existing.originalPhrase?.toLowerCase()
            ) {
              // Different vague phrase encountered - use "some" instead
              existing.originalPhrase = 'some'
            }
          }
        } else {
          neededQuantities.set(component.ingredientId, {
            quantity: qty,
            isVague: component.isVague,
            originalPhrase: component.originalPhrase,
          })
        }
      }
    }
  }

  const items = pantryItems.map((item) => {
    const neededInfo = neededQuantities.get(item.ingredientId)
    const translatedIngredient = translateIngredient(item.ingredient, household.locale)
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredient: {
        id: translatedIngredient.id,
        name: translatedIngredient.name,
        category: translatedIngredient.category,
        defaultUnit: translatedIngredient.defaultUnit,
      },
      quantity: item.quantity,
      isStaple: item.isStaple,
      updatedAt: item.updatedAt,
      ...(days && neededInfo !== undefined && neededInfo.quantity > 0
        ? {
            neededQuantity: neededInfo.quantity,
            // Locale-aware (shared with the shopping-list route) so `et`
            // households see comma decimals: "1,5kg" instead of "1.5kg".
            neededDisplayQuantity: formatShoppingQuantity(
              neededInfo.quantity,
              item.ingredient.defaultUnit,
              household.locale as Locale,
              neededInfo.isVague,
              neededInfo.originalPhrase,
            ),
            windowDays: days,
            // The formatter swaps in the phrase only when there is one, so a
            // vague component stored without a phrase still shows its amount
            // — and the row must keep it (HON-783).
            isVague: neededInfo.isVague && !!neededInfo.originalPhrase,
          }
        : {}),
    }
  })

  return { items, windowDays: days }
}
