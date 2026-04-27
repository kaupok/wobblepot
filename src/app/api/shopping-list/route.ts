import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeRollingWindowShoppingList } from '@/lib/meal-planning/shopping-list'
import { toDateString, parseLocalDate, getTodayInTimezone } from '@/lib/meal-planning/dates'
import { formatRelativeDate, formatAbsoluteDate } from '@/lib/i18n/format-dates'
import { getLocale } from '@/lib/i18n/get-locale'
import { Unit } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'

/**
 * Format quantity for display.
 * - Vague: show original phrase (e.g., "to taste")
 * - Pieces: convert grams to pieces using gramsPerPiece, round up for shopping
 * - Grams: show as "Xg" or "X.Xkg" for >= 1000g
 *
 * Note: Quantities are stored in grams for all ingredients.
 * When defaultUnit is 'piece', we convert using gramsPerPiece.
 */
function formatQuantity(
  qtyInGrams: number,
  unit: Unit,
  gramsPerPiece: number | null,
  isVague?: boolean,
  originalPhrase?: string | null,
): string {
  // For vague quantities, show the original phrase
  if (isVague && originalPhrase) {
    return originalPhrase
  }

  if (unit === 'piece') {
    // Convert grams to pieces, round up to ensure sufficient quantity for shopping
    if (gramsPerPiece && gramsPerPiece > 0) {
      const pieces = Math.ceil(qtyInGrams / gramsPerPiece)
      return String(pieces)
    }
    // Fallback: if no gramsPerPiece, show as grams
    return `${Math.round(qtyInGrams)}g`
  }
  // Grams
  if (qtyInGrams >= 1000) {
    const kg = qtyInGrams / 1000
    // Remove trailing .0 for whole kg values
    return kg % 1 === 0 ? `${Math.floor(kg)}kg` : `${kg.toFixed(1)}kg`
  }
  return `${Math.round(qtyInGrams)}g`
}

/**
 * GET /api/shopping-list
 *
 * Get shopping list for a rolling window of days from today.
 * Aggregates ingredients across all meal plans that fall within the window.
 *
 * Query params:
 * - days: 7 or 14 (default: 7)
 */
export async function GET(request: NextRequest) {
  // Auth check
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get household membership
  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  // Parse and validate days param
  const daysParam = request.nextUrl.searchParams.get('days')
  const days = daysParam ? parseInt(daysParam, 10) : 7

  if (days !== 7 && days !== 14) {
    return NextResponse.json({ error: 'Invalid days parameter. Must be 7 or 14.' }, { status: 400 })
  }

  try {
    // Compute rolling window shopping list and fetch custom items in parallel
    const [result, pantryItems, customItems] = await Promise.all([
      computeRollingWindowShoppingList(household.id, days, household.timezone, household.locale),
      prisma.pantryItem.findMany({
        where: { householdId: household.id },
        select: {
          ingredientId: true,
          updatedAt: true,
        },
      }),
      prisma.customShoppingItem.findMany({
        where: { householdId: household.id },
        include: {
          ingredient: {
            select: { id: true, name: true, category: true },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

    // Resolve locale + a date-namespace translator for the relative-date label.
    // The reference for "today" is the household's local day, not the server's,
    // so a household in Europe/Tallinn at 23:30 local sees the right label
    // even when the server clock is in a different timezone.
    const locale = await getLocale()
    const tDates = await getTranslations('dates')
    const todayInTz = parseLocalDate(getTodayInTimezone(household.timezone))

    // Transform to response format with display quantities and purchase status
    let totalItems = 0
    let purchasedItems = 0

    const groups = result.groups.map((group) => {
      // Map items with purchase status and needed-by date
      const mappedItems = group.items.map((item) => {
        const pantryItem = pantryMap.get(item.ingredientId)
        // Item is purchased if it exists in pantry and was updated after earliest plan was created
        // If no plans in window, nothing can be purchased
        const purchased =
          pantryItem && result.earliestPlanCreatedAt
            ? pantryItem.updatedAt >= result.earliestPlanCreatedAt
            : false

        totalItems++
        if (purchased) purchasedItems++

        return {
          ingredientId: item.ingredientId,
          name: item.ingredient.name,
          quantity: item.shoppingQuantity,
          unit: item.ingredient.defaultUnit,
          displayQuantity: formatQuantity(
            item.shoppingQuantity,
            item.ingredient.defaultUnit,
            item.ingredient.gramsPerPiece,
            item.isVague,
            item.originalPhrase,
          ),
          mealCount: item.mealCount,
          purchased,
          neededByDate: toDateString(item.earliestNeededDate),
          neededByRelative: formatRelativeDate(item.earliestNeededDate, locale, tDates, {
            referenceDate: todayInTz,
            timeZone: household.timezone,
          }),
          neededByAbsolute: formatAbsoluteDate(item.earliestNeededDate, locale, {
            timeZone: household.timezone,
          }),
          isVague: item.isVague,
        }
      })

      // Sort items: unpurchased by date ASC, then purchased at bottom
      mappedItems.sort((a, b) => {
        // Purchased items go to bottom
        if (a.purchased !== b.purchased) {
          return a.purchased ? 1 : -1
        }
        // Within same purchase status, sort by date (earliest first)
        return a.neededByDate.localeCompare(b.neededByDate)
      })

      return {
        category: group.category,
        categoryLabel: group.categoryLabel,
        items: mappedItems,
      }
    })

    // Format custom items for response
    const formattedCustomItems = customItems.map((item) => ({
      id: item.id,
      name: item.name,
      checked: item.checked,
      ingredientId: item.ingredientId,
      ingredientCategory: item.ingredient?.category ?? null,
      createdAt: item.createdAt.toISOString(),
    }))

    const response = {
      windowDays: days,
      startDate: result.startDate,
      endDate: result.endDate,
      generatedAt: result.earliestPlanCreatedAt?.toISOString() ?? null,
      groups,
      customItems: formattedCustomItems,
      summary: {
        totalItems,
        purchasedItems,
        remainingItems: totalItems - purchasedItems,
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    captureApiError(error, { route: '/api/shopping-list', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch shopping list' }, { status: 500 })
  }
}
