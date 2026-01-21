import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { auth } from '@/lib/auth'
import { getHouseholdMembership, getHouseholdMemberCount } from '@/lib/household'
import { prisma } from '@/lib/prisma'
import { serverEnv } from '@/lib/env'

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

    const householdSize = await getHouseholdMemberCount(household.id)
    const mealName = entry.meal.name
    const timeMinutes = entry.meal.timeMinutes

    const ingredientsList = entry.meal.components
      .map((comp) => {
        const quantity = comp.quantityPerServing * householdSize
        const unit = comp.ingredient.defaultUnit === 'piece' ? 'pcs' : comp.ingredient.defaultUnit
        return `- ${comp.ingredient.name}: ${Math.round(quantity)}${unit}`
      })
      .join('\n')

    const prompt = `You are a helpful cooking assistant. Generate brief, actionable preparation guidance for the following meal.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

Provide the following sections:

**Equipment needed:**
List 3-5 essential equipment items (pans, bowls, utensils) needed for this specific meal. Be specific (e.g., "Large oven-safe skillet" not just "pan").

**Steps:**
4-6 numbered steps covering:
- What to start first (longest cooking items)
- Parallel prep suggestions
- Timing tips

**Watch out for:**
2-3 common mistakes or pitfalls specific to this dish. Focus on things that could go wrong and how to avoid them.

**Tip:**
One helpful cooking tip at the end.

IMPORTANT: Use metric units for ALL measurements:
- Temperatures: °C (e.g., "190°C")
- Weights: g or kg (e.g., "500g", "1.5kg")
- Volumes: ml or L (e.g., "250ml", "1L")
- Lengths: cm (e.g., "2cm")
Never use Fahrenheit, cups, ounces, pounds, or inches.

Keep it brief and practical. Not a full recipe - just order of operations and key tips. Do not repeat ingredient quantities.

Format each section with the exact headers shown above (Equipment needed:, Steps:, Watch out for:, Tip:).`

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

    const { text } = await generateText({
      model: anthropic('claude-haiku-4-5-20251001'),
      prompt,
      maxOutputTokens: 500,
    })

    return NextResponse.json({ tips: text.trim() }, { status: 200 })
  } catch (error) {
    console.error('Failed to generate preparation tips:', error)
    return NextResponse.json({ error: "Couldn't generate tips. Try again." }, { status: 500 })
  }
}
