import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseAndMatchRecipe, RecipeParseError } from '@/lib/ai/parse-recipe'

const parseRecipeSchema = z.object({
  text: z.string().min(1, 'Recipe text is required'),
})

export async function POST(request: Request) {
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

  let body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parseRecipeSchema.safeParse(body)

  if (!parsed.success) {
    const errors = parsed.error.flatten().fieldErrors
    return NextResponse.json({ error: 'Validation failed', details: errors }, { status: 400 })
  }

  try {
    const result = await parseAndMatchRecipe(parsed.data.text)

    return NextResponse.json({
      success: true,
      recipe: {
        name: result.name,
        description: result.description,
        preparationNotes: result.preparationNotes,
        timeMinutes: result.timeMinutes,
        servings: result.servings,
        mealTypes: result.mealTypes,
        kidFriendly: result.kidFriendly,
        ingredients: result.ingredients,
        allMatched: result.allMatched,
      },
    })
  } catch (error) {
    if (error instanceof RecipeParseError) {
      return NextResponse.json(
        {
          success: false,
          error: error.message,
        },
        { status: 400 },
      )
    }

    console.error('Failed to parse recipe:', error)
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to parse the recipe. Please try again.',
      },
      { status: 500 },
    )
  }
}
