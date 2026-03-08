import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { reviewMealQuantities, type ReviewIngredient } from '@/lib/ai/review-quantities'

const reviewRequestSchema = z.object({
  mealName: z.string().min(1),
  servings: z.number().int().min(1).max(50),
  ingredients: z
    .array(
      z.object({
        ingredientId: z.string().min(1),
        name: z.string().min(1),
        quantityPerServing: z.number().positive(),
        unit: z.enum(['g', 'piece']),
      }),
    )
    .min(1),
})

export async function POST(request: Request) {
  const session = await auth.api.getSession({
    headers: await headers(),
  })

  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = reviewRequestSchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request data' }, { status: 400 })
  }

  const { mealName, servings, ingredients } = parsed.data

  try {
    const reviewed = await reviewMealQuantities(
      mealName,
      servings,
      ingredients as ReviewIngredient[],
    )

    // Filter out non-positive quantities the AI may return (schema can't enforce .positive())
    // Missing ingredients will keep their original quantities client-side
    const safeIngredients = reviewed.ingredients.filter((ing) => ing.quantityPerServing > 0)

    return NextResponse.json({ success: true, ingredients: safeIngredients })
  } catch (error) {
    console.error('Failed to review meal quantities:', error)
    return NextResponse.json({ error: 'Failed to review quantities' }, { status: 500 })
  }
}
