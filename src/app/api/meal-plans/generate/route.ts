import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { generateMealPlan, createEmptyPlan, fillEmptySlots } from '@/lib/ai/generate-plan'
import {
  MealPlanValidationError,
  InsufficientCandidatesError,
  NoEmptySlotsError,
} from '@/lib/ai/types'
import {
  getNextMonday,
  getCurrentWeekMonday,
  isMonday,
  isSunday,
  parseLocalDate,
} from '@/lib/meal-planning/dates'
import { checkRateLimit, recordGeneration } from '@/lib/meal-planning/rate-limit'

const generateRequestSchema = z.object({
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format')
    .optional(),
  targetWeek: z.enum(['current', 'next']).optional(),
  planId: z.string().optional(),
  mode: z.enum(['generate', 'empty', 'fill-empty']).default('generate'),
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

  const { targetWeek = 'next', mode = 'generate', planId } = parsed.data

  // Get household preferences
  const preferences = household.preferences
  const dietaryType = preferences?.dietaryType ?? 'omnivore'
  const allergensToAvoid = preferences?.allergensToAvoid ?? []
  const excludedIngredientIds = preferences?.excludedIngredientIds ?? []
  const restrictions = preferences?.restrictions ?? []
  const weekdayMealTypes = preferences?.weekdayMealTypes ?? ['dinner']
  const weekendMealTypes = preferences?.weekendMealTypes ?? ['dinner']

  // Handle fill-empty mode
  if (mode === 'fill-empty') {
    if (!planId) {
      return NextResponse.json({ error: 'planId is required for fill-empty mode' }, { status: 400 })
    }

    try {
      const result = await fillEmptySlots({
        planId,
        householdId: household.id,
        dietaryType,
        allergensToAvoid,
        excludedIngredientIds,
        restrictions,
        weekdayMealTypes,
        weekendMealTypes,
      })

      // Record successful generation for rate limiting
      recordGeneration(household.id)

      return NextResponse.json(result, { status: 200 })
    } catch (error) {
      if (error instanceof NoEmptySlotsError) {
        return NextResponse.json(
          { error: 'No empty slots to fill', message: error.message },
          { status: 400 },
        )
      }

      if (error instanceof MealPlanValidationError) {
        console.error('AI response validation failed:', error.message)
        return NextResponse.json(
          { error: 'AI generated an invalid meal plan', message: error.message },
          { status: 422 },
        )
      }

      if (error instanceof InsufficientCandidatesError) {
        return NextResponse.json(
          { error: 'Insufficient meal options', message: error.message },
          { status: 422 },
        )
      }

      if (error instanceof Error && error.message === 'Plan not found') {
        return NextResponse.json({ error: 'Plan not found' }, { status: 404 })
      }

      console.error('Fill empty slots failed:', error)
      return NextResponse.json({ error: 'Failed to fill empty slots' }, { status: 500 })
    }
  }

  // Determine start date and effective start date based on targetWeek
  let startDate: Date
  let effectiveStartDate: Date | undefined

  if (parsed.data.startDate) {
    // Explicit startDate provided - use it directly (backwards compatibility)
    startDate = parseLocalDate(parsed.data.startDate)
    if (!isMonday(startDate)) {
      return NextResponse.json({ error: 'Start date must be a Monday' }, { status: 400 })
    }
  } else if (targetWeek === 'current') {
    // Current week: startDate is this Monday, entries start from today
    if (isSunday()) {
      return NextResponse.json(
        { error: 'Cannot generate current week plan on Sunday - use next week instead' },
        { status: 400 },
      )
    }
    startDate = getCurrentWeekMonday()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Only set effectiveStartDate if not Monday (partial week)
    if (!isMonday(today)) {
      effectiveStartDate = today
    }
  } else {
    // Next week (default)
    startDate = getNextMonday()
  }

  // Handle empty mode - create plan with no entries
  if (mode === 'empty') {
    try {
      const result = await createEmptyPlan({
        householdId: household.id,
        startDate,
      })

      // Record successful generation for rate limiting
      recordGeneration(household.id)

      return NextResponse.json(
        {
          ...result,
          weekContext: {
            type: targetWeek,
            daysCount: 0,
            isPartialWeek: false,
          },
        },
        { status: 200 },
      )
    } catch (error) {
      // Handle Prisma unique constraint violation
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        return NextResponse.json(
          { error: 'A meal plan already exists for this week' },
          { status: 409 },
        )
      }

      console.error('Empty plan creation failed:', error)
      return NextResponse.json({ error: 'Failed to create empty plan' }, { status: 500 })
    }
  }

  try {
    // Generate meal plan (default mode)
    const result = await generateMealPlan({
      householdId: household.id,
      startDate,
      effectiveStartDate,
      dietaryType,
      allergensToAvoid,
      excludedIngredientIds,
      restrictions,
      weekdayMealTypes,
      weekendMealTypes,
    })

    // Record successful generation for rate limiting
    recordGeneration(household.id)

    // Add metadata about the plan
    const daysCount = result.entries.length
    const isPartialWeek = daysCount < 7

    return NextResponse.json(
      {
        ...result,
        weekContext: {
          type: targetWeek,
          daysCount,
          isPartialWeek,
        },
      },
      { status: 200 },
    )
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
