import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { loadMeals } from '@/lib/meals/load-meals'
import { loadSlotCandidates } from '@/lib/meal-planning/slot-suggestions'
import { isMealAllowedForSlot } from '@/lib/meal-planning/meal-allowed-for-slot'
import { loadPlanEntries } from '@/lib/meal-planning/load-plan-entries'

// The planning reads with a household's "Ingredients to avoid" (HON-1321).
// Runs against PGlite through the `unit-db` project, with no mocks. The
// household saved its tags before the rule changed, so its stored ids hold
// nothing: each read must resolve the tags itself.

const TAGS = ['mushrooms', 'pork', 'egg', 'nut']

/** Meal id → the one ingredient it holds. */
const MEALS = {
  'm-mushroom': 'mushroom',
  'm-shiitake': 'shiitake mushroom',
  'm-chestnut': 'chestnut mushroom',
  'm-pork-mince': 'pork mince',
  'm-pork-belly': 'pork belly',
  'm-egg': 'egg',
  'm-aubergine': 'aubergine',
  'm-nutmeg': 'nutmeg',
} as const

const EXCLUDED = ['m-chestnut', 'm-egg', 'm-mushroom', 'm-pork-belly', 'm-pork-mince', 'm-shiitake']
const KEPT = ['m-aubergine', 'm-nutmeg']

async function world() {
  for (const [mealId, name] of Object.entries(MEALS)) {
    const ingredient = await prisma.ingredient.create({
      data: {
        name,
        category: 'vegetable',
        defaultUnit: 'g',
        calories: 1,
        protein: 0,
        carbs: 0,
        fat: 0,
      },
    })
    await prisma.meal.create({
      data: {
        id: mealId,
        name: `Glimmer ${name}`,
        suitableFor: ['dinner'],
        components: { create: [{ ingredientId: ingredient.id, quantityPerServing: 50 }] },
      },
    })
  }
  const household = await prisma.household.create({
    data: {
      name: 'Alder',
      locale: 'en',
      preferences: { create: { excludedIngredients: TAGS, excludedIngredientIds: [] } },
      mealPlans: { create: { id: 'plan-alder' } },
    },
    include: {
      preferences: true,
      _count: { select: { members: true } },
      members: { include: { preferences: true } },
    },
  })
  return household
}

const glimmer = (ids: string[]) => ids.filter((id) => id in MEALS).sort()

describe('the avoided ingredients, resolved at read time', () => {
  it('leaves the excluded meals out of list_meals', async () => {
    const household = await world()

    const { meals } = await loadMeals(household, { limit: 100 })

    expect(glimmer(meals.map((meal) => meal.id))).toEqual(KEPT)
  })

  it('leaves them out of the Swap and empty-slot candidates', async () => {
    const household = await world()
    const entry = { id: 'entry-1', mealType: 'dinner' as const, mealId: null }

    const candidates = await loadSlotCandidates(household, entry, 'add')

    expect(glimmer(candidates.map((meal) => meal.id))).toEqual(KEPT)
  })

  it('refuses them in plan_meal', async () => {
    const household = await world()

    for (const mealId of EXCLUDED) {
      expect(await isMealAllowedForSlot(household, mealId, 'dinner')).toBe('ruledOut')
    }
    for (const mealId of KEPT) {
      expect(await isMealAllowedForSlot(household, mealId, 'dinner')).toBe('allowed')
    }
  })

  it('marks exactly the planned meals the filters leave out', async () => {
    const household = await world()
    const date = new Date('2026-10-19T00:00:00Z')
    for (const [index, mealId] of Object.keys(MEALS).entries()) {
      await prisma.mealPlanEntry.create({
        data: {
          planId: 'plan-alder',
          date: new Date(date.getTime() + index * 24 * 60 * 60 * 1000),
          mealType: 'dinner',
          mealId,
        },
      })
    }

    const { entries } = await loadPlanEntries(household, {
      startDate: date,
      endDate: new Date('2026-11-01T00:00:00Z'),
    })

    const marked = entries
      .filter((entry) => entry.conflicts.some((conflict) => conflict.kind === 'excluded'))
      .map((entry) => entry.meal!.id)
    expect(marked.sort()).toEqual(EXCLUDED)
  })
})
