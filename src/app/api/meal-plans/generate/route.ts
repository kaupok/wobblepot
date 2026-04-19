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
import { parseLocalDate } from '@/lib/meal-planning/dates'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'

const datePattern = /^\d{4}-\d{2}-\d{2}$/

const generateRequestSchema = z.object({
  startDate: z.string().regex(datePattern, 'Date must be in YYYY-MM-DD format'),
  endDate: z.string().regex(datePattern, 'Date must be in YYYY-MM-DD format'),
  planId: z.string().optional(),
  mode: z.enum(['generate', 'empty', 'fill-empty']).default('generate'),
})

/** Maximum number of days allowed in a single generation request. */
const MAX_DAYS = 14

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

  const rateLimitResult = await checkRateLimit(household.id, 'plan-generation')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} meal plan generations per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
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

  const { mode = 'generate', planId } = parsed.data

  // Parse dates
  const startDate = parseLocalDate(parsed.data.startDate)
  const endDate = parseLocalDate(parsed.data.endDate)

  // Validate date range
  if (endDate <= startDate) {
    return NextResponse.json({ error: 'endDate must be after startDate' }, { status: 400 })
  }

  const dayCount = Math.round((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  if (dayCount > MAX_DAYS) {
    return NextResponse.json(
      { error: `Date range cannot exceed ${MAX_DAYS} days` },
      { status: 400 },
    )
  }

  // Get household preferences
  const preferences = household.preferences
  const dietaryType = preferences?.dietaryType ?? null
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
        startDate,
        endDate,
        dietaryType,
        allergensToAvoid,
        excludedIngredientIds,
        restrictions,
        weekdayMealTypes,
        weekendMealTypes,
      })

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

  // Handle empty mode - create plan with no entries
  if (mode === 'empty') {
    try {
      const result = await createEmptyPlan({
        householdId: household.id,
        startDate,
        endDate,
      })

      return NextResponse.json(result, { status: 200 })
    } catch (error) {
      console.error('Empty plan creation failed:', error)
      return NextResponse.json({ error: 'Failed to create empty plan' }, { status: 500 })
    }
  }

  try {
    // Generate meal plan (default mode)
    const result = await generateMealPlan({
      householdId: household.id,
      startDate,
      endDate,
      dietaryType,
      allergensToAvoid,
      excludedIngredientIds,
      restrictions,
      weekdayMealTypes,
      weekendMealTypes,
    })

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

    // Log and return generic error for other cases
    console.error('Meal plan generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate meal plan' }, { status: 500 })
  }
}
