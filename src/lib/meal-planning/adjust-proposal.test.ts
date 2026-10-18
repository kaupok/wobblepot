import { describe, expect, it } from 'vitest'
import type { AdjustRecipeChange } from '@/lib/ai/adjust-recipe'
import { buildChangeSet, pickedQuantity, resolveChanges } from './adjust-proposal'

// A cream pasta with mushrooms, after the household replaced the cream with
// yoghurt (change c1) and added chilli (change c2).
const components = [
  { ingredientId: 'pasta', name: 'pasta' },
  { ingredientId: 'yoghurt', name: 'Greek yoghurt' },
  { ingredientId: 'mushroom', name: 'mushroom' },
  { ingredientId: 'chilli', name: 'chilli' },
]
const live = [
  { id: 'c1', originalIngredientId: 'cream', replacementIngredientId: 'yoghurt' },
  { id: 'c2', originalIngredientId: null, replacementIngredientId: 'chilli' },
]

const change = (fields: Partial<AdjustRecipeChange>): AdjustRecipeChange => ({
  op: 'replace',
  original: null,
  replacement: null,
  quantityPerServing: null,
  unit: null,
  reason: 'Because.',
  ...fields,
})

describe('resolveChanges', () => {
  it('resolves a recipe ingredient by name, ignoring case and a plural', () => {
    expect(
      resolveChanges([change({ op: 'remove', original: 'Mushrooms' })], components, live),
    ).toEqual([
      {
        op: 'remove',
        original: { id: 'mushroom', name: 'mushroom' },
        originalIngredientId: 'mushroom',
        replacesChangeId: null,
        replacement: null,
        reason: 'Because.',
      },
    ])
  })

  it('points a change to a replacement at the recipe ingredient and the change it supersedes', () => {
    const [resolved] = resolveChanges(
      [
        change({
          original: 'greek yoghurt',
          replacement: 'skyr',
          quantityPerServing: 40,
          unit: 'g',
        }),
      ],
      components,
      live,
    )

    expect(resolved).toMatchObject({
      original: { id: 'yoghurt', name: 'Greek yoghurt' },
      originalIngredientId: 'cream',
      replacesChangeId: 'c1',
      replacement: { name: 'skyr', quantity: 40, unit: 'g' },
    })
  })

  it('gives a change to an added ingredient no recipe original', () => {
    const [resolved] = resolveChanges(
      [change({ op: 'remove', original: 'chilli' })],
      components,
      live,
    )

    expect(resolved).toMatchObject({ originalIngredientId: null, replacesChangeId: 'c2' })
  })

  it('drops an unknown original, a second change to one ingredient, and a replace with no amount', () => {
    const resolved = resolveChanges(
      [
        change({ op: 'remove', original: 'cheese' }),
        change({ op: 'remove', original: 'pasta' }),
        change({ original: 'pasta', replacement: 'rice', quantityPerServing: 80, unit: 'g' }),
        change({ original: 'mushroom', replacement: 'courgette', unit: 'g' }),
        change({ op: 'add', replacement: 'basil', quantityPerServing: 2, unit: null }),
      ],
      components,
      live,
    )

    expect(resolved.map((r) => [r.op, r.original?.id])).toEqual([['remove', 'pasta']])
  })

  it('keeps an add with its amount and unit', () => {
    expect(
      resolveChanges(
        [change({ op: 'add', replacement: ' smoked paprika ', quantityPerServing: 1, unit: 'g' })],
        components,
        live,
      ),
    ).toEqual([
      {
        op: 'add',
        original: null,
        originalIngredientId: null,
        replacesChangeId: null,
        replacement: { name: 'smoked paprika', quantity: 1, unit: 'g' },
        reason: 'Because.',
      },
    ])
  })
})

describe('pickedQuantity', () => {
  it('keeps the amount when the units agree', () => {
    expect(pickedQuantity({ quantity: 60, unit: 'g' }, { defaultUnit: 'g' })).toBe(60)
  })

  it('converts grams to pieces by the picked ingredient’s weight', () => {
    expect(
      pickedQuantity({ quantity: 120, unit: 'g' }, { defaultUnit: 'piece', gramsPerPiece: 60 }),
    ).toBe(2)
  })

  it('keeps a tiny converted amount storable rather than rounding it to 0', () => {
    expect(
      pickedQuantity({ quantity: 1, unit: 'g' }, { defaultUnit: 'piece', gramsPerPiece: 1000 }),
    ).toBe(0.01)
  })

  it('converts pieces to grams with the default piece weight when none is stored', () => {
    expect(pickedQuantity({ quantity: 2, unit: 'piece' }, { defaultUnit: 'g' })).toBe(60)
  })
})

describe('buildChangeSet', () => {
  const stored = [
    {
      id: 'c1',
      original: { id: 'cream' },
      replacement: { id: 'yoghurt' },
      quantityPerServing: 50,
      stale: false,
    },
    {
      id: 'c2',
      original: null,
      replacement: { id: 'chilli' },
      quantityPerServing: 1,
      stale: false,
    },
    {
      id: 'c3',
      original: { id: 'gone' },
      replacement: null,
      quantityPerServing: null,
      stale: true,
    },
  ]

  it('keeps the changes no proposal touches, drops stale ones, and appends the accepted rows', () => {
    expect(
      buildChangeSet(stored, [
        {
          proposal: { op: 'remove', originalIngredientId: 'mushroom', replacesChangeId: null },
          replacementIngredientId: null,
          quantityPerServing: null,
        },
        {
          proposal: { op: 'add', originalIngredientId: null, replacesChangeId: null },
          replacementIngredientId: 'basil',
          quantityPerServing: 2,
        },
      ]),
    ).toEqual([
      { originalIngredientId: 'cream', replacementIngredientId: 'yoghurt', quantityPerServing: 50 },
      { originalIngredientId: null, replacementIngredientId: 'chilli', quantityPerServing: 1 },
      { originalIngredientId: 'mushroom', replacementIngredientId: null, quantityPerServing: null },
      { originalIngredientId: null, replacementIngredientId: 'basil', quantityPerServing: 2 },
    ])
  })

  it('swaps a superseded replacement for the new one on the same recipe ingredient', () => {
    expect(
      buildChangeSet(stored.slice(0, 1), [
        {
          proposal: { op: 'replace', originalIngredientId: 'cream', replacesChangeId: 'c1' },
          replacementIngredientId: 'skyr',
          quantityPerServing: 40,
        },
      ]),
    ).toEqual([
      { originalIngredientId: 'cream', replacementIngredientId: 'skyr', quantityPerServing: 40 },
    ])
  })

  it('drops an added ingredient on remove, and restores the recipe ingredient on a swap back', () => {
    expect(
      buildChangeSet(stored.slice(0, 2), [
        {
          proposal: { op: 'remove', originalIngredientId: null, replacesChangeId: 'c2' },
          replacementIngredientId: null,
          quantityPerServing: null,
        },
        {
          proposal: { op: 'replace', originalIngredientId: 'cream', replacesChangeId: 'c1' },
          replacementIngredientId: 'cream',
          quantityPerServing: 50,
        },
      ]),
    ).toEqual([])
  })

  it('turns a replace of an added ingredient into a new add', () => {
    expect(
      buildChangeSet(stored.slice(1, 2), [
        {
          proposal: { op: 'replace', originalIngredientId: null, replacesChangeId: 'c2' },
          replacementIngredientId: 'paprika',
          quantityPerServing: 1,
        },
      ]),
    ).toEqual([
      { originalIngredientId: null, replacementIngredientId: 'paprika', quantityPerServing: 1 },
    ])
  })
})
