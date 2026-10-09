import { describe, expect, it } from 'vitest'
import {
  findPreferenceConflicts,
  type ConflictCheckedMeal,
  type ConflictPreferences,
} from './preference-conflicts'

const NO_PREFERENCES: ConflictPreferences = {
  dietaryType: null,
  allergensToAvoid: [],
  excludedIngredients: [],
  excludedIngredientIds: [],
}

function meal(
  name: string,
  components: { id: string; name: string; allergens?: string[] }[],
): ConflictCheckedMeal {
  return {
    name,
    components: components.map((c) => ({
      ingredientId: c.id,
      ingredient: { name: c.name, allergens: c.allergens ?? [] },
    })),
  }
}

describe('findPreferenceConflicts', () => {
  it('finds an avoided allergen from the ingredient data', () => {
    const pesto = meal('Pasta with green sauce', [
      { id: 'pasta', name: 'Pasta', allergens: ['gluten'] },
      { id: 'pine', name: 'Pine kernels', allergens: ['nuts'] },
    ])
    expect(
      findPreferenceConflicts(pesto, { ...NO_PREFERENCES, allergensToAvoid: ['nuts'] }),
    ).toEqual([{ kind: 'allergen', constraint: 'nuts' }])
  })

  it('finds an avoided allergen by the meal name when the ingredients carry no data', () => {
    const salmon = meal('Baked salmon with dill', [
      { id: 'potato', name: 'Potatoes' },
      { id: 'dill', name: 'Dill' },
    ])
    expect(
      findPreferenceConflicts(salmon, { ...NO_PREFERENCES, allergensToAvoid: ['fish'] }),
    ).toEqual([{ kind: 'allergen', constraint: 'fish' }])
  })

  it('finds an avoided allergen by an untagged ingredient name', () => {
    const bowl = meal('Rice bowl', [
      { id: 'rice', name: 'Rice' },
      { id: 'tuna', name: 'Tuna' },
    ])
    expect(
      findPreferenceConflicts(bowl, { ...NO_PREFERENCES, allergensToAvoid: ['fish'] }),
    ).toEqual([{ kind: 'allergen', constraint: 'fish' }])
  })

  it('trusts the allergen data over the name for a tagged ingredient', () => {
    // "Barista milk" names a dairy keyword; the data says it is soy.
    const latte = meal('Latte', [{ id: 'milk', name: 'Barista milk', allergens: ['soy'] }])
    expect(
      findPreferenceConflicts(latte, { ...NO_PREFERENCES, allergensToAvoid: ['dairy'] }),
    ).toEqual([])
  })

  it('finds a dietary type the meal breaks', () => {
    const omelette = meal('Vegetable omelette', [
      { id: 'egg', name: 'Eggs', allergens: ['eggs'] },
      { id: 'cheese', name: 'Cheddar cheese', allergens: ['dairy'] },
    ])
    expect(findPreferenceConflicts(omelette, { ...NO_PREFERENCES, dietaryType: 'vegan' })).toEqual([
      { kind: 'diet', constraint: 'vegan' },
    ])
  })

  it('does not read the meal name for the diet', () => {
    const mac = meal('Vegan mac and cheese', [
      { id: 'pasta', name: 'Macaroni' },
      { id: 'oat', name: 'Oat milk' },
    ])
    expect(findPreferenceConflicts(mac, { ...NO_PREFERENCES, dietaryType: 'vegan' })).toEqual([])
  })

  it('finds an avoided ingredient by id', () => {
    const risotto = meal('Risotto', [
      { id: 'rice', name: 'Arborio rice' },
      { id: 'mushroom', name: 'Mushrooms' },
    ])
    expect(
      findPreferenceConflicts(risotto, { ...NO_PREFERENCES, excludedIngredientIds: ['mushroom'] }),
    ).toEqual([{ kind: 'excluded', constraint: 'Mushrooms' }])
  })

  it('finds an avoided ingredient by name when no id was resolved', () => {
    const risotto = meal('Risotto', [{ id: 'mushroom', name: 'Mushrooms' }])
    expect(
      findPreferenceConflicts(risotto, { ...NO_PREFERENCES, excludedIngredients: [' mushrooms '] }),
    ).toEqual([{ kind: 'excluded', constraint: 'Mushrooms' }])
  })

  it('returns one conflict per constraint', () => {
    const nutty = meal('Walnut and almond salad', [
      { id: 'walnut', name: 'Walnuts', allergens: ['nuts'] },
      { id: 'almond', name: 'Almonds', allergens: ['nuts'] },
      { id: 'olive', name: 'Olives' },
      { id: 'onion', name: 'Red onion' },
    ])
    expect(
      findPreferenceConflicts(nutty, {
        ...NO_PREFERENCES,
        allergensToAvoid: ['nuts'],
        excludedIngredientIds: ['olive', 'onion'],
      }),
    ).toEqual([
      { kind: 'allergen', constraint: 'nuts' },
      { kind: 'excluded', constraint: 'Olives' },
    ])
  })

  it('returns nothing when the household has no food preferences', () => {
    const chicken = meal('Roast chicken', [
      { id: 'chicken', name: 'Chicken thighs' },
      { id: 'butter', name: 'Butter', allergens: ['dairy'] },
    ])
    expect(findPreferenceConflicts(chicken, NO_PREFERENCES)).toEqual([])
  })
})
