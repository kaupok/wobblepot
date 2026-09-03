import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getHouseholdMembership } from '@/lib/household'
import { getStartOfTodayInTimezone } from '@/lib/meal-planning/dates'
import { getEffectiveServings } from '@/lib/meal-planning/servings'
import { ingredientTranslationsInclude, translateIngredient } from '@/lib/i18n/content'
import { formatShoppingQuantity } from '@/lib/i18n/format-shopping-quantity'
import type { Locale } from '@/lib/i18n/locales'
import { captureApiError } from '@/lib/errors'

const createPantryItemSchema = z.object({
  ingredientId: z.string().min(1),
  quantity: z.number().nullable().optional(),
  isStaple: z.boolean().optional().default(false),
})

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const membership = await getHouseholdMembership(session.user.id)

  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 404 })
  }

  const { household } = membership

  try {
    // Parse optional days param for needed quantity calculation
    const daysParam = request.nextUrl.searchParams.get('days')
    const days = daysParam === '7' || daysParam === '14' ? parseInt(daysParam, 10) : null

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

    // If days param is provided, compute needed quantities from meal plans
    // Track quantity and vague status per ingredient
    interface NeededInfo {
      quantity: number
      isVague: boolean
      originalPhrase: string | null
    }
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
                item.ingredient.gramsPerPiece,
                household.locale as Locale,
                neededInfo.isVague,
                neededInfo.originalPhrase,
              ),
              windowDays: days,
              isVague: neededInfo.isVague,
            }
          : {}),
      }
    })

    return NextResponse.json({ items, windowDays: days })
  } catch (error) {
    captureApiError(error, { route: '/api/pantry', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to fetch pantry items' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
    }

    const parsed = createPantryItemSchema.safeParse(body)

    if (!parsed.success) {
      const errors = parsed.error.flatten().fieldErrors
      return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
    }

    const membership = await getHouseholdMembership(session.user.id)

    if (!membership) {
      return NextResponse.json({ error: 'No household found' }, { status: 404 })
    }

    // Verify ingredient exists
    const ingredient = await prisma.ingredient.findUnique({
      where: { id: parsed.data.ingredientId },
      select: { id: true, name: true, category: true, defaultUnit: true },
    })

    if (!ingredient) {
      return NextResponse.json({ error: 'Ingredient not found' }, { status: 404 })
    }

    // Check if item already exists (unique constraint: householdId + ingredientId)
    const existing = await prisma.pantryItem.findUnique({
      where: {
        householdId_ingredientId: {
          householdId: membership.householdId,
          ingredientId: parsed.data.ingredientId,
        },
      },
    })

    if (existing) {
      return NextResponse.json(
        { error: 'Ingredient already in pantry', existingId: existing.id },
        { status: 409 },
      )
    }

    const pantryItem = await prisma.pantryItem.create({
      data: {
        householdId: membership.householdId,
        ingredientId: parsed.data.ingredientId,
        quantity: parsed.data.quantity ?? null,
        isStaple: parsed.data.isStaple,
      },
      include: {
        ingredient: {
          select: {
            id: true,
            name: true,
            category: true,
            defaultUnit: true,
          },
        },
      },
    })

    return NextResponse.json(
      {
        id: pantryItem.id,
        ingredientId: pantryItem.ingredientId,
        ingredient: pantryItem.ingredient,
        quantity: pantryItem.quantity,
        isStaple: pantryItem.isStaple,
        updatedAt: pantryItem.updatedAt,
      },
      { status: 201 },
    )
  } catch (error) {
    captureApiError(error, { route: '/api/pantry', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to add pantry item' }, { status: 500 })
  }
}
