import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeShoppingList } from '@/lib/meal-planning/shopping-list'
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // Extract plan ID from params
  const { id } = await params

  try {
    // Fetch plan to verify existence and ownership
    const plan = await prisma.mealPlan.findUnique({
      where: { id },
      select: {
        id: true,
        householdId: true,
        createdAt: true,
      },
    })

    // Return 404 if plan not found
    if (!plan) {
      return NextResponse.json({ error: 'Meal plan not found' }, { status: 404 })
    }

    // Return 403 if plan belongs to different household
    if (plan.householdId !== household.id) {
      return NextResponse.json({ error: 'Access denied to this meal plan' }, { status: 403 })
    }

    // Compute shopping list using HON-64 logic
    // Pass timezone to filter out past meals (users don't need ingredients for missed meals)
    const groupedList = await computeShoppingList(
      plan.id,
      household.id,
      household.timezone,
      household.locale,
    )

    // Resolve locale + a date-namespace translator for the relative-date label.
    // The reference for "today" is the household's local day, not the server's,
    // so a household in Europe/Tallinn at 23:30 local sees the right label
    // even when the server clock is in a different timezone.
    const locale = await getLocale()
    const tDates = await getTranslations('dates')
    const todayInTz = parseLocalDate(getTodayInTimezone(household.timezone))

    // Fetch pantry items for purchase tracking
    const pantryItems = await prisma.pantryItem.findMany({
      where: { householdId: household.id },
      select: {
        ingredientId: true,
        updatedAt: true,
      },
    })
    const pantryMap = new Map(pantryItems.map((p) => [p.ingredientId, p]))

    // Transform to response format with display quantities and purchase status
    let totalItems = 0
    let purchasedItems = 0

    const groups = groupedList.map((group) => {
      // Map items with purchase status and needed-by date
      const mappedItems = group.items.map((item) => {
        const pantryItem = pantryMap.get(item.ingredientId)
        // Item is purchased if it exists in pantry and was updated after plan was created
        const purchased = pantryItem ? pantryItem.updatedAt >= plan.createdAt : false

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

    const response = {
      planId: plan.id,
      generatedAt: plan.createdAt.toISOString(),
      groups,
      summary: {
        totalItems,
        purchasedItems,
        remainingItems: totalItems - purchasedItems,
      },
    }

    return NextResponse.json(response, { status: 200 })
  } catch (error) {
    captureApiError(error, { route: '/api/meal-plans/[id]/shopping-list', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch shopping list' }, { status: 500 })
  }
}
