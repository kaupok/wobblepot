import { describe, expect, it } from 'vitest'

import type { IngredientCategory, Unit } from '@/generated/prisma/enums'
import { prisma } from '@/lib/prisma'

import { previewCookDeduction } from './cook-preview'
import { updateEntry } from './entries'

// The pantry rows a cooked recipe meal would charge, read without a write
// (HON-1565). Runs against PGlite through the `unit-db` project, with no
// mocks.

const INGREDIENTS: Record<string, [IngredientCategory, Unit, boolean?]> = {
  beetroot: ['vegetable', 'g'],
  lemon: ['fruit', 'piece'],
  cumin: ['spice', 'g'],
  milk: ['dairy', 'g', true],
  salt: ['spice', 'g'],
  yoghurt: ['dairy', 'g'],
  kale: ['vegetable', 'g'],
}

/**
 * Alder: two adults, so 2 servings. A planned roast: 200 g beetroot, half a
 * lemon, 2 g cumin, 100 ml milk and 1 g salt per serving.
 * Pantry: beetroot and cumin have some, lemon 3, milk 1000 ml, salt a staple.
 */
async function world() {
  for (const [id, [category, defaultUnit, measuredByVolume]] of Object.entries(INGREDIENTS)) {
    await prisma.ingredient.create({
      data: {
        id,
        name: id,
        category,
        defaultUnit,
        measuredByVolume: measuredByVolume ?? false,
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  const alder = await prisma.household.create({
    data: {
      name: 'Alder',
      members: { create: [{ name: 'A' }, { name: 'B' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  await prisma.meal.create({
    data: {
      id: 'meal-roast',
      name: 'Roast',
      components: {
        create: [
          { ingredientId: 'beetroot', quantityPerServing: 200 },
          { ingredientId: 'lemon', quantityPerServing: 0.25 },
          { ingredientId: 'cumin', quantityPerServing: 2 },
          { ingredientId: 'milk', quantityPerServing: 100 },
          { ingredientId: 'salt', quantityPerServing: 1 },
        ],
      },
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-roast',
      planId: 'plan-alder',
      mealId: 'meal-roast',
      date: new Date('2026-11-02T00:00:00Z'),
      mealType: 'dinner',
    },
  })
  await prisma.pantryItem.createMany({
    data: [
      { householdId: alder.id, ingredientId: 'beetroot', quantity: null },
      { householdId: alder.id, ingredientId: 'lemon', quantity: 3 },
      { householdId: alder.id, ingredientId: 'cumin', quantity: null },
      { householdId: alder.id, ingredientId: 'milk', quantity: 1000 },
      { householdId: alder.id, ingredientId: 'salt', quantity: null, isStaple: true },
      { householdId: alder.id, ingredientId: 'kale', quantity: null },
    ],
  })
  return alder.id
}

const preview = (householdId: string, locale = 'en') =>
  previewCookDeduction(householdId, 'plan-alder', 'entry-roast', locale)

describe('previewCookDeduction', () => {
  it('lists the non-staple pantry rows the meal takes from, scaled, in recipe order', async () => {
    const householdId = await world()

    expect(await preview(householdId)).toEqual([
      {
        ingredientId: 'beetroot',
        name: 'beetroot',
        used: 400,
        unit: 'g',
        pantryQuantity: null,
        default: 'usedUp',
      },
      {
        ingredientId: 'lemon',
        name: 'lemon',
        used: 0.5,
        unit: 'piece',
        pantryQuantity: 3,
        default: 'subtract',
      },
      {
        ingredientId: 'cumin',
        name: 'cumin',
        used: 4,
        unit: 'g',
        pantryQuantity: null,
        default: 'someLeft',
      },
      {
        ingredientId: 'milk',
        name: 'milk',
        used: 200,
        unit: 'ml',
        pantryQuantity: 1000,
        default: 'subtract',
      },
    ])
  })

  it('names each row in the household’s locale', async () => {
    const householdId = await world()
    await prisma.ingredientTranslation.create({
      data: { ingredientId: 'beetroot', locale: 'et', name: 'peet' },
    })

    const rows = await preview(householdId, 'et')

    expect(rows.find((row) => row.ingredientId === 'beetroot')?.name).toBe('peet')
  })

  it('applies the entry’s ingredient changes', async () => {
    const householdId = await world()
    // Yoghurt for the milk, beetroot left out, kale added.
    await prisma.mealPlanEntryComponent.createMany({
      data: [
        {
          entryId: 'entry-roast',
          originalIngredientId: 'milk',
          replacementIngredientId: 'yoghurt',
          quantityPerServing: 80,
        },
        { entryId: 'entry-roast', originalIngredientId: 'beetroot' },
        { entryId: 'entry-roast', replacementIngredientId: 'kale', quantityPerServing: 30 },
      ],
    })

    const rows = await preview(householdId)

    expect(rows.map((row) => [row.ingredientId, row.used])).toEqual([
      ['lemon', 0.5],
      ['cumin', 4],
      ['kale', 60],
    ])
  })

  it('lists nothing once the entry was charged, even after a revert', async () => {
    const householdId = await world()
    await updateEntry(householdId, 'plan-alder', 'entry-roast', {
      status: 'completed',
      deductPantry: true,
      usedUpIngredientIds: [],
    })
    expect(await preview(householdId)).toEqual([])

    await updateEntry(householdId, 'plan-alder', 'entry-roast', {
      status: 'planned',
      deductPantry: false,
    })

    expect(await preview(householdId)).toEqual([])
  })

  it('lists nothing for another household’s entry', async () => {
    await world()
    const birch = await prisma.household.create({ data: { name: 'Birch' } })

    expect(await preview(birch.id)).toEqual([])
  })
})
