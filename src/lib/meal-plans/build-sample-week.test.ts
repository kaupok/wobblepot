import { describe, expect, it } from 'vitest'
import {
  buildSampleWeek,
  isoDuration,
  serializeJsonLd,
  type SampleMealInput,
} from './build-sample-week'
import type { SampleWeek } from './sample-weeks'

const WEEK: SampleWeek = {
  slug: 'family-of-four',
  household: { adults: 2, children: 2 },
  ref: 'mp-family-of-four',
  meals: ['Pasta', 'Omelette', 'a', 'b', 'c', 'd', 'e'],
}

const pasta = {
  ingredientId: 'ing-pasta',
  ingredient: {
    id: 'ing-pasta',
    name: 'pasta',
    category: 'carb' as const,
    defaultUnit: 'g' as const,
    gramsPerPiece: null,
    measuredByVolume: false,
  },
}
const egg = {
  ingredientId: 'ing-egg',
  ingredient: {
    id: 'ing-egg',
    name: 'egg',
    category: 'protein' as const,
    defaultUnit: 'piece' as const,
    gramsPerPiece: 60,
    measuredByVolume: false,
  },
}
const milk = {
  ingredientId: 'ing-milk',
  ingredient: {
    id: 'ing-milk',
    name: 'milk',
    category: 'dairy' as const,
    defaultUnit: 'g' as const,
    gramsPerPiece: null,
    measuredByVolume: true,
  },
}
const salt = {
  ingredientId: 'ing-salt',
  ingredient: {
    id: 'ing-salt',
    name: 'salt',
    category: 'spice' as const,
    defaultUnit: 'g' as const,
    gramsPerPiece: null,
    measuredByVolume: false,
  },
}

function meal(overrides: Partial<SampleMealInput>): SampleMealInput {
  return {
    id: 'meal',
    name: 'Meal',
    description: null,
    kidFriendly: true,
    timeMinutes: 30,
    primaryProteinType: 'none',
    imageUrl: null,
    imageStatus: 'none',
    imageHue: null,
    components: [],
    steps: null,
    ...overrides,
  }
}

const MEALS: SampleMealInput[] = [
  meal({
    id: 'm1',
    name: 'Pasta </script><script>alert(1)</script>',
    description: 'Pasta with milk',
    timeMinutes: 90,
    imageUrl: 'https://blob.example/pasta.webp',
    imageStatus: 'ready',
    imageHue: 40,
    steps: ['Boil the pasta.', 'Add the milk.'],
    components: [
      { ...pasta, quantityPerServing: 100, isVague: false, originalPhrase: null },
      { ...milk, quantityPerServing: 400, isVague: false, originalPhrase: null },
      { ...salt, quantityPerServing: 1, isVague: true, originalPhrase: 'to taste' },
    ],
  }),
  meal({
    id: 'm2',
    name: 'Omelette',
    primaryProteinType: 'eggs',
    components: [
      { ...egg, quantityPerServing: 1.5, isVague: false, originalPhrase: null },
      { ...milk, quantityPerServing: 50, isVague: false, originalPhrase: null },
      { ...salt, quantityPerServing: 1, isVague: true, originalPhrase: 'a pinch' },
    ],
  }),
]

const OPTIONS = {
  pageUrl: 'https://wobblepot.com/meal-plans/family-of-four',
  title: 'A week of dinners for a family of four',
  recipeYield: (servings: number) => `${servings} servings`,
  tVague: (key: string) => ({ toTaste: 'to taste', pinch: 'a pinch', some: 'some' })[key] ?? key,
  pieceLabel: 'pc',
}

describe('buildSampleWeek', () => {
  const view = buildSampleWeek(WEEK, MEALS, OPTIONS)

  it('cooks for the stated household: two adults and two children are 3 servings', () => {
    expect(view.servings).toBe(3)
  })

  it('names the days Monday onward, with an anchor each', () => {
    expect(view.days.map((day) => [day.dayName, day.anchor])).toEqual([
      ['Monday', 'monday'],
      ['Tuesday', 'tuesday'],
    ])
  })

  it('scales each ingredient to the servings and formats it in its display unit', () => {
    expect(view.days[0]!.ingredients).toEqual([
      { id: 'ing-pasta', name: 'pasta', quantity: '300g', isVague: false },
      { id: 'ing-milk', name: 'milk', quantity: '1.2l', isVague: false },
      { id: 'ing-salt', name: 'salt', quantity: 'to taste', isVague: true },
    ])
    // 1.5 eggs × 3 = 4.5, rounded up to whole pieces.
    expect(view.days[1]!.ingredients[0]).toMatchObject({ name: 'egg', quantity: '5\u00a0pc' })
  })

  it('sums the week into one shopping list in the real list’s category order', () => {
    expect(view.shoppingList.map((group) => group.category)).toEqual([
      'protein',
      'dairy',
      'carb',
      'spice',
    ])
    const dairy = view.shoppingList.find((group) => group.category === 'dairy')!
    // (400 + 50) ml × 3 servings.
    expect(dairy.items).toEqual([
      { id: 'ing-milk', name: 'milk', quantity: '1.4l', isVague: false },
    ])
    // Two different vague phrases read "some", as on the real list.
    const spice = view.shoppingList.find((group) => group.category === 'spice')!
    expect(spice.items[0]!.quantity).toBe('some')
  })

  describe('jsonLd', () => {
    const list = view.jsonLd as {
      '@type': string
      name: string
      itemListElement: {
        '@type': string
        position: number
        url: string
        item: Record<string, unknown>
      }[]
    }

    it('is an ItemList of Recipe, one per day, each linked to its day', () => {
      expect(list['@type']).toBe('ItemList')
      expect(list.name).toBe(OPTIONS.title)
      expect(list.itemListElement.map((element) => element.position)).toEqual([1, 2])
      expect(list.itemListElement[1]!.url).toBe(`${OPTIONS.pageUrl}#tuesday`)
      for (const element of list.itemListElement) {
        expect(element['@type']).toBe('ListItem')
        expect(element.item['@type']).toBe('Recipe')
      }
    })

    it('carries the recipe fields, with the visible quantities as ingredients', () => {
      expect(list.itemListElement[0]!.item).toEqual({
        '@type': 'Recipe',
        name: MEALS[0]!.name,
        description: 'Pasta with milk',
        image: ['https://blob.example/pasta.webp'],
        totalTime: 'PT1H30M',
        recipeYield: '3 servings',
        recipeCategory: 'Dinner',
        recipeIngredient: ['300g pasta', '1.2l milk', 'salt, to taste'],
        recipeInstructions: [
          { '@type': 'HowToStep', text: 'Boil the pasta.' },
          { '@type': 'HowToStep', text: 'Add the milk.' },
        ],
      })
    })

    it('leaves out the image, description and steps a meal does not have', () => {
      const item = list.itemListElement[1]!.item
      expect(item).not.toHaveProperty('image')
      expect(item).not.toHaveProperty('description')
      expect(item).not.toHaveProperty('recipeInstructions')
      expect(item).not.toHaveProperty('suitableForDiet')
    })

    it('marks every recipe of the vegetarian week VegetarianDiet', () => {
      const vegetarian = buildSampleWeek({ ...WEEK, diet: 'vegetarian' }, MEALS, OPTIONS)
        .jsonLd as typeof list
      for (const element of vegetarian.itemListElement) {
        expect(element.item.suitableForDiet).toBe('https://schema.org/VegetarianDiet')
      }
    })
  })
})

describe('isoDuration', () => {
  it.each([
    [30, 'PT30M'],
    [60, 'PT1H'],
    [90, 'PT1H30M'],
    [180, 'PT3H'],
  ])('writes %d minutes as %s', (minutes, duration) => {
    expect(isoDuration(minutes)).toBe(duration)
  })
})

describe('serializeJsonLd', () => {
  it('escapes every < so a name cannot close the script element', () => {
    const json = serializeJsonLd(buildSampleWeek(WEEK, MEALS, OPTIONS).jsonLd)
    expect(json).not.toContain('<')
    expect(json).toContain('\\u003c/script>')
  })

  it('round-trips through JSON.parse unchanged', () => {
    const data = buildSampleWeek(WEEK, MEALS, OPTIONS).jsonLd
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data)
  })
})
