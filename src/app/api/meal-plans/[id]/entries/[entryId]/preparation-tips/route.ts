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
        const unit = comp.ingredient.defaultUnit === 'piece' ? 'pcs' : 'g'
        return `- ${comp.ingredient.name}: ${Math.round(quantity)}${unit}`
      })
      .join('\n')

    const prompt = `You are a helpful cooking assistant. Generate brief, actionable preparation tips for the following meal.

Meal: ${mealName}
Servings: ${householdSize}
${timeMinutes ? `Time budget: ${timeMinutes} minutes` : ''}

Ingredients:
${ingredientsList}

Provide 4-6 numbered steps covering:
- What to start first (longest cooking items)
- Parallel prep suggestions
- Timing tips
- One helpful cooking tip at the end

Keep it brief and practical. Not a full recipe - just order of operations and key tips. Do not repeat ingredient quantities.

Format: numbered list, then a single "Tip:" line at the end.`

    const anthropic = createAnthropic({ apiKey: serverEnv.ANTHROPIC_API_KEY })

    const { text } = await generateText({
      model: anthropic('claude-3-5-haiku-20241022'),
      prompt,
      maxOutputTokens: 300,
    })

    return NextResponse.json({ tips: text.trim() }, { status: 200 })
  } catch (error) {
    console.error('Failed to generate preparation tips:', error)
    return NextResponse.json({ error: "Couldn't generate tips. Try again." }, { status: 500 })
  }
}
