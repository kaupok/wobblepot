import { describe, expect, it } from 'vitest'
import {
  applyJudgeFilters,
  buildJudgeV2Prompt,
  computePassV2,
  dropListedExtras,
  dropServingware,
  visibleIngredients,
  type JudgeV2Findings,
} from './judge'
import type { MealImageComponent, MealImageMeal } from './prompt'

const g = (name: string, quantity: number): MealImageComponent => ({ name, quantity, unit: 'g' })
const ml = (name: string, quantity: number): MealImageComponent => ({ name, quantity, unit: 'ml' })

// Trap meals from the spike (scripts/spike-meal-images.ts).
const greekSalad: MealImageMeal = {
  name: 'Greek Salad with Feta',
  description: 'Fresh salad with tomatoes, cucumber, and feta cheese',
  components: [
    g('feta cheese', 100),
    g('tomato', 120),
    g('cucumber', 100),
    g('onion', 30),
    ml('olive oil', 20),
  ],
}

const lentilBolognese: MealImageMeal = {
  name: 'Lentil Bolognese',
  description: 'Hearty green-lentil ragù with spaghetti',
  components: [
    g('green lentils', 80),
    g('spaghetti', 100),
    g('tomato sauce', 150),
    g('onion', 50),
    g('carrot', 40),
    g('celery', 30),
    g('garlic', 5),
  ],
}

const lambStew: MealImageMeal = {
  name: 'Irish Lamb Stew',
  description: 'Hearty lamb and potato stew',
  components: [
    g('lamb shank', 200),
    g('potato', 150),
    g('carrot', 80),
    g('onion', 60),
    ml('beef stock', 300),
    g('thyme', 3),
  ],
}

const chickenThighs: MealImageMeal = {
  name: 'Baked Chicken Thighs',
  description: 'Herb-roasted chicken thighs with potatoes',
  components: [
    g('chicken thigh', 200),
    g('potato', 150),
    ml('olive oil', 15),
    g('rosemary', 2),
    g('thyme', 2),
    g('garlic', 10),
  ],
  preparationNotes: 'Cut the potatoes into 2cm cubes and pile the shredded chicken over them.',
}

const findings = (over: Partial<JudgeV2Findings> = {}): JudgeV2Findings => ({
  extraIngredients: [],
  propsOrCookware: [],
  missingIngredients: [],
  portion: 'one-serving',
  ...over,
})

describe('visibleIngredients', () => {
  it('never asks the judge about ingredients that vanish once cooked', () => {
    expect(visibleIngredients(lambStew)).toEqual(['lamb shank', 'potato', 'carrot', 'onion'])
    expect(
      visibleIngredients({
        components: [g('bell pepper', 60), g('black pepper', 1), ml('olive oil', 15)],
      }),
    ).toEqual(['bell pepper'])
  })

  it('does not hide sausage behind sage', () => {
    expect(visibleIngredients({ components: [g('italian sausage', 100), g('sage', 2)] })).toEqual([
      'italian sausage',
    ])
  })
})

describe('buildJudgeV2Prompt', () => {
  it('gives the judge the full list, the invisible marks and the notes, and no prep steps', () => {
    const prompt = buildJudgeV2Prompt(chickenThighs)
    expect(prompt).toContain('- potato: 150g\n')
    expect(prompt).toMatch(/- garlic: \d+g \(may not be visible\)/)
    expect(prompt).toContain(chickenThighs.preparationNotes!)
    expect(prompt).not.toContain('Preparation steps shown to the user')
  })

  it('rounds a divided quantity and survives a missing description', () => {
    const prompt = buildJudgeV2Prompt({
      name: 'Imagined',
      description: null,
      components: [g('carrot', 100 / 3)],
    })
    expect(prompt).toContain('- carrot: 33.3g')
    expect(prompt).toContain('Meal: Imagined\n')
  })
})

describe('dropListedExtras', () => {
  it('drops an extra that names a listed ingredient, and keeps a real one', () => {
    const tacos = {
      components: [
        g('sour cream', 30),
        g('greek yogurt', 50),
        { name: 'lime', quantity: 0.5, unit: 'piece' },
      ],
    }
    expect(
      dropListedExtras(['sour cream', 'yogurt sauce with herbs', 'lime wedge', 'olives'], tacos),
    ).toEqual(['olives'])
  })

  it('does not excuse an unlisted food that shares a word with a listed one', () => {
    expect(
      dropListedExtras(['black olive slices', 'parmesan cheese', 'oregano'], greekSalad),
    ).toEqual(['black olive slices', 'parmesan cheese', 'oregano'])
    expect(dropListedExtras(['green olives'], lentilBolognese)).toEqual(['green olives'])
    expect(dropListedExtras(['crumbled feta', 'tomatoes'], greekSalad)).toEqual([])
  })
})

describe('dropServingware', () => {
  it('drops only the serving plate, skewers and a listed garnish from props', () => {
    const kept = [
      'raw carrot and celery on a cutting board',
      'small bowl of grated parmesan beside the plate',
      'casserole dish',
      'fork',
    ]
    expect(
      dropServingware(['plate', 'metal skewers', 'lime wedge', ...kept], {
        components: [{ name: 'lime', quantity: 0.5, unit: 'piece' }],
      }),
    ).toEqual(kept)
  })
})

describe('computePassV2', () => {
  it('fails only on serious findings and reports the strict verdict beside it', () => {
    expect(computePassV2(findings())).toEqual({ pass: true, strictPass: true })
    expect(computePassV2(findings({ missingIngredients: ['onion'] }))).toEqual({
      pass: true,
      strictPass: false,
    })
    expect(computePassV2(findings({ portion: 'several-servings' })).strictPass).toBe(false)
    expect(computePassV2(findings({ extraIngredients: ['olives'] })).pass).toBe(false)
    expect(computePassV2(findings({ propsOrCookware: ['fork'] })).pass).toBe(false)
  })
})

describe('applyJudgeFilters', () => {
  it('keeps the raw findings beside the filtered ones', () => {
    const raw = findings({
      extraIngredients: ['crumbled feta', 'olives'],
      propsOrCookware: ['plate'],
    })

    const verdict = applyJudgeFilters(raw, greekSalad)

    expect(verdict.raw).toBe(raw)
    expect(verdict.filtered.extraIngredients).toEqual(['olives'])
    expect(verdict.filtered.propsOrCookware).toEqual([])
    expect(verdict.pass).toBe(false)
  })

  it('passes an image whose only extras were listed ingredients', () => {
    const verdict = applyJudgeFilters(
      findings({ extraIngredients: ['tomatoes'], missingIngredients: ['onion'] }),
      greekSalad,
    )

    expect(verdict).toMatchObject({ pass: true, strictPass: false })
    expect(verdict.raw.extraIngredients).toEqual(['tomatoes'])
  })
})
