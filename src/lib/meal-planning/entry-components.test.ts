import { describe, it, expect } from 'vitest'
import {
  applyEntryChanges,
  changeSetKey,
  staleChangeIds,
  type EntryChangeRow,
  type MergeableComponent,
} from './entry-components'

type Ing = { name: string }

const comp = (ingredientId: string, quantityPerServing: number): MergeableComponent<Ing> => ({
  ingredientId,
  quantityPerServing,
  ingredient: { name: ingredientId },
})

const change = (
  id: string,
  originalIngredientId: string | null,
  replacementIngredientId: string | null,
  quantityPerServing: number | null = null,
): EntryChangeRow<Ing> => ({
  id,
  originalIngredientId,
  replacementIngredientId,
  quantityPerServing,
  replacementIngredient: replacementIngredientId ? { name: replacementIngredientId } : null,
})

const MEAL = [comp('pasta', 100), comp('cream', 50), comp('mushroom', 40)]

describe('applyEntryChanges', () => {
  it('returns the meal unchanged without changes', () => {
    expect(applyEntryChanges(MEAL, []).map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['cream', 50],
      ['mushroom', 40],
    ])
  })

  it('swaps a replaced ingredient and its quantity in the original place', () => {
    const merged = applyEntryChanges(MEAL, [change('c1', 'cream', 'yoghurt', 60)])
    expect(merged.map((c) => [c.ingredientId, c.quantityPerServing, c.ingredient.name])).toEqual([
      ['pasta', 100, 'pasta'],
      ['yoghurt', 60, 'yoghurt'],
      ['mushroom', 40, 'mushroom'],
    ])
  })

  it('drops a left-out ingredient', () => {
    const merged = applyEntryChanges(MEAL, [change('c1', 'mushroom', null)])
    expect(merged.map((c) => c.ingredientId)).toEqual(['pasta', 'cream'])
  })

  it('appends added ingredients in change order', () => {
    const merged = applyEntryChanges(MEAL, [
      change('c1', null, 'chili', 2),
      change('c2', null, 'basil', 5),
    ])
    expect(merged.map((c) => [c.ingredientId, c.quantityPerServing])).toEqual([
      ['pasta', 100],
      ['cream', 50],
      ['mushroom', 40],
      ['chili', 2],
      ['basil', 5],
    ])
  })

  it('marks a replacement as a measured amount even when the original was vague', () => {
    const vague = { ...comp('salt', 0), isVague: true, originalPhrase: 'to taste' }
    const [merged] = applyEntryChanges([vague], [change('c1', 'salt', 'soy sauce', 5)])
    expect(merged).toMatchObject({
      ingredientId: 'soy sauce',
      isVague: false,
      originalPhrase: null,
    })
  })

  it('ignores a change whose original is no longer in the meal', () => {
    const merged = applyEntryChanges(MEAL, [change('c1', 'bacon', 'tofu', 30)])
    expect(merged.map((c) => c.ingredientId)).toEqual(['pasta', 'cream', 'mushroom'])
  })
})

describe('a recipe edited after the change', () => {
  // The recipe gained chili after an entry added it, and gained yoghurt after
  // the entry replaced cream with it. Applying either would list it twice.
  const edited = [...MEAL, comp('chili', 3), comp('yoghurt', 30)]
  const changes = [change('c1', null, 'chili', 2), change('c2', 'cream', 'yoghurt', 60)]

  it('ignores a change that brings in an ingredient the recipe now has', () => {
    expect(
      applyEntryChanges(edited, changes).map((c) => [c.ingredientId, c.quantityPerServing]),
    ).toEqual([
      ['pasta', 100],
      ['cream', 50],
      ['mushroom', 40],
      ['chili', 3],
      ['yoghurt', 30],
    ])
  })

  it('names those changes stale', () => {
    expect([...staleChangeIds(edited, changes)]).toEqual(['c1', 'c2'])
  })
})

describe('staleChangeIds', () => {
  it('names only the changes whose original left the meal', () => {
    const stale = staleChangeIds(MEAL, [
      change('c1', 'bacon', 'tofu', 30),
      change('c2', 'cream', null),
      change('c3', null, 'chili', 2),
    ])
    expect([...stale]).toEqual(['c1'])
  })
})

describe('changeSetKey', () => {
  it('reads an undo followed by a new change as moved', () => {
    expect(changeSetKey([{ id: 'a' }, { id: 'b' }])).not.toBe(
      changeSetKey([{ id: 'a' }, { id: 'c' }]),
    )
  })

  it('does not depend on order', () => {
    expect(changeSetKey([{ id: 'b' }, { id: 'a' }])).toBe('a,b')
  })
})
