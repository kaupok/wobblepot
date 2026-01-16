import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { computeShoppingList } from '@/lib/meal-planning/shopping-list'
import { toDateString, formatRelativeDate, formatAbsoluteDate } from '@/lib/meal-planning/dates'
import { Unit } from '@/generated/prisma/enums'

/**
 * Format quantity for display.
 * - Pieces: convert grams to pieces using gramsPerPiece, round up for shopping
 * - Grams: show as "Xg" or "X.Xkg" for >= 1000g
 *
 * Note: Quantities are stored in grams for all ingredients.
 * When defaultUnit is 'piece', we convert using gramsPerPiece.
 */
function formatQuantity(qtyInGrams: number, unit: Unit, gramsPerPiece: number | null): string {
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
        startDate: true,
        endDate: true,
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
    const groupedList = await computeShoppingList(plan.id, household.id)

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
          ),
          mealCount: item.mealCount,
          purchased,
          neededByDate: toDateString(item.earliestNeededDate),
          neededByRelative: formatRelativeDate(item.earliestNeededDate),
          neededByAbsolute: formatAbsoluteDate(item.earliestNeededDate),
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
      planStartDate: toDateString(plan.startDate),
      planEndDate: toDateString(plan.endDate),
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
    console.error('Failed to fetch shopping list:', error)
    return NextResponse.json({ error: 'Failed to fetch shopping list' }, { status: 500 })
  }
}
