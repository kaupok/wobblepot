// @vitest-environment node
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Allergen, DietaryType } from '@/generated/prisma/enums'
import {
  COVERED_ALLERGENS,
  COVERED_DIETS,
  findUnexcusedKeyword,
  findViolations,
  partitionMeals,
  rulesForHousehold,
} from './forbidden-foods'
import { HON_859_IMAGINE_RUNS, type RecordedMeal } from './imagine-fixtures'

const asMeal = (m: RecordedMeal) => ({
  name: m.name,
  ingredients: m.ingredients.map((name) => ({ name })),
})

const meal = (name: string, ...ingredients: string[]) => ({
  name,
  ingredients: ingredients.map((i) => ({ name: i })),
})

function violates(household: { allergens?: string[]; dietaryType?: string }, ingredient: string) {
  const rules = rulesForHousehold({
    allergens: household.allergens ?? [],
    dietaryType: household.dietaryType ?? null,
  })
  return findViolations(meal('Dish', ingredient), rules).length > 0
}

describe('coverage', () => {
  it('has a keyword list for every Allergen and DietaryType in the schema', () => {
    expect([...COVERED_ALLERGENS].sort()).toEqual(Object.values(Allergen).sort())
    expect([...COVERED_DIETS].sort()).toEqual(Object.values(DietaryType).sort())
  })

  it('makes no rule for a household without allergens or diet', () => {
    expect(rulesForHousehold({ allergens: [], dietaryType: null })).toEqual([])
  })

  it('ignores a value it does not know rather than throwing', () => {
    expect(rulesForHousehold({ allergens: ['lupin'], dietaryType: 'keto' })).toEqual([])
  })
})

describe('the HON-859 benchmark outputs', () => {
  const casesDir = join(process.cwd(), 'scripts/model-bench/cases/imagine')
  const householdOf = (caseId: string) =>
    (
      JSON.parse(readFileSync(join(casesDir, `${caseId}.json`), 'utf8')) as {
        household: { allergens: string[]; dietaryType: string | null }
      }
    ).household

  const dropped = (caseId: string, model: string) =>
    HON_859_IMAGINE_RUNS.filter((r) => r.caseId === caseId && r.model === model).map((r) =>
      partitionMeals(r.meals.map(asMeal), rulesForHousehold(householdOf(caseId))).dropped.map(
        (d) => d.meal.name,
      ),
    )

  it('drops every shrimp, prawn and seafood paella 4.6 suggested for a shellfish allergy', () => {
    expect(dropped('en-shellfish-allergy-paella', 'claude-sonnet-4-6')).toEqual([
      [
        'Classic Spanish Seafood Paella',
        'Mediterranean Grilled Seafood Rice Bowl',
        'Seafood Fideuà with Aioli',
      ],
      ['Classic Spanish Seafood Paella', 'Garlic Butter Prawn & Rice Skillet'],
      ['Classic Spanish Seafood Paella', 'Grilled Garlic Butter Shrimp with Saffron Rice'],
    ])
  })

  it('drops the salmon and tuna onigiri 4.6 suggested for a fish allergy, and the fish maki by name', () => {
    expect(dropped('et-fish-allergy-sushi', 'claude-sonnet-4-6')).toEqual([
      ['Kalamaki kauss'],
      ['Onigiri lõhega'],
      ['Onigiri tuunikalaga'],
    ])
  })

  it('drops every smoked-fish potato salad 4.6 suggested for a vegan household', () => {
    expect(dropped('et-vegan-sour-cream', 'claude-sonnet-4-6')).toEqual([
      [
        'Soe kartulisalat suitsulõhega',
        'Soe kartulisalat räime ja sibulaga',
        'Soe kartulisalat suitsumakrelliga',
      ],
      [
        'Soe kartulisalat suitsukalaga',
        'Kartulisalat mädarõika-hapukoorekastmega',
        'Kartuli-kalasupp tilliga',
      ],
      [
        'Soe kartulisalat suitsulõhega',
        'Kartulisalat suitsuräimega',
        'Ahjukartulisalat suitsumakrelliga',
      ],
    ])
  })

  it('catches the sour cream in the vegan salads even where the fish is gone', () => {
    const rules = rulesForHousehold({ allergens: [], dietaryType: 'vegan' })
    expect(findViolations(meal('Kartulisalat', 'kartul', 'hapukoor'), rules)).toEqual([
      {
        constraint: 'vegan',
        kind: 'diet',
        keyword: 'hapukoor',
        field: 'ingredient',
        text: 'hapukoor',
      },
    ])
  })

  // The guard is only usable if it leaves compliant output alone: a false
  // positive costs a suggestion and a retry inside a 40 s budget.
  it.each([...new Set(HON_859_IMAGINE_RUNS.map((r) => r.caseId))])(
    'drops none of the meals 5.5 suggested for %s',
    (caseId) => {
      expect(dropped(caseId, 'claude-sonnet-5-5').flat()).toEqual([])
    },
  )
})

describe('findViolations', () => {
  it('checks the meal name for allergens', () => {
    const rules = rulesForHousehold({ allergens: ['shellfish'], dietaryType: null })
    expect(findViolations(meal('Shrimp fried rice', 'rice', 'pea'), rules)).toEqual([
      {
        constraint: 'shellfish',
        kind: 'allergen',
        keyword: 'shrimp',
        field: 'name',
        text: 'Shrimp fried rice',
      },
    ])
  })

  it('does not check the meal name for a diet', () => {
    const rules = rulesForHousehold({ allergens: [], dietaryType: 'vegan' })
    const dish = meal('Vegan mac and cheese', 'macaroni', 'cashew', 'nutritional yeast')
    expect(findViolations(dish, rules)).toEqual([])
  })

  it('reports one violation per broken rule', () => {
    const rules = rulesForHousehold({ allergens: ['fish', 'dairy'], dietaryType: null })
    const dish = meal('Bake', 'salmon', 'cod', 'butter', 'cream')
    expect(findViolations(dish, rules).map((v) => [v.constraint, v.keyword])).toEqual([
      ['fish', 'salmon'],
      ['dairy', 'butter'],
    ])
  })
})

describe('qualifiers stay inside their group', () => {
  it('excuses the milk in almond milk for dairy, but not the almond for a nut allergy', () => {
    expect(violates({ allergens: ['dairy'] }, 'almond milk')).toBe(false)
    expect(violates({ allergens: ['nuts'] }, 'almond milk')).toBe(true)
  })

  it('excuses the egg in eggplant without excusing a vegan household from eggs', () => {
    expect(violates({ dietaryType: 'vegan' }, 'eggplant')).toBe(false)
    expect(violates({ dietaryType: 'vegan' }, 'egg noodle')).toBe(true)
  })

  it('does not treat a plant-based swap as safe for a nut or gluten allergy', () => {
    expect(violates({ allergens: ['nuts'] }, 'vegan pesto')).toBe(true)
    expect(violates({ allergens: ['gluten'] }, 'vegan bread')).toBe(true)
  })
})

describe('a false friend excuses only the word it is (PR #981 review)', () => {
  it.each(['coconut almond milk', 'peanut cashew sauce', 'kookos mandlid', 'nutmeg walnut'])(
    'flags the nut after %s',
    (ingredient) => {
      expect(violates({ allergens: ['nuts'] }, ingredient)).toBe(true)
    },
  )

  it('flags a nut in a meal name after a false friend', () => {
    const rules = rulesForHousehold({ allergens: ['nuts'], dietaryType: null })
    expect(findViolations(meal('Butternut pecan salad', 'lettuce'), rules)).toHaveLength(1)
  })

  it('does not let "veggie" excuse shellfish in a meal name', () => {
    const rules = rulesForHousehold({ allergens: ['shellfish'], dietaryType: null })
    expect(findViolations(meal('Veggie shrimp fried rice', 'rice'), rules)).toHaveLength(1)
  })

  // "või" is also Estonian for "or". Splitting on it hid the butter in
  // "sulatatud või praadimiseks" (review round 3), so every "või" reads as
  // butter: dropping "riis või kinoa" is the safe failure.
  it('reads every Estonian "või" as butter, accepting "riis või kinoa" as a false positive', () => {
    expect(violates({ allergens: ['dairy'] }, 'sulatatud või praadimiseks')).toBe(true)
    expect(violates({ dietaryType: 'vegan' }, 'sulatatud või praadimiseks')).toBe(true)
    expect(violates({ allergens: ['dairy'] }, 'riis või kinoa')).toBe(true)
  })

  it.each(['bechamel', 'béchamel sauce', 'beefsteak tomato', 'champagne vinegar'])(
    'does not read %s as meat',
    (ingredient) => {
      expect(violates({ dietaryType: 'vegetarian' }, ingredient)).toBe(false)
    },
  )

  it('still reads bechamel as dairy', () => {
    expect(violates({ allergens: ['dairy'] }, 'bechamel')).toBe(true)
  })
})

describe('review round 2 gaps (PR #981)', () => {
  it.each([
    [{ allergens: ['gluten'] }, 'rolled oats'],
    [{ allergens: ['gluten'] }, 'kaerahelbed'],
    [{ allergens: ['gluten'] }, 'kruubid'],
    [{ allergens: ['gluten'] }, 'pearl barley'],
    [{ allergens: ['gluten'] }, 'rice noodle soy sauce'],
    [{ allergens: ['peanuts'] }, 'satay sauce'],
    [{ allergens: ['dairy'] }, 'pesto'],
    [{ allergens: ['dairy'] }, 'tzatziki'],
    [{ allergens: ['dairy'] }, 'raita'],
    [{ allergens: ['dairy'] }, 'alfredo sauce'],
    [{ allergens: ['eggs'] }, 'carbonara sauce'],
    [{ allergens: ['eggs'] }, 'caesar dressing'],
    [{ dietaryType: 'vegan' }, 'pesto'],
    [{ dietaryType: 'vegan' }, 'brioche bun'],
    [{ dietaryType: 'vegan' }, 'mushroom chicken stock'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    [{ allergens: ['gluten'] }, 'goat cheese'],
    [{ allergens: ['gluten'] }, 'rice noodle'],
    [{ allergens: ['gluten'] }, 'riisinuudlid'],
    [{ dietaryType: 'vegan' }, 'vegan pesto'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })

  it('matches a hidden-allergen sauce in ingredients, not in the dish name it adapts', () => {
    const rules = rulesForHousehold({ allergens: ['nuts', 'peanuts'], dietaryType: null })
    const adapted = meal('Nut-free chicken satay', 'chicken', 'sunflower seed butter')
    expect(findViolations(adapted, rules)).toEqual([])
    expect(findViolations(meal('Chicken satay', 'chicken', 'satay sauce'), rules)).toEqual([
      expect.objectContaining({ constraint: 'peanuts', keyword: 'satay', field: 'ingredient' }),
    ])
  })
})

// HON-1083 renamed seeded rows to their British names. Each pair of words must
// trip the same rule, so a pasted American recipe and a seeded meal agree.
describe('British and American names of a renamed row', () => {
  it.each([
    [{ allergens: ['gluten'] }, 'pita bread'],
    [{ allergens: ['gluten'] }, 'pitta bread'],
    [{ allergens: ['gluten'] }, 'lasagna sheets'],
    [{ allergens: ['gluten'] }, 'lasagne sheets'],
    [{ allergens: ['dairy'] }, 'sour cream'],
    [{ allergens: ['dairy'] }, 'soured cream'],
    [{ allergens: ['dairy'] }, 'goat cheese'],
    [{ allergens: ['dairy'] }, "goat's cheese"],
    [{ allergens: ['fish'] }, 'canned tuna'],
    [{ allergens: ['fish'] }, 'tinned tuna'],
    [{ dietaryType: 'vegetarian' }, 'ground beef'],
    [{ dietaryType: 'vegetarian' }, 'beef mince'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    [{ allergens: ['gluten'] }, "goat's cheese"],
    [{ allergens: ['eggs'] }, 'eggplant'],
    [{ allergens: ['eggs'] }, 'aubergine'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })
})

// HON-1099 renamed the rest of the pool. Same rule: both words trip it. Before
// it, "ham steak" was caught by "ham" but "gammon steak" by nothing, and
// "cornish hen", "half and half" and "phyllo dough" were not caught at all.
describe('British and American names of a row renamed in HON-1099', () => {
  it.each([
    [{ allergens: ['gluten'] }, 'all-purpose flour'],
    [{ allergens: ['gluten'] }, 'plain flour'],
    [{ allergens: ['gluten'] }, 'whole wheat flour'],
    [{ allergens: ['gluten'] }, 'wholemeal flour'],
    [{ allergens: ['gluten'] }, 'whole wheat pasta'],
    [{ allergens: ['gluten'] }, 'wholewheat pasta'],
    [{ allergens: ['gluten'] }, 'phyllo dough'],
    [{ allergens: ['gluten'] }, 'filo pastry'],
    [{ allergens: ['gluten'] }, 'filo'],
    [{ allergens: ['dairy'] }, 'half and half'],
    [{ allergens: ['dairy'] }, 'half-and-half'],
    [{ dietaryType: 'vegan' }, 'half-and-half'],
    [{ allergens: ['dairy'] }, 'single cream'],
    [{ allergens: ['dairy'] }, 'plain yogurt'],
    [{ allergens: ['dairy'] }, 'natural yogurt'],
    [{ allergens: ['shellfish'] }, 'baby shrimp'],
    [{ allergens: ['shellfish'] }, 'small prawns'],
    [{ allergens: ['shellfish'] }, 'shrimp peeled'],
    [{ allergens: ['shellfish'] }, 'peeled prawns'],
    [{ allergens: ['shellfish'] }, 'cooked shrimp'],
    [{ allergens: ['shellfish'] }, 'cooked prawns'],
    [{ allergens: ['fish'] }, 'canned anchovies'],
    [{ allergens: ['fish'] }, 'tinned anchovies'],
    [{ allergens: ['fish'] }, 'canned sardines'],
    [{ allergens: ['fish'] }, 'tinned sardines'],
    [{ dietaryType: 'vegetarian' }, 'ham steak'],
    [{ dietaryType: 'vegetarian' }, 'gammon steak'],
    [{ dietaryType: 'vegetarian' }, 'cornish hen'],
    [{ dietaryType: 'vegetarian' }, 'cornish game hens'],
    [{ dietaryType: 'vegetarian' }, 'poussin'],
    [{ dietaryType: 'vegetarian' }, 'gelatin'],
    [{ dietaryType: 'vegetarian' }, 'gelatine'],
    [{ dietaryType: 'vegan' }, 'single cream'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    [{ allergens: ['gluten'] }, 'cornstarch'],
    [{ allergens: ['gluten'] }, 'cornflour'],
    [{ dietaryType: 'vegan' }, 'rapeseed oil'],
    [{ dietaryType: 'vegan' }, 'broad beans'],
    [{ dietaryType: 'vegan' }, 'black-eyed beans'],
    [{ dietaryType: 'vegan' }, 'chestnut mushroom'],
    [{ dietaryType: 'vegan' }, 'vanilla pod'],
    [{ dietaryType: 'vegan' }, 'tinned chopped tomatoes'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })
})

describe('the food words the British English block asks for (HON-1098)', () => {
  it.each([
    [{ dietaryType: 'vegetarian' }, 'beef mince'],
    [{ dietaryType: 'vegetarian' }, 'mince'],
    [{ dietaryType: 'vegan' }, 'mince'],
    [{ dietaryType: 'vegetarian' }, 'lamb mince'],
    [{ dietaryType: 'pescatarian' }, 'mince'],
    [{ dietaryType: 'vegetarian' }, 'minced beef'],
    [{ allergens: ['shellfish'] }, 'prawns'],
    [{ allergens: ['shellfish'] }, 'king prawn'],
    [{ dietaryType: 'vegetarian' }, 'prawn'],
    [{ allergens: ['dairy'] }, 'double cream'],
    [{ dietaryType: 'vegan' }, 'double cream'],
    [{ allergens: ['dairy'] }, 'yoghurt'],
    [{ dietaryType: 'vegan' }, 'natural yoghurt'],
    [{ allergens: ['dairy'] }, 'fromage frais'],
    [{ dietaryType: 'vegan' }, 'fromage frais'],
    [{ allergens: ['gluten'] }, 'plain flour'],
    [{ allergens: ['fish'] }, 'kipper'],
    [{ dietaryType: 'vegetarian' }, 'smoked kippers'],
    [{ dietaryType: 'vegan' }, 'hard cheese'],
    [{ dietaryType: 'vegan' }, 'quorn mince'],
    [{ allergens: ['eggs'] }, 'quorn pieces'],
    [{ dietaryType: 'vegetarian' }, 'beef and mushroom mince'],
    [{ dietaryType: 'vegetarian' }, 'minced steak'],
    [{ dietaryType: 'vegetarian' }, 'minced goat'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    // "minced" is the cut, so the garlic stays; the beef in "minced beef" does not.
    [{ dietaryType: 'vegan' }, 'minced garlic'],
    [{ dietaryType: 'vegetarian' }, 'soya mince'],
    [{ dietaryType: 'vegetarian' }, 'veggie mince'],
    [{ dietaryType: 'vegetarian' }, 'quorn mince'],
    [{ dietaryType: 'vegetarian' }, 'lentil mince'],
    [{ dietaryType: 'vegetarian' }, 'plant mince'],
    [{ dietaryType: 'vegetarian' }, 'mushroom mince'],
    [{ dietaryType: 'vegetarian' }, 'vegetable mince'],
    [{ dietaryType: 'vegan' }, 'vegan quorn mince'],
    // The brand puts "vegan" after the name.
    [{ dietaryType: 'vegan' }, 'quorn vegan mince'],
    [{ allergens: ['eggs'] }, 'quorn vegan mince'],
    [{ dietaryType: 'vegan' }, 'minced ginger'],
    [{ dietaryType: 'vegan' }, 'courgette'],
    [{ dietaryType: 'vegan' }, 'aubergine'],
    [{ dietaryType: 'vegan' }, 'coriander'],
    [{ dietaryType: 'vegan' }, 'spring onion'],
    [{ dietaryType: 'vegan' }, 'red pepper'],
    [{ dietaryType: 'vegan' }, 'red chilli'],
    [{ dietaryType: 'vegan' }, 'caster sugar'],
    [{ dietaryType: 'vegan' }, 'bicarbonate of soda'],
    [{ allergens: ['gluten'] }, 'bicarbonate of soda'],
    [{ dietaryType: 'vegan' }, 'oat yoghurt'],
    // The eval's vegan carbonara run wrote it (HON-1098).
    [{ dietaryType: 'vegan' }, 'vegan hard cheese'],
    [{ allergens: ['dairy'] }, 'vegan hard cheese'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })
})

describe('goat, steak and sirloin (HON-1106)', () => {
  it.each([
    [{ dietaryType: 'vegetarian' }, 'goat curry'],
    [{ dietaryType: 'vegetarian' }, 'sirloin steak'],
    [{ dietaryType: 'vegetarian' }, 'minced steak'],
    [{ dietaryType: 'vegetarian' }, 'rump steak'],
    [{ dietaryType: 'vegetarian' }, 'steik'],
    [{ dietaryType: 'vegetarian' }, 'kitseliha'],
    [{ dietaryType: 'pescatarian' }, 'goat'],
    [{ dietaryType: 'pescatarian' }, 'sirloin'],
    // FISH still catches a fish steak for a vegetarian.
    [{ dietaryType: 'vegetarian' }, 'tuna steak'],
    [{ dietaryType: 'vegetarian' }, 'lõhesteik'],
    // DAIRY still catches goat dairy for a vegan.
    [{ dietaryType: 'vegan' }, "goat's cheese"],
    [{ dietaryType: 'vegan' }, "goat's curd"],
    [{ allergens: ['dairy'] }, 'goat curd'],
    [{ allergens: ['dairy'] }, 'lemon curd'],
    // Pool names the PR #1177 review ran through the check.
    [{ dietaryType: 'vegetarian' }, 'filee praad'],
    [{ dietaryType: 'vegetarian' }, 'metssea praad'],
    [{ dietaryType: 'vegetarian' }, 'wild boar'],
    [{ dietaryType: 'vegetarian' }, 'hiidlestapraad'],
    [{ allergens: ['fish'] }, 'hiidlest'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    [{ dietaryType: 'vegetarian' }, "goat's cheese"],
    [{ dietaryType: 'vegetarian' }, "goat's curd"],
    [{ dietaryType: 'vegetarian' }, 'goat milk'],
    [{ dietaryType: 'vegetarian' }, 'beefsteak tomato'],
    [{ dietaryType: 'vegetarian' }, 'kitsejuust'],
    [{ dietaryType: 'pescatarian' }, 'tuna steak'],
    [{ dietaryType: 'pescatarian' }, 'lõhesteik'],
    [{ dietaryType: 'vegan' }, 'cauliflower steak'],
    [{ dietaryType: 'vegan' }, 'lillkapsasteik'],
    [{ dietaryType: 'vegan' }, 'bean curd'],
    [{ allergens: ['dairy'] }, 'bean curd'],
    [{ dietaryType: 'pescatarian' }, 'halibut steak'],
    [{ dietaryType: 'pescatarian' }, 'hiidlestapraad'],
    [{ dietaryType: 'vegetarian' }, 'steak sauce'],
    [{ dietaryType: 'vegan' }, 'steak seasoning'],
    [{ dietaryType: 'vegan' }, 'Cauliflower Steaks'],
    [{ dietaryType: 'vegetarian' }, "roasted beetroot with goat's cheese"],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })
})

describe('review round 3 gaps (PR #981)', () => {
  it.each([
    [{ allergens: ['shellfish'] }, 'rannakarbid'],
    [{ allergens: ['shellfish'] }, 'kammkarbid'],
    [{ allergens: ['shellfish'] }, 'austrid'],
    [{ allergens: ['shellfish'] }, 'kaheksajalad'],
    [{ allergens: ['shellfish'] }, 'shellfish stock'],
    [{ allergens: ['fish'] }, 'suitsuangerja tükid'],
    [{ allergens: ['fish'] }, 'gravlax'],
    [{ allergens: ['fish'] }, 'lox'],
    [{ allergens: ['fish'] }, 'sprats'],
    [{ allergens: ['fish'] }, 'sprotid'],
    [{ allergens: ['gluten'] }, 'dried farfalle'],
    [{ allergens: ['gluten'] }, 'gnocchi'],
    [{ allergens: ['gluten'] }, 'ravioolid'],
    [{ allergens: ['gluten'] }, 'tortellini'],
    [{ allergens: ['gluten'] }, 'leivapuru'],
    [{ dietaryType: 'vegetarian' }, 'singitükid'],
    [{ dietaryType: 'vegetarian' }, 'porgandi kanapada'],
    [{ dietaryType: 'vegan' }, 'soja kanafilee'],
    [{ allergens: ['dairy'] }, 'kakaopiim'],
    [{ allergens: ['dairy'] }, 'cocoa milk'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })

  it.each([
    [{ allergens: ['shellfish'] }, 'austriseened'],
    [{ allergens: ['dairy'] }, 'cocoa butter'],
    [{ allergens: ['dairy'] }, 'kakaovõi'],
    [{ dietaryType: 'vegetarian' }, 'sojahakkliha'],
    [{ dietaryType: 'vegan' }, 'porgandilõhe'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })
})

describe('false friends', () => {
  it.each([
    [{ allergens: ['fish'] }, 'kalamata oliivid'],
    [{ allergens: ['fish'] }, 'lõhestatud herned'],
    [{ allergens: ['shellfish'] }, 'austerseen'],
    [{ allergens: ['shellfish'] }, 'oyster mushroom'],
    [{ allergens: ['nuts'] }, 'coconut milk'],
    [{ allergens: ['nuts'] }, 'nutmeg'],
    [{ allergens: ['nuts'] }, 'muskaatpähkel'],
    [{ allergens: ['nuts'] }, 'nutritional yeast'],
    [{ allergens: ['nuts'] }, 'peanut'],
    [{ allergens: ['dairy'] }, 'sidrunikoor'],
    [{ allergens: ['dairy'] }, 'kooritud tomatid'],
    [{ allergens: ['dairy'] }, 'kookospiim'],
    [{ allergens: ['dairy'] }, 'peanut butter'],
    [{ allergens: ['dairy'] }, 'sunflower seed butter'],
    [{ allergens: ['dairy'] }, 'butternut squash'],
    [{ allergens: ['dairy'] }, 'cream of tartar'],
    [{ allergens: ['gluten'] }, 'banaan'],
    [{ allergens: ['gluten'] }, 'tomatipasta'],
    [{ allergens: ['gluten'] }, 'pastinaak'],
    [{ allergens: ['gluten'] }, 'rice noodle'],
    [{ allergens: ['gluten'] }, 'buckwheat groats'],
    [{ allergens: ['gluten'] }, 'cornflour'],
    [{ allergens: ['gluten'] }, 'corn tortilla'],
    [{ allergens: ['eggs'] }, 'Parmigiano-Reggiano'],
    [{ allergens: ['nuts'] }, 'minute rice'],
    [{ dietaryType: 'vegetarian' }, 'chamomile tea'],
    [{ dietaryType: 'vegetarian' }, 'coconut meat'],
    [{ allergens: ['gluten'] }, 'riisijahu'],
    [{ allergens: ['gluten'] }, 'kookospiim'],
    [{ dietaryType: 'vegetarian' }, 'kanamuna'],
    [{ dietaryType: 'vegetarian' }, 'chickpea'],
    [{ dietaryType: 'vegetarian' }, 'champignon'],
    [{ dietaryType: 'vegetarian' }, 'collard greens'],
    [{ dietaryType: 'vegetarian' }, 'sojahakkliha'],
    [{ dietaryType: 'pescatarian' }, 'krevetid'],
    [{ dietaryType: 'pescatarian' }, 'lõhefilee'],
    [{ dietaryType: 'vegan' }, 'honeydew melon'],
    [{ dietaryType: 'vegan' }, 'taimne hapukoor'],
    [{ dietaryType: 'vegan' }, 'porgandilõhe'],
  ])('%o allows %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(false)
  })

  it.each([
    [{ allergens: ['fish'] }, 'tursafilee'],
    [{ allergens: ['fish'] }, 'fish sauce'],
    [{ allergens: ['fish'] }, 'worcestershire sauce'],
    [{ allergens: ['shellfish'] }, 'oyster sauce'],
    [{ allergens: ['shellfish'] }, 'kuningkrevetid'],
    [{ allergens: ['nuts'] }, 'kreeka pähklid'],
    [{ allergens: ['nuts'] }, 'pine nut'],
    [{ allergens: ['peanuts'] }, 'maapähklivõi'],
    [{ allergens: ['dairy'] }, 'või'],
    [{ allergens: ['dairy'] }, 'kodujuust'],
    [{ allergens: ['dairy'] }, 'buttermilk'],
    [{ allergens: ['dairy'] }, 'lactose-free milk'],
    [{ allergens: ['eggs'] }, 'majonees'],
    [{ allergens: ['soy'] }, 'sojakaste'],
    [{ allergens: ['gluten'] }, 'soy sauce'],
    [{ allergens: ['gluten'] }, 'pitaleib'],
    [{ allergens: ['gluten'] }, 'riivsai'],
    // A qualifier excuses the keyword right after it, so these stay narrow.
    [{ allergens: ['gluten'] }, 'cornbread'],
    [{ allergens: ['gluten'] }, 'potato bread'],
    [{ allergens: ['gluten'] }, 'küüslauguleib'],
    [{ allergens: ['gluten'] }, 'banaanileib'],
    [{ allergens: ['gluten'] }, 'buckwheat noodle'],
    [{ allergens: ['gluten'] }, 'almond croissant'],
    [{ allergens: ['sesame'] }, 'seesamiseemned'],
    [{ allergens: ['sesame'] }, 'tahini'],
    [{ dietaryType: 'pescatarian' }, 'kana- või köögiviljapuljong'],
    [{ dietaryType: 'pescatarian' }, 'gelatin'],
    [{ dietaryType: 'vegetarian' }, 'verivorst'],
    [{ dietaryType: 'vegan' }, 'honey'],
    [{ dietaryType: 'vegan' }, 'mesi'],
  ])('%o flags %s', (household, ingredient) => {
    expect(violates(household, ingredient)).toBe(true)
  })
})

describe('findUnexcusedKeyword', () => {
  it('returns the earliest unexcused keyword', () => {
    expect(findUnexcusedKeyword('butter and milk', ['milk', 'butter'], [])).toBe('butter')
  })

  it('excuses a keyword inside a false friend without excusing the next word', () => {
    expect(findUnexcusedKeyword('nutmeg', ['nut'], [], ['nutmeg'])).toBe(null)
    expect(findUnexcusedKeyword('nutmeg walnut', ['nut', 'walnut'], [], ['nutmeg'])).toBe('walnut')
  })

  it('returns null when every keyword is excused', () => {
    expect(
      findUnexcusedKeyword('plant-based cream cheese', ['cream', 'cheese'], ['plant-based']),
    ).toBe(null)
  })
})
