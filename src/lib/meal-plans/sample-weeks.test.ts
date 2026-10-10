import { describe, expect, it } from 'vitest'
import { baseIngredients, baseMeals } from '../../../prisma/seed'
import { newIngredients, newMeals } from '../../../prisma/seed-expansion'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { WAITLIST_REF_PATTERN } from '@/lib/waitlist'
import { SAMPLE_WEEKS, findSampleWeek, sampleWeekServings, type SampleWeek } from './sample-weeks'

interface SeedMeal {
  name: string
  timeMinutes: number
  kidFriendly: boolean
  suitableFor: readonly string[]
  primaryProteinType: string
  components: readonly { ingredient: string }[]
}

// The global library the seed writes: these two lists, and nothing else.
const SEED_MEALS = [...baseMeals, ...newMeals] as readonly SeedMeal[]

const SEED_INGREDIENTS = new Map(
  (
    [
      ...baseIngredients,
      ...newIngredients,
      ...comprehensiveIngredients,
      ...importCoverageIngredients,
    ] as readonly { name: string; proteinType?: string | null }[]
  ).map((ingredient) => [ingredient.name, ingredient]),
)

const MEAT_AND_FISH = new Set(['poultry', 'beef', 'pork', 'lamb', 'fish'])
// Animal products the protein type does not flag: a stock, a sauce.
const HIDDEN_MEAT_OR_FISH =
  /(chicken|beef|fish|bone|pork|lamb)\s+(stock|broth)|fish sauce|oyster sauce|anchov|worcestershire|gelatin/i

function seedMeal(name: string): SeedMeal {
  const matches = SEED_MEALS.filter((meal) => meal.name === name)
  if (matches.length !== 1) {
    throw new Error(`"${name}" matches ${matches.length} seed meals, not exactly one`)
  }
  return matches[0]!
}

function weekMeals(week: SampleWeek): SeedMeal[] {
  return week.meals.map(seedMeal)
}

function hasMeatOrFish(meal: SeedMeal): boolean {
  return meal.components.some((component) => {
    const ingredient = SEED_INGREDIENTS.get(component.ingredient)
    return (
      MEAT_AND_FISH.has(ingredient?.proteinType ?? '') ||
      HIDDEN_MEAT_OR_FISH.test(component.ingredient)
    )
  })
}

describe('SAMPLE_WEEKS', () => {
  it('has the six pages, each slug once', () => {
    expect(SAMPLE_WEEKS.map((week) => week.slug)).toEqual([
      'family-of-four',
      'two-adults-and-a-toddler',
      'one-adult-two-kids',
      'thirty-minute-dinners',
      'vegetarian-week',
      'kid-friendly-week',
    ])
  })

  describe.each(SAMPLE_WEEKS.map((week) => [week.slug, week] as const))('%s', (_slug, week) => {
    it('names seven meals that each match exactly one global seed meal', () => {
      expect(week.meals).toHaveLength(7)
      for (const name of week.meals) {
        expect(() => seedMeal(name)).not.toThrow()
      }
    })

    it('repeats no meal', () => {
      expect(new Set(week.meals).size).toBe(7)
    })

    it('serves only dinners', () => {
      for (const meal of weekMeals(week)) {
        expect(meal.suitableFor, meal.name).toContain('dinner')
      }
    })

    it('covers at least two protein types', () => {
      const proteins = new Set(weekMeals(week).map((meal) => meal.primaryProteinType))
      expect(proteins.size).toBeGreaterThanOrEqual(2)
    })

    it('has a fish dinner unless it is vegetarian', () => {
      const fish = weekMeals(week).filter((meal) => meal.primaryProteinType === 'fish')
      if ('diet' in week) expect(fish).toHaveLength(0)
      else expect(fish.length).toBeGreaterThanOrEqual(1)
    })

    it('carries a waitlist ref the request-invite route keeps', () => {
      expect(week.ref).toMatch(WAITLIST_REF_PATTERN)
    })
  })

  it('keeps the kid-friendly weeks kid-friendly', () => {
    for (const slug of ['two-adults-and-a-toddler', 'one-adult-two-kids', 'kid-friendly-week']) {
      for (const meal of weekMeals(findSampleWeek(slug)!)) {
        expect(meal.kidFriendly, `${slug}: ${meal.name}`).toBe(true)
      }
    }
  })

  it('keeps the one-adult week at 45 minutes or less', () => {
    for (const meal of weekMeals(findSampleWeek('one-adult-two-kids')!)) {
      expect(meal.timeMinutes, meal.name).toBeLessThanOrEqual(45)
    }
  })

  it('keeps the thirty-minute week at 30 minutes or less', () => {
    for (const meal of weekMeals(findSampleWeek('thirty-minute-dinners')!)) {
      expect(meal.timeMinutes, meal.name).toBeLessThanOrEqual(30)
    }
  })

  it('keeps meat, fish and shellfish out of every component of the vegetarian week', () => {
    const week = findSampleWeek('vegetarian-week')!
    expect(week.diet).toBe('vegetarian')
    for (const meal of weekMeals(week)) {
      expect(hasMeatOrFish(meal), meal.name).toBe(false)
    }
  })

  it('marks only the vegetarian week vegetarian', () => {
    expect(SAMPLE_WEEKS.filter((week) => 'diet' in week).map((week) => week.slug)).toEqual([
      'vegetarian-week',
    ])
  })

  it('catches a meat component in a meal', () => {
    // The vegetarian check itself, so a broken lookup cannot pass every meal.
    expect(hasMeatOrFish(seedMeal('Spaghetti Bolognese'))).toBe(true)
  })
})

describe('findSampleWeek', () => {
  it('returns the week for a known slug and nothing for any other', () => {
    expect(findSampleWeek('vegetarian-week')?.ref).toBe('mp-vegetarian-week')
    expect(findSampleWeek('nut-free-week')).toBeUndefined()
  })
})

describe('sampleWeekServings', () => {
  it.each([
    [{ adults: 2, children: 2 }, 3],
    [{ adults: 2, children: 1 }, 2.5],
    [{ adults: 1, children: 2 }, 2],
  ])('cooks %o for %d servings', (household, servings) => {
    expect(sampleWeekServings({ household })).toBe(servings)
  })
})
