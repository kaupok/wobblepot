import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadShoppingList } from '@/lib/shopping/load-shopping-list'
import { mcpHousehold } from '@/test/mcp'
import { changeMealIngredients } from './change-meal-ingredients'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no
// mocks: the real matcher finds the replacements, `replaceEntryChanges`
// writes the change rows, and the shopping list is read back (HON-1385).

// Thursday 15 October 2026, noon in Tallinn: Saturday is 17 October.
const NOW = new Date('2026-10-15T09:00:00Z')
const SATURDAY = '2026-10-17'
const CALLER = { userId: 'user-1' }

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})

afterEach(() => {
  vi.useRealTimers()
})

/**
 * Alder plans trout for 4 on Saturday: 150 g trout, 200 g potato, 80 g carrot
 * and 10 g oil a serving. Every ingredient is Alder's own, so the matcher
 * finds rice and broccoli by name.
 */
async function world() {
  const row = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      timezone: 'Europe/Tallinn',
      members: { create: [{ name: 'A' }] },
      mealPlans: { create: { id: 'plan-alder' } },
    },
  })
  for (const name of ['trout', 'potato', 'carrot', 'oil', 'rice', 'broccoli']) {
    await prisma.ingredient.create({
      data: {
        id: `ing-${name}`,
        name,
        householdId: row.id,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
  }
  await prisma.meal.create({
    data: {
      id: 'meal-trout',
      name: 'Trout',
      householdId: row.id,
      components: {
        create: [
          { ingredientId: 'ing-trout', quantityPerServing: 150 },
          { ingredientId: 'ing-potato', quantityPerServing: 200 },
          { ingredientId: 'ing-carrot', quantityPerServing: 80 },
          { ingredientId: 'ing-oil', quantityPerServing: 10 },
        ],
      },
    },
  })
  await prisma.mealPlanEntry.create({
    data: {
      id: 'entry-sat',
      planId: 'plan-alder',
      date: new Date(`${SATURDAY}T00:00:00Z`),
      mealType: 'dinner',
      mealId: 'meal-trout',
      servingOverride: 4,
    },
  })
  return mcpHousehold({ id: row.id, locale: 'en', timezone: 'Europe/Tallinn' })
}

type Household = Awaited<ReturnType<typeof world>>

function call(household: Household, changes: unknown[]) {
  return changeMealIngredients.run(
    household,
    changeMealIngredients.inputSchema.parse({ date: SATURDAY, mealType: 'dinner', changes }),
    CALLER,
  )
}

/** The entry's change rows, oldest first. */
async function rows() {
  const changes = await prisma.mealPlanEntryComponent.findMany({
    where: { entryId: 'entry-sat' },
    orderBy: { createdAt: 'asc' },
  })
  return changes.map((c) => ({
    original: c.originalIngredientId,
    replacement: c.replacementIngredientId,
    quantityPerServing: c.quantityPerServing,
  }))
}

const RICE_ROW = { original: 'ing-potato', replacement: 'ing-rice', quantityPerServing: 75 }
const CARROT_ROW = { original: 'ing-carrot', replacement: null, quantityPerServing: null }
const BROCCOLI_ROW = { original: null, replacement: 'ing-broccoli', quantityPerServing: 100 }

describe('change_meal_ingredients', () => {
  it('replaces, adds and restores on one entry, and the shopping list follows', async () => {
    const household = await world()

    const replaced = await call(household, [
      {
        action: 'replace',
        ingredients: ['potato', 'carrot'],
        with: 'rice',
        quantity: 300,
        unit: 'g',
      },
    ])
    expect(replaced).toMatchObject({ outcome: 'changed' })
    expect(changeMealIngredients.outputSchema.safeParse(replaced).success).toBe(true)
    expect(await rows()).toEqual([RICE_ROW, CARROT_ROW])

    const items = (await loadShoppingList(household, { days: 7 })).groups.flatMap((g) => g.items)
    const ids = items.map((item) => item.ingredientId)
    expect(ids).toContain('ing-rice')
    expect(ids).not.toContain('ing-potato')
    expect(ids).not.toContain('ing-carrot')

    const added = await call(household, [
      { action: 'add', ingredient: 'broccoli', quantity: 400, unit: 'g' },
    ])
    expect(added.outcome).toBe('changed')
    expect(await rows()).toEqual([RICE_ROW, CARROT_ROW, BROCCOLI_ROW])

    const restored = await call(household, [{ action: 'restore', ingredient: 'carrot' }])
    expect(restored.outcome).toBe('changed')
    expect(await rows()).toEqual([RICE_ROW, BROCCOLI_ROW])
    expect(restored.ingredients.map((i) => [i.name.toLowerCase(), i.quantity])).toContainEqual([
      'carrot',
      320,
    ])

    // No AI call, so no usage row.
    expect(await prisma.aiUsage.count({ where: { householdId: household.id } })).toBe(0)
  })

  it('writes nothing when one change has no match', async () => {
    const household = await world()

    const result = await call(household, [
      { action: 'leave_out', ingredient: 'oil' },
      { action: 'replace', ingredients: ['potato'], with: 'xyzzy', quantity: 300, unit: 'g' },
    ])

    expect(result).toMatchObject({ outcome: 'not_changed', applied: [] })
    expect(result.unmatched.map((u) => u.name)).toEqual(['xyzzy'])
    expect(await rows()).toEqual([])
  })
})
