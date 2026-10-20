import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { Allergen, IngredientCategory, ProteinType, Unit } from '@/generated/prisma/enums'
import { captureApiError } from '@/lib/errors'
import { getHouseholdMembership } from '@/lib/household'
import { resolveHouseholdLocale } from '@/lib/i18n/resolve-locale'
import { searchIngredients } from '@/lib/ingredients/search'
import { createHouseholdIngredient } from '@/lib/ingredients/create'
import {
  GRAMS_PER_PIECE_MAX,
  isProteinTypedCategory,
  NEW_INGREDIENT_NAME_MAX,
  NUTRITION_MAX,
  PROTEIN_TYPES_BY_CATEGORY,
} from '@/lib/ingredients/new-ingredient'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

const DEFAULT_LIMIT = 10
const MAX_LIMIT = 50

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const searchParams = request.nextUrl.searchParams
  const search = searchParams.get('search')?.trim() || ''
  const category = searchParams.get('category') as IngredientCategory | null
  const limit = Math.min(
    Math.max(1, parseInt(searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  // Empty search returns empty array (not all ingredients)
  if (!search) {
    return NextResponse.json({ ingredients: [] })
  }

  try {
    // A user with no household still searches, the global ingredients only.
    const membership = await getHouseholdMembership(session.user.id)

    const ingredients = await searchIngredients({
      search,
      category,
      limit,
      householdId: membership?.householdId ?? null,
      // Match and return the name the household sees on screen, not only the
      // English one (HON-911). The household's locale, never Accept-Language.
      locale: resolveHouseholdLocale(membership?.household),
    })

    return NextResponse.json({ ingredients })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to search ingredients' }, { status: 500 })
  }
}

/** Per 100 g, from 0 to the bound in `NUTRITION_MAX`. */
const per100g = (max: number) => z.number().finite().min(0).max(max)

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(NEW_INGREDIENT_NAME_MAX),
    category: z.enum(IngredientCategory),
    proteinType: z.enum(ProteinType).optional(),
    defaultUnit: z.enum(Unit),
    gramsPerPiece: z.number().finite().gt(0).max(GRAMS_PER_PIECE_MAX).optional(),
    allergens: z
      .array(z.enum(Allergen))
      .refine((list) => new Set(list).size === list.length, 'Repeated allergen'),
    calories: per100g(NUTRITION_MAX.calories),
    protein: per100g(NUTRITION_MAX.protein),
    carbs: per100g(NUTRITION_MAX.carbs),
    fat: per100g(NUTRITION_MAX.fat),
    fiber: per100g(NUTRITION_MAX.fiber).optional(),
  })
  .superRefine((body, ctx) => {
    if (isProteinTypedCategory(body.category)) {
      const allowed: readonly string[] = PROTEIN_TYPES_BY_CATEGORY[body.category]
      if (!body.proteinType || !allowed.includes(body.proteinType)) {
        ctx.addIssue({
          code: 'custom',
          path: ['proteinType'],
          message: `One of ${allowed.join(', ')} for ${body.category}`,
        })
      }
    } else if (body.proteinType !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['proteinType'], message: 'Not for this category' })
    }
    if (body.defaultUnit === 'piece' && body.gramsPerPiece === undefined) {
      ctx.addIssue({ code: 'custom', path: ['gramsPerPiece'], message: 'Required for piece' })
    }
    if (body.defaultUnit === 'g' && body.gramsPerPiece !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['gramsPerPiece'], message: 'Only for piece' })
    }
  })

/**
 * POST /api/ingredients
 *
 * "Add as new ingredient" from an unmatched ingredient row (HON-1263): a
 * household-scoped ingredient, or the existing one the name already means.
 * Error strings are English, for logs; the form branches on the status.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Unlike the search, a new ingredient belongs to a household.
  const membership = await getHouseholdMembership(session.user.id)
  if (!membership) {
    return NextResponse.json({ error: 'No household found' }, { status: 403 })
  }

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = createSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    )
  }

  const { household } = membership

  try {
    const rateLimitResult = await checkRateLimit(household.id, 'ingredient-create')
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded',
          message: `Maximum ${rateLimitResult.limit} new ingredients per hour`,
          resetAt: rateLimitResult.resetAt.toISOString(),
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
        },
      )
    }

    const ingredient = await createHouseholdIngredient(
      household.id,
      resolveHouseholdLocale(household),
      parsed.data,
    )
    return NextResponse.json({ ingredient }, { status: 201 })
  } catch (error) {
    captureApiError(error, { route: '/api/ingredients', userId: session.user.id })
    return NextResponse.json({ error: 'Failed to create ingredient' }, { status: 500 })
  }
}
