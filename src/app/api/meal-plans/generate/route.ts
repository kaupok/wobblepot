import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { generateMealPlan } from '@/lib/ai/generate-plan'
import { MealPlanValidationError, InsufficientCandidatesError } from '@/lib/ai/types'
import { getNextMonday, isMonday, parseLocalDate } from '@/lib/meal-planning/dates'
import { checkRateLimit, recordGeneration } from '@/lib/meal-planning/rate-limit'

const generateRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
})

export async function POST(request: Request) {
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

  // Check rate limit
  // NOTE: In-memory rate limiting has a known race condition where concurrent requests
  // can bypass the limit before recordGeneration is called. This is acceptable for MVP
  // as it only affects edge cases of rapid concurrent requests. For production scale,
  // consider Redis or database-backed atomic rate limiting.
  const rateLimitResult = checkRateLimit(household.id)
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: 'Maximum 5 meal plan generations per hour',
        resetAt: rateLimitResult.resetAt?.toISOString(),
      },
      { status: 429 },
    )
  }

  // Parse and validate request body
  let body: unknown = {}
  try {
    const text = await request.text()
    if (text) {
      body = JSON.parse(text)
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = generateRequestSchema.safeParse(body)
  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  // Determine start date
  let startDate: Date
  if (parsed.data.startDate) {
    startDate = parseLocalDate(parsed.data.startDate)
    if (!isMonday(startDate)) {
      return NextResponse.json({ error: 'Start date must be a Monday' }, { status: 400 })
    }
  } else {
    startDate = getNextMonday()
  }

  // Get household preferences
  const preferences = household.preferences
  const dietaryType = preferences?.dietaryType ?? 'omnivore'
  const allergensToAvoid = preferences?.allergensToAvoid ?? []
  const excludedIngredientIds = preferences?.excludedIngredientIds ?? []
  const restrictions = preferences?.restrictions ?? []

  try {
    // Generate meal plan
    const result = await generateMealPlan({
      householdId: household.id,
      startDate,
      dietaryType,
      allergensToAvoid,
      excludedIngredientIds,
      restrictions,
    })

    // Record successful generation for rate limiting
    recordGeneration(household.id)

    return NextResponse.json(result, { status: 200 })
  } catch (error) {
    // Handle validation errors from AI response
    if (error instanceof MealPlanValidationError) {
      console.error('AI response validation failed:', error.message)
      return NextResponse.json(
        { error: 'AI generated an invalid meal plan', message: error.message },
        { status: 422 },
      )
    }

    // Handle insufficient candidates for required protein slots
    if (error instanceof InsufficientCandidatesError) {
      return NextResponse.json(
        { error: 'Insufficient meal options', message: error.message },
        { status: 422 },
      )
    }

    // Handle Prisma unique constraint violation (race condition edge case)
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      return NextResponse.json(
        { error: 'A meal plan already exists for this week' },
        { status: 409 },
      )
    }

    // Log and return generic error for other cases
    console.error('Meal plan generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate meal plan' }, { status: 500 })
  }
}
