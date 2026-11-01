import 'server-only'

import { getTranslations } from 'next-intl/server'

import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { displayUnit, formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { sameVaguePhrase } from '@/lib/i18n/vague-phrase'
import { loadCoverIds } from '@/lib/ingredient-form-cover-ids'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'
import {
  applyEntryChanges,
  ENTRY_CHANGES_FOR_DEDUCTION,
} from '@/lib/meal-planning/entry-components'
import { comparePantryItems } from '@/lib/meal-planning/pantry-order'
import { cookServingsSelect, getCookServings, sumPortions } from '@/lib/meal-planning/servings'
import { prisma } from '@/lib/prisma'
import { MIXED_VAGUE_PHRASE } from '@/lib/vague-quantities'

export interface PantryHousehold {
  id: string
  locale: string
  timezone: string
  members: readonly { preferences: { portionMultiplier: number } | null }[]
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
  const locale = resolveHouseholdLocale(household)
  const [pantryItems, tVague, tUnit] = await Promise.all([
    prisma.pantryItem.findMany({
      where: { householdId: household.id },
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            category: true,
            subcategory: true,
            defaultUnit: true,
            gramsPerPiece: true,
            measuredByVolume: true,
            ...ingredientTranslationsInclude(locale),
          },
        },
      },
      // No `orderBy`: the order is by the translated name, so it is applied
      // after translating, below (HON-920).
    }),
    getTranslations({ locale, namespace: 'enums.VaguePhrase' }),
    getTranslations({ locale, namespace: 'enums.Unit' }),
  ])
  const pieceLabel = tUnit('piece')

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
        // Own servings plus the leftover lunches it feeds (HON-1394).
        ...cookServingsSelect,
        // The entry's own ingredient changes (HON-1243), merged below as the
        // shopping list merges them, so the two panes agree.
        changes: ENTRY_CHANGES_FOR_DEDUCTION,
        meal: {
          select: {
            components: {
              select: {
                ingredientId: true,
                quantityPerServing: true,
                isVague: true,
                originalPhrase: true,
                ingredient: { select: { id: true } },
              },
            },
          },
        },
      },
    })

    // The members' portions ride along on the membership query (HON-596,
    // HON-1040). `sumPortions` is at least 1, and the requesting user's own
    // row is in this household anyway.
    const householdServings = sumPortions(household.members)

    // Aggregate quantities per ingredient, tracking vague status
    for (const entry of planEntries) {
      if (!entry.meal) continue
      // Same rule the shopping list and pantry deduction use, so the two
      // numbers /shopping renders side by side agree (HON-614).
      const effectiveServings = getCookServings(entry, householdServings)
      for (const component of applyEntryChanges(entry.meal.components, entry.changes)) {
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
              existing.originalPhrase !== MIXED_VAGUE_PHRASE &&
              !sameVaguePhrase(component.originalPhrase, existing.originalPhrase)
            ) {
              // Different vague phrase encountered - use "some" instead
              existing.originalPhrase = MIXED_VAGUE_PHRASE
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

  // A herb row shows the need for the row it covers when the pantry has no row
  // of its own for that need, because the shopping list counts it as cover: a
  // fresh or dried row shows the bare herb's need (HON-1558), a bare row the
  // fresh herb's (HON-1567). Only the first covering row (not run out) shows
  // it, so two jars do not double one need.
  const coverIds = await loadCoverIds()
  const pantryIngredientIds = new Set(pantryItems.map((item) => item.ingredientId))
  const captionedIds = new Set<string>()
  const coveredId = ({ ingredientId, quantity }: (typeof pantryItems)[number]) => {
    const id = quantity === 0 ? undefined : coverIds.get(ingredientId)
    if (id === undefined || pantryIngredientIds.has(id) || captionedIds.has(id)) {
      return undefined
    }
    captionedIds.add(id)
    return id
  }

  const items = pantryItems.map((item) => {
    // A row with a need of its own keeps it and leaves the cover caption free.
    const ownNeed = neededQuantities.get(item.ingredientId)
    const covered = ownNeed === undefined ? coveredId(item) : undefined
    const neededInfo =
      ownNeed ?? (covered === undefined ? undefined : neededQuantities.get(covered))
    const translatedIngredient = translateIngredient(item.ingredient, locale)
    return {
      id: item.id,
      ingredientId: item.ingredientId,
      ingredient: {
        id: translatedIngredient.id,
        name: translatedIngredient.name,
        category: translatedIngredient.category,
        subcategory: item.ingredient.subcategory,
        defaultUnit: translatedIngredient.defaultUnit,
        // `g`, `ml` or `piece`, the unit the pantry screen shows (HON-1151).
        displayUnit: displayUnit(item.ingredient),
      },
      quantity: item.quantity,
      isStaple: item.isStaple,
      updatedAt: item.updatedAt,
      ...(days && neededInfo !== undefined && neededInfo.quantity > 0
        ? {
            neededQuantity: neededInfo.quantity,
            // Locale-aware (shared with the shopping-list route) so `et`
            // households see comma decimals and their piece label: "1,5kg",
            // "2 tk".
            neededDisplayQuantity: formatShoppingQuantity(
              neededInfo.quantity,
              displayUnit(item.ingredient),
              locale,
              neededInfo.isVague,
              neededInfo.originalPhrase,
              tVague,
              pieceLabel,
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
  items.sort(comparePantryItems(locale))

  return { items, windowDays: days }
}
