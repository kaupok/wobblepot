import { describe, expect, it } from 'vitest'
import {
  buildMealImagePrompt,
  gramsOf,
  ingredientsByWeight,
  MEAL_IMAGE_PROMPT_VERSION,
  STYLE_PREFIX_ILLUSTRATION_V3,
  type MealImageMeal,
} from './prompt'

// The spike's chicken-thighs trap meal (scripts/spike-meal-images.ts, HON-732).
const chickenThighs: MealImageMeal = {
  name: 'Baked Chicken Thighs',
  description: 'Herb-roasted chicken thighs with potatoes',
  components: [
    { name: 'chicken thigh', quantity: 200, unit: 'g' },
    { name: 'potato', quantity: 150, unit: 'g' },
    { name: 'olive oil', quantity: 15, unit: 'ml' },
    { name: 'rosemary', quantity: 2, unit: 'g' },
    { name: 'thyme', quantity: 2, unit: 'g' },
    { name: 'garlic', quantity: 10, unit: 'g' },
  ],
  preparationNotes:
    'Cut the potatoes into 2cm cubes and roast them in a single layer. Roast the thighs on a separate tray, then pull the meat off the bone in large shreds, discard the skin, and pile the chicken over the potatoes.',
}

describe('buildMealImagePrompt', () => {
  it('is the V3 prompt HON-726 accepted with the HON-743 V4 suffix', () => {
    // Printed from `buildPrompt(chicken-thighs, illustration, 'v3')` in the
    // spike before the move (HON-735), with the suffix swapped for the
    // `v4-white` variant HON-743 chose. Pinned, not re-derived: a drift in any
    // constant or in the ordering shows up here.
    expect(buildMealImagePrompt(chickenThighs)).toBe(
      'Warm stylised illustration of a single modest serving for one person of a home-cooked dish, on a single plain dinner plate or in a single bowl with space around the food, soft gouache textures, gentle hand-drawn linework, muted natural palette, seen from a three-quarter angle on a plain, uncluttered surface. The dish: Baked Chicken Thighs — Herb-roasted chicken thighs with potatoes. It is made from exactly these ingredients, largest amount first: chicken thigh, potato, olive oil, garlic, rosemary, thyme. How it is prepared: Cut the potatoes into 2cm cubes and roast them in a single layer. Roast the thighs on a separate tray, then pull the meat off the bone in large shreds, discard the skin, and pile the chicken over the potatoes. Show the ingredients cut and cooked exactly as described. Show only the finished, cooked dish as it is served. Nothing that is not in that list: no garnish, no herbs beyond those listed, no olives, bread or side dishes. No raw ingredients, cutting boards, pots, pans, baking dishes or other props around it. A single dish, landscape 3:2 composition. The plate sits in the centre and takes up about half the width of the frame, with generous empty space around it on every side. The surface is pure white, flat and untextured, with only a soft light shadow under the plate. No text, no labels, no logos, no hands, no people.',
    )
  })

  it('leaves the preparation sentence out when the meal has no notes', () => {
    const prompt = buildMealImagePrompt({ ...chickenThighs, preparationNotes: '  ' })
    expect(prompt.startsWith(STYLE_PREFIX_ILLUSTRATION_V3)).toBe(true)
    expect(prompt).not.toContain('How it is prepared')
  })

  it('handles a meal with no description, and one that ends in a full stop', () => {
    expect(buildMealImagePrompt({ ...chickenThighs, description: null })).toContain(
      'The dish: Baked Chicken Thighs. It is made',
    )
    expect(buildMealImagePrompt({ ...chickenThighs, description: 'Roasted.' })).toContain(
      'The dish: Baked Chicken Thighs — Roasted. It is made',
    )
  })

  it('is version v4', () => {
    expect(MEAL_IMAGE_PROMPT_VERSION).toBe('v4')
  })
})

describe('ingredientsByWeight', () => {
  it('sorts pieces by their weight, not their count', () => {
    // The spike sorted raw quantities, so 1 pita ranked below 3 g of cumin.
    const order = ingredientsByWeight({
      components: [
        { name: 'cumin', quantity: 3, unit: 'g' },
        { name: 'pita', quantity: 1, unit: 'piece', gramsPerPiece: 60 },
        { name: 'hummus', quantity: 80, unit: 'g' },
      ],
    })
    expect(order).toEqual(['hummus', 'pita', 'cumin'])
  })

  it('falls back to the shared default for a piece with no gramsPerPiece', () => {
    expect(gramsOf({ quantity: 2, unit: 'piece', gramsPerPiece: null })).toBe(60)
  })

  it('converts ml with the density, or at 1 g/ml without one', () => {
    expect(gramsOf({ quantity: 10, unit: 'ml', densityGPerMl: 0.9 })).toBe(9)
    expect(gramsOf({ quantity: 300, unit: 'ml' })).toBe(300)
  })

  it('keeps the meal order for ties', () => {
    expect(
      ingredientsByWeight({
        components: [
          { name: 'rosemary', quantity: 2, unit: 'g' },
          { name: 'thyme', quantity: 2, unit: 'g' },
        ],
      }),
    ).toEqual(['rosemary', 'thyme'])
  })
})
