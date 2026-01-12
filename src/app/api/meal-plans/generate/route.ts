import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { generateMealPlan } from '@/lib/ai/generate-plan'
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
    console.error('Meal plan generation failed:', error)
    return NextResponse.json({ error: 'Failed to generate meal plan' }, { status: 500 })
  }
}
