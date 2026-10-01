// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { RecipeExtraction } from '../../src/lib/ai/recipe-schema'
import type { CaseOf } from './case-schema'
import { loadCases } from './load-cases'
import {
  countNumberedLines,
  derivePlanContext,
  scoreImagine,
  scorePlan,
  scoreRecipe,
  scoreReview,
  scoreTips,
} from './scorers'

function starter<T extends 'plan' | 'recipe' | 'imagine' | 'review' | 'tips'>(
  task: T,
  id: string,
): CaseOf<T>['input'] {
  const found = loadCases([task]).find((c) => c.id === `${task}/${id}`)
  if (!found) throw new Error(`No starter case ${task}/${id}`)
  return found.input as CaseOf<T>['input']
}

describe('scorePlan', () => {
  const input = starter('plan', 'en-week-no-diet')
  const ctx = derivePlanContext(input)

  // No dietary type: fish on Wed 7th, legume on Sat 10th, and no two
  // consecutive dinners share a protein.
  const valid = [
    ['2026-10-05', 'm-any-1'], // poultry
    ['2026-10-06', 'm-any-2'], // beef
    ['2026-10-07', 'm-fish-1'], // fish
    ['2026-10-08', 'm-any-3'], // pork
    ['2026-10-09', 'm-any-4'], // poultry
    ['2026-10-10', 'm-leg-1'], // legume
    ['2026-10-11', 'm-any-6'], // eggs
  ] as const
  const plan = (rows: readonly (readonly [string, string])[]) => ({
    entries: rows.map(([date, mealId]) => ({ date, mealType: 'dinner' as const, mealId })),
  })

  it('derives the required slots from the slot rules', () => {
    expect(ctx.slots).toHaveLength(7)
    expect(ctx.requiredSlots.map((s) => [s.date.getDate(), s.proteinType])).toEqual([
      [7, 'fish'],
      [10, 'legume'],
    ])
  })

  it('scores a valid plan as valid on the first try', () => {
    expect(scorePlan(ctx, plan(valid))).toEqual({
      structureValid: 1,
      firstTryValid: 1,
      validAfterRepair: 1,
      outOfPoolIds: 0,
      dinnerProteinVariety: 6,
    })
  })

  it('detects an out-of-pool meal ID', () => {
    const rows = valid.map((r, i) => (i === 1 ? ([r[0], 'm-not-a-candidate'] as const) : r))
    const scores = scorePlan(ctx, plan(rows))
    expect(scores.outOfPoolIds).toBe(1)
    expect(scores.firstTryValid).toBe(0)
  })

  it('separates first-try validity from validity after repair', () => {
    // Lamb where the fish slot is: invalid as returned, repairable from the fish pool.
    const rows = valid.map((r, i) => (i === 2 ? ([r[0], 'm-any-5'] as const) : r))
    const scores = scorePlan(ctx, plan(rows))
    expect(scores.firstTryValid).toBe(0)
    expect(scores.validAfterRepair).toBe(1)
  })

  it('fails the structure check on a missing slot', () => {
    const scores = scorePlan(ctx, plan(valid.slice(0, 6)))
    expect(scores).toMatchObject({ structureValid: 0, firstTryValid: 0, validAfterRepair: 0 })
  })

  it('fails everything on a date it cannot parse', () => {
    const rows = valid.map((r, i) => (i === 0 ? (['Monday', r[1]] as const) : r))
    expect(scorePlan(ctx, plan(rows))).toMatchObject({
      structureValid: 0,
      firstTryValid: 0,
      dinnerProteinVariety: null,
    })
  })
})

describe('scoreRecipe', () => {
  const input = starter('recipe', 'en-carbonara')

  const ing = (
    name: string,
    quantity: number | null,
    unit: RecipeExtraction['ingredients'][number]['unit'],
  ) => ({
    name,
    quantity,
    unit,
    originalText: name,
    isVague: quantity === null,
    vaguePhrase: quantity === null ? 'to taste' : null,
    isDried: null,
  })

  const perfect: RecipeExtraction = {
    name: 'Spaghetti carbonara',
    description: null,
    preparationNotes: '1. Boil.\n2. Fry.\n3. Whisk.\n4. Drain.\n5. Toss.',
    timeMinutes: 25,
    servings: 4,
    mealTypes: ['dinner'],
    kidFriendly: true,
    recipeConfidence: 95,
    ingredients: [
      ing('spaghetti', 400, 'g'),
      ing('pancetta', 150, 'g'),
      ing('Egg ', 3, 'piece'),
      ing('parmesan cheese', 50, 'g'),
      ing('garlic', 2, 'piece'),
      ing('salt', null, null),
      ing('black pepper', null, null),
    ],
  }

  it('scores a correct extraction', () => {
    expect(scoreRecipe(input, perfect)).toEqual({
      recall: 1,
      precision: 1,
      quantityUnitMatch: 1,
      confidenceAgrees: 1,
      stepCountDelta: 0,
    })
  })

  it('accepts a plural English name the prompt never asked to singularise', () => {
    const scores = scoreRecipe(input, {
      ...perfect,
      ingredients: perfect.ingredients.map((i) => (i.name === 'Egg ' ? { ...i, name: 'eggs' } : i)),
    })
    expect(scores).toMatchObject({ recall: 1, precision: 1 })
  })

  it('detects a missing ingredient', () => {
    const scores = scoreRecipe(input, {
      ...perfect,
      ingredients: perfect.ingredients.filter((i) => i.name !== 'pancetta'),
    })
    expect(scores.recall).toBeCloseTo(6 / 7)
    expect(scores.precision).toBe(1)
  })

  it('detects an invented ingredient and a duplicate as lost precision', () => {
    const scores = scoreRecipe(input, {
      ...perfect,
      ingredients: [...perfect.ingredients, ing('cream', 200, 'ml'), ing('garlic', 2, 'piece')],
    })
    expect(scores.recall).toBe(1)
    expect(scores.precision).toBeCloseTo(7 / 9)
  })

  it('detects a wrong quantity or unit', () => {
    const scores = scoreRecipe(input, {
      ...perfect,
      ingredients: perfect.ingredients.map((i) =>
        i.name === 'garlic' ? ing('garlic', 10, 'g') : i,
      ),
    })
    expect(scores.quantityUnitMatch).toBeCloseTo(6 / 7)
  })

  it('detects a confidence tier that disagrees, and reports the step delta', () => {
    const scores = scoreRecipe(input, {
      ...perfect,
      recipeConfidence: 10,
      preparationNotes: '1. Cook everything.',
    })
    expect(scores.confidenceAgrees).toBe(0)
    expect(scores.stepCountDelta).toBe(-4)
  })

  describe('on a not-a-recipe case', () => {
    const notARecipe = starter('recipe', 'en-not-a-recipe-restaurant-review')
    const rejected: RecipeExtraction = {
      ...perfect,
      name: 'Harbour Kitchen',
      preparationNotes: null,
      recipeConfidence: 10,
      ingredients: [],
    }

    it('scores only the confidence tier', () => {
      expect(notARecipe.expected.ingredients).toEqual([])
      expect(scoreRecipe(notARecipe, rejected)).toEqual({
        recall: null,
        precision: null,
        quantityUnitMatch: null,
        confidenceAgrees: 1,
        stepCountDelta: null,
      })
    })

    it('still fails a parse the app would accept', () => {
      const scores = scoreRecipe(notARecipe, {
        ...rejected,
        recipeConfidence: 95,
        ingredients: [ing('beetroot', null, null)],
      })
      expect(scores).toMatchObject({ recall: null, precision: null, confidenceAgrees: 0 })
    })
  })
})

describe('countNumberedLines', () => {
  it('counts only lines that start a numbered step', () => {
    expect(countNumberedLines('1. a\n2) b\nnot a step\n  3. c\n4 degrees')).toBe(3)
    expect(countNumberedLines(null)).toBe(0)
  })
})

describe('scoreImagine', () => {
  const input = starter('imagine', 'en-chicken-rice-weeknight')
  const meal = (ingredients: string[], servings = 4) => ({
    name: 'Chicken and rice',
    description: null,
    timeMinutes: 40,
    servings,
    mealTypes: ['dinner' as const],
    kidFriendly: true,
    ingredients: ingredients.map((name) => ({
      name,
      quantity: 100,
      unit: 'g' as const,
      originalText: name,
      isVague: false,
      vaguePhrase: null,
      isDried: null,
    })),
  })
  const good = [
    meal(['chicken thigh', 'rice']),
    meal(['chicken breast', 'rice', 'leek']),
    meal(['chicken', 'rice']),
  ]

  it('passes three valid meals', () => {
    expect(scoreImagine(input, { meals: good }).allChecksPass).toBe(1)
  })

  it('detects two meals instead of three', () => {
    const scores = scoreImagine(input, { meals: good.slice(0, 2) })
    expect(scores.exactlyThreeMeals).toBe(0)
    expect(scores.allChecksPass).toBe(0)
  })

  it('detects wrong servings, a one-ingredient meal and a forbidden ingredient', () => {
    const scores = scoreImagine(input, {
      meals: [meal(['chicken', 'rice'], 2), meal(['rice']), meal(['chicken', 'Peanut butter'])],
    })
    expect(scores).toEqual({
      allChecksPass: 0,
      exactlyThreeMeals: 1,
      servingsMatch: 0,
      minTwoIngredients: 0,
      noForbiddenIngredients: 0,
    })
  })
})

describe('the Estonian vegetarian imagine case', () => {
  const input = starter('imagine', 'et-vegetarian-lentils')
  const meals = (ingredient: string) =>
    Array.from({ length: 3 }, () => ({
      name: 'Läätsesupp',
      description: null,
      timeMinutes: 30,
      servings: 3,
      mealTypes: ['dinner' as const],
      kidFriendly: true,
      ingredients: ['punane lääts', ingredient].map((name) => ({
        name,
        quantity: 100,
        unit: 'g' as const,
        originalText: name,
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      })),
    }))

  it.each(['kanamuna', 'sojahakkliha', 'köögiviljapuljong', 'kalamata oliiv'])(
    'allows %s',
    (name) => {
      expect(scoreImagine(input, { meals: meals(name) }).noForbiddenIngredients).toBe(1)
    },
  )

  it.each([
    'kanafilee',
    'sink',
    'verivorst',
    'kuningkrevett',
    'seahakkliha',
    'luupuljong',
    'tursk',
  ])('flags %s', (name) => {
    expect(scoreImagine(input, { meals: meals(name) }).noForbiddenIngredients).toBe(0)
  })
})

describe('allowedQualifiers in the vegan imagine cases', () => {
  const meals = (servings: number, ...names: string[]) =>
    Array.from({ length: 3 }, () => ({
      name: 'Vegan dish',
      description: null,
      timeMinutes: 30,
      servings,
      mealTypes: ['dinner' as const],
      kidFriendly: true,
      ingredients: ['pasta', ...names].map((name) => ({
        name,
        quantity: 100,
        unit: 'g' as const,
        originalText: name,
        isVague: false,
        vaguePhrase: null,
        isDried: null,
      })),
    }))

  describe('en', () => {
    const input = starter('imagine', 'en-vegan-creamy-pasta')
    const score = (...names: string[]) =>
      scoreImagine(input, { meals: meals(2, ...names) }).noForbiddenIngredients

    it.each([
      'Vegan parmesan',
      'tempeh bacon',
      'plant-based cream cheese',
      'cashew ricotta',
      'vegan cheddar cheese',
      'non-dairy milk',
      'oat milk',
      'oatmilk',
      'soya milk',
      'hemp milk',
      'nut butter',
      'plant butter',
      'peanut butter',
      'flax egg',
      // Not swaps, but a plain keyword would catch them.
      'eggplant',
      'veggie stock',
      'butternut squash',
      'collard greens',
      'honeydew melon',
    ])('allows %s', (name) => {
      expect(score(name)).toBe(1)
    })

    it.each([
      'parmesan',
      'Parmigiano-Reggiano',
      'bacon',
      'Sour cream',
      'egg yolk',
      '2 large eggs',
      'butter',
      'milk',
      'cheese',
    ])('flags a plain %s', (name) => {
      expect(score(name)).toBe(0)
    })

    it('does not let a qualifier after the keyword excuse it', () => {
      expect(score('honey soy sauce')).toBe(0)
      expect(score('honey-roasted cashews')).toBe(0)
      expect(score('parmesan (vegan)')).toBe(0)
    })

    it('does not let a qualifier excuse a keyword further along the name', () => {
      expect(score('coconut milk and butter')).toBe(0)
      expect(score('soy-honey glaze')).toBe(0)
    })

    it('does not match a qualifier inside another word', () => {
      expect(score('goat milk')).toBe(0)
    })

    it('does not let one qualified swap excuse an unrelated violation', () => {
      expect(score('tofu bacon', 'bacon')).toBe(0)
      expect(score('vegan parmesan', 'mozzarella')).toBe(0)
    })
  })

  describe('et', () => {
    const input = starter('imagine', 'et-vegan-sour-cream')
    const score = (...names: string[]) =>
      scoreImagine(input, { meals: meals(4, ...names) }).noForbiddenIngredients

    it.each([
      'taimne hapukoor',
      'kaerahapukoor',
      'porgandilõhe',
      'munavaba majonees',
      'sojavorst',
      'kalamata oliivid',
      'kaerapiim',
      'riisipiim',
      'kašujuust',
      'taimsed viinerid',
      'taimset juustu',
    ])('allows %s', (name) => {
      expect(score(name)).toBe(1)
    })

    it.each(['hapukoor', 'muna', 'kanamuna', 'suitsukala', 'lõhe', 'viiner', 'juust', 'piim'])(
      'flags a plain %s',
      (name) => {
        expect(score(name)).toBe(0)
      },
    )

    it('does not let one qualified swap excuse an unrelated violation', () => {
      expect(score('taimne hapukoor', 'hapukoor')).toBe(0)
      expect(score('kookospiim ja kanamuna')).toBe(0)
      expect(score('kalamata oliivid ja parmesan')).toBe(0)
    })
  })

  it('scores a case without allowedQualifiers as a plain substring match', () => {
    const input = starter('imagine', 'en-vegan-creamy-pasta')
    const { allowedQualifiers: _, ...unqualified } = input
    expect(
      scoreImagine(unqualified, { meals: meals(2, 'vegan parmesan') }).noForbiddenIngredients,
    ).toBe(0)
    expect(scoreImagine(unqualified, { meals: meals(2, 'penne') }).noForbiddenIngredients).toBe(1)
  })
})

describe('scoreReview', () => {
  const input = starter('review', 'en-chicken-stir-fry')
  const reviewed = (overrides: Record<string, number>) => ({
    ingredients: input.ingredients.map((i) => ({
      ingredientId: i.ingredientId,
      quantityPerServing: overrides[i.ingredientId] ?? i.quantityPerServing,
    })),
  })

  it('scores corrected seeded errors and kept quantities', () => {
    expect(scoreReview(input, reviewed({ 'ing-soy': 18, 'ing-rice': 70 }))).toEqual({
      allIdsOnce: 1,
      seededCorrected: 1,
      unchangedKept: 1,
    })
  })

  it('fails every-ID-once on an ID the input never had', () => {
    const output = reviewed({})
    output.ingredients.push({ ingredientId: 'ing-invented', quantityPerServing: 5 })
    expect(scoreReview(input, output).allIdsOnce).toBe(0)
  })

  it('detects a change to an ingredient marked unchanged', () => {
    const scores = scoreReview(
      input,
      reviewed({ 'ing-soy': 15, 'ing-rice': 75, 'ing-chicken': 120 }),
    )
    expect(scores.unchangedKept).toBeCloseTo(2 / 3)
  })

  it('accepts either end of a range the prompt gives, and nothing outside it', () => {
    // Soy is seeded as 10–20 g: the review prompt's condiment range.
    expect(scoreReview(input, reviewed({ 'ing-soy': 10, 'ing-rice': 80 })).seededCorrected).toBe(1)
    expect(scoreReview(input, reviewed({ 'ing-soy': 20, 'ing-rice': 65 })).seededCorrected).toBe(1)
    expect(scoreReview(input, reviewed({ 'ing-soy': 9, 'ing-rice': 70 })).seededCorrected).toBe(0.5)
  })

  it('accepts a single expected value within ±25%, and detects one outside it', () => {
    const single = { ...input, expected: { 'ing-rice': { quantityPerServing: 75 } } }
    expect(scoreReview(single, reviewed({ 'ing-rice': 90 })).seededCorrected).toBe(1)
    expect(scoreReview(single, reviewed({ 'ing-rice': 40 })).seededCorrected).toBe(0)
  })

  it('detects a missing and a duplicated ingredient ID', () => {
    const base = reviewed({ 'ing-soy': 15, 'ing-rice': 75 }).ingredients
    expect(scoreReview(input, { ingredients: base.slice(1) }).allIdsOnce).toBe(0)
    expect(scoreReview(input, { ingredients: [...base, base[0]!] }).allIdsOnce).toBe(0)
  })
})

describe('scoreTips', () => {
  const full = starter('tips', 'en-full-bolognese')
  const supplementary = starter('tips', 'et-supplementary-ahjulohe')
  const items = (n: number) => Array.from({ length: n }, (_, i) => `item ${i + 1}`)

  it('passes full tips within every range', () => {
    const scores = scoreTips(full, { equipment: items(4), steps: items(5), pitfalls: items(2) })
    expect(scores.countsInRange).toBe(1)
  })

  it('detects full tips with 9 steps', () => {
    const scores = scoreTips(full, { equipment: items(4), steps: items(9), pitfalls: items(2) })
    expect(scores.countsInRange).toBe(0)
  })

  it('detects supplementary tips with an empty tip or too many pitfalls', () => {
    expect(
      scoreTips(supplementary, { pitfalls: items(2), tip: 'Pat the salmon dry.' }).countsInRange,
    ).toBe(1)
    expect(scoreTips(supplementary, { pitfalls: items(2), tip: '  ' }).countsInRange).toBe(0)
    expect(scoreTips(supplementary, { pitfalls: items(4), tip: 'x' }).countsInRange).toBe(0)
  })
})
