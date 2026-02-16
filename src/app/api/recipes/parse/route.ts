import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { getHouseholdMembership } from '@/lib/household'
import { parseAndMatchRecipe, fetchRecipeFromUrl, RecipeParseError } from '@/lib/ai/parse-recipe'

const parseRecipeSchema = z.object({
  text: z.string().min(1, 'Recipe text is required'),
})

/**
 * Detect if the input starts with a URL and extract it along with optional user context.
 */
export function extractUrlAndContext(text: string): { url: string; context: string } | null {
  let trimmed = text.trim()
  // Support www. URLs by auto-prepending https://
  if (trimmed.startsWith('www.')) {
    trimmed = 'https://' + trimmed
  }
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
    return null
  }
  const lines = trimmed.split('\n')
  const urlLine = lines[0]!.trim()
  // Validate it looks like a URL (has a domain after the protocol)
  try {
    new URL(urlLine)
  } catch {
    return null
  }
  const context = lines.slice(1).join('\n').trim()
  return { url: urlLine, context }
}

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
    let recipeText = parsed.data.text

    // Check if input is a URL
    const urlInput = extractUrlAndContext(recipeText)
    if (urlInput) {
      const fetchedContent = await fetchRecipeFromUrl(urlInput.url)
      // Combine fetched content with optional user context
      recipeText = urlInput.context
        ? `${fetchedContent}\n\nAdditional context from user: ${urlInput.context}`
        : fetchedContent
    }

    const result = await parseAndMatchRecipe(recipeText)

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
      confidenceTier: result.confidenceTier,
      confidenceWarning: result.confidenceWarning,
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
