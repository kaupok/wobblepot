import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateObject } from 'ai'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'
import { TIPS_MODEL } from '@/lib/ai/models'
import { parseStoredTips } from '@/lib/tips'
import { checkRateLimit, retryAfterSeconds } from '@/lib/rate-limit'
import type { StructuredTips } from '@/components/meal-plan/types'

function getErrorStatusCode(err: unknown): number | undefined {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>
    if (typeof e['statusCode'] === 'number') return e['statusCode']
    if (typeof e['status'] === 'number') return e['status']
  }
  return undefined
}

const fullTipsSchema = z.object({
  equipment: z
    .array(z.string())
    .describe('3-5 essential equipment items (pans, bowls, utensils) specific to this meal'),
  steps: z
    .array(z.string())
    .describe(
      '4-6 ordered preparation steps covering what to start first, parallel prep, and timing tips',
    ),
  pitfalls: z.array(z.string()).describe('2-3 common mistakes to avoid with this dish'),
  tip: z.string().describe('One helpful cooking tip').optional(),
})

const supplementaryTipsSchema = z.object({
  pitfalls: z
    .array(z.string())
    .describe('2-3 common mistakes to avoid, focusing on pitfalls not covered in the user notes'),
  tip: z.string().describe('One helpful cooking tip relevant to the user method'),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; entryId: string }> },
) {
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
  const { id: planId, entryId } = await params

  const rateLimitResult = await checkRateLimit(household.id, 'meal-prep-tips')
  if (!rateLimitResult.allowed) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        message: `Maximum ${rateLimitResult.limit} preparation tip requests per hour`,
        resetAt: rateLimitResult.resetAt.toISOString(),
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds(rateLimitResult)) },
      },
    )
  }

  try {
    const entry = await prisma.mealPlanEntry.findFirst({
      where: {
        id: entryId,
        planId: planId,
        plan: {
          householdId: household.id,
        },
      },
      include: {
        meal: {
          include: {
            components: {
              include: {
                ingredient: {
                  select: {
                    name: true,
                    defaultUnit: true,
                  },
                },
              },
            },
          },
        },
      },
    })

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
    }

    if (!entry.meal) {
      return NextResponse.json({ error: 'No meal assigned to this entry' }, { status: 400 })
    }

    // Return cached tips if available and valid JSON
    if (entry.preparationTips) {
      const cached = parseStoredTips(entry.preparationTips)
      if (cached) {
        return NextResponse.json({ tips: cached }, { status: 200 })
      }
      // Old format — fall through to regenerate
    }

    const householdSize = await getHouseholdMemberCount(household.id)
    const mealName = entry.meal.name
    const timeMinutes = entry.meal.timeMinutes
    const preparationNotes = entry.meal.preparationNotes

    const ingredientsList = entry.meal.components
      .map((comp) => {
        const quantity = comp.quantityPerServing * householdSize
        const unit = comp.ingredient.defaultUnit === 'piece' ? 'pcs' : comp.ingredient.defaultUnit
        return `- ${comp.ingredient.name}: ${Math.round(quantity)}${unit}`
      })
      .join('\n')

    const hasNotes = !!preparationNotes?.trim()

    const metricReminder = `IMPORTANT: Use metric units for ALL measurements:
- Temperatures: °C (e.g., "190°C")
- Weights: g or kg (e.g., "500g", "1.5kg")
- Volumes: ml or L (e.g., "250ml", "1L")
- Lengths: cm (e.g., "2cm")
Never use Fahrenheit, cups, ounces, pounds, or inches.`

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })
    const timeout = AbortSignal.timeout(30_000)

    let tips: StructuredTips

    if (hasNotes) {
      const prompt = `You are a helpful cooking assistant. The user has their own preparation notes for this meal. Generate supplementary tips that ENHANCE their method — do NOT repeat what they already wrote.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

User's preparation notes:
${preparationNotes}

Based on the user's method above, provide ONLY supplementary guidance:
- pitfalls: 2-3 common mistakes specific to their approach that they didn't mention
- tip: One helpful cooking tip relevant to their method

Do NOT repeat or rephrase what the user already wrote. Only add new information.

${metricReminder}

Keep it brief and practical.`

      const { object } = await generateObject({
        model: anthropic(TIPS_MODEL),
        schema: supplementaryTipsSchema,
        prompt,
        maxOutputTokens: 400,
        maxRetries: 3,
        abortSignal: timeout,
      })

      tips = object
    } else {
      const prompt = `You are a helpful cooking assistant. Generate brief, actionable preparation guidance for the following meal.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

Provide:
- equipment: 3-5 essential equipment items (be specific, e.g., "Large oven-safe skillet" not just "pan")
- steps: 4-6 ordered steps covering what to start first (longest cooking items), parallel prep, and timing tips
- pitfalls: 2-3 common mistakes or pitfalls specific to this dish
- tip: One helpful cooking tip

${metricReminder}

Keep it brief and practical. Not a full recipe — just order of operations and key tips. Do not repeat ingredient quantities.`

      const { object } = await generateObject({
        model: anthropic(TIPS_MODEL),
        schema: fullTipsSchema,
        prompt,
        maxOutputTokens: 1000,
        maxRetries: 3,
        abortSignal: timeout,
      })

      tips = object
    }

    // Cache tips as JSON in the database
    await prisma.mealPlanEntry.update({
      where: { id: entryId },
      data: { preparationTips: JSON.stringify(tips) },
    })

    return NextResponse.json({ tips }, { status: 200 })
  } catch (error) {
    console.error('Failed to generate preparation tips:', error)

    // Classify error for appropriate HTTP status
    const statusCode = getErrorStatusCode(error)

    if (statusCode === 429) {
      return NextResponse.json(
        { error: 'AI service is busy. Please try again in a moment.' },
        { status: 429 },
      )
    }

    if (statusCode === 529 || statusCode === 503) {
      return NextResponse.json(
        { error: 'AI service temporarily unavailable. Please try again.' },
        { status: 502 },
      )
    }

    if (error instanceof Error && error.name === 'TimeoutError') {
      return NextResponse.json({ error: 'Request timed out. Please try again.' }, { status: 504 })
    }

    return NextResponse.json({ error: "Couldn't generate tips. Try again." }, { status: 500 })
  }
}
