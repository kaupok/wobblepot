// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

// Runs the merge on Postgres (PGlite, in process) after every earlier
// migration, against a small household data set that hits each rule: a recipe
// and a pantry that hold both rows, a gram quantity that becomes pieces, the
// excluded ids, the allergen and protein-type union, the cilantro rename, and a
// household row with an American name that must stay.

const MIGRATIONS = join(__dirname, '..')
const THIS = '20261007120000_merge_british_ingredient_twins'
const migrationSql = (name: string) => readFileSync(join(MIGRATIONS, name, 'migration.sql'), 'utf8')
const earlier = readdirSync(MIGRATIONS)
  .filter((name) => /^\d{14}_/.test(name) && name < THIS)
  .sort()

async function migratedDatabase(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pg_trgm } })
  for (const name of earlier) await db.exec(migrationSql(name))
  return db
}

function ingredient(
  id: string,
  name: string,
  opts: {
    unit?: 'g' | 'piece'
    gramsPerPiece?: number
    allergens?: string
    proteinType?: string
    householdId?: string
  } = {},
) {
  const { unit = 'g', gramsPerPiece, allergens = '', proteinType, householdId } = opts
  const sqlValue = (v: string | number | undefined) =>
    v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${v}'`
  return `INSERT INTO "ingredient"
    (id, name, "householdId", category, "defaultUnit", allergens, calories, protein, carbs, fat, "gramsPerPiece", "proteinType")
    VALUES ('${id}', '${name}', ${sqlValue(householdId)}, 'protein', '${unit}', '{${allergens}}', 1, 1, 1, 1,
      ${sqlValue(gramsPerPiece)}, ${sqlValue(proteinType)});`
}

const FIXTURE_NAMES = [
  'shrimp',
  'prawns',
  'heavy cream',
  'double cream',
  'red chili pepper',
  'red chilli',
  'lima beans',
  'butter beans',
  'cilantro',
  'fresh cilantro',
  'fresh coriander',
]

const FIXTURE = `
  DELETE FROM "ingredient" WHERE "householdId" IS NULL AND name IN (${FIXTURE_NAMES.map((n) => `'${n}'`).join(', ')});
  INSERT INTO "household" (id, name) VALUES ('h1', 'One'), ('h2', 'Two');
  INSERT INTO "household_member" (id, "householdId") VALUES ('m1', 'h1');
  ${ingredient('am-shrimp', 'shrimp', { allergens: 'shellfish' })}
  ${ingredient('br-prawns', 'prawns', { allergens: 'shellfish', proteinType: 'fish' })}
  ${ingredient('am-cream', 'heavy cream', { allergens: 'dairy' })}
  ${ingredient('br-cream', 'double cream')}
  ${ingredient('am-chili', 'red chili pepper', { gramsPerPiece: 30 })}
  ${ingredient('br-chilli', 'red chilli', { unit: 'piece', gramsPerPiece: 15 })}
  ${ingredient('am-lima', 'lima beans', { proteinType: 'legume' })}
  ${ingredient('br-butter', 'butter beans')}
  ${ingredient('am-cil', 'cilantro')}
  ${ingredient('am-fcil', 'fresh cilantro')}
  ${ingredient('hh-shrimp', 'shrimp', { householdId: 'h1' })}
  INSERT INTO "ingredient_translation" (id, "ingredientId", locale, name) VALUES
    ('t-shrimp', 'am-shrimp', 'et', 'krevett'),
    ('t-prawns', 'br-prawns', 'et', 'krevetid'),
    ('t-fcil', 'am-fcil', 'et', 'värske koriandriroheline');
  INSERT INTO "meal" (id, name, "suitableFor", "updatedAt") VALUES
    ('meal-both', 'Both', '{dinner}', now()),
    ('meal-am', 'American only', '{dinner}', now()),
    ('meal-chili', 'Chilli', '{dinner}', now());
  INSERT INTO "meal_component" (id, "mealId", "ingredientId", "quantityPerServing", "updatedAt") VALUES
    ('c-shrimp', 'meal-both', 'am-shrimp', 100, now()),
    ('c-prawns', 'meal-both', 'br-prawns', 50, now()),
    ('c-cream', 'meal-am', 'am-cream', 80, now()),
    ('c-chili', 'meal-chili', 'am-chili', 30, now()),
    ('c-cil', 'meal-am', 'am-cil', 5, now()),
    ('c-fcil', 'meal-both', 'am-fcil', 3, now()),
    ('c-hh', 'meal-chili', 'hh-shrimp', 10, now());
  INSERT INTO "pantry_item" (id, "householdId", "ingredientId", quantity, "isStaple", "expiresAt", "updatedAt") VALUES
    ('p-shrimp', 'h1', 'am-shrimp', 200, true, '2026-10-10', now()),
    ('p-prawns', 'h1', 'br-prawns', 300, false, '2026-10-20', now()),
    ('p-shrimp-2', 'h2', 'am-shrimp', 400, false, NULL, now()),
    ('p-chili', 'h2', 'am-chili', 60, false, NULL, now()),
    ('p-cream', 'h2', 'am-cream', NULL, true, NULL, now()),
    ('p-dcream', 'h2', 'br-cream', 100, false, NULL, now());
  INSERT INTO "custom_shopping_item" (id, "householdId", name, "ingredientId") VALUES
    ('s-shrimp', 'h1', 'shrimp', 'am-shrimp');
  INSERT INTO "household_preferences" (id, "householdId", "excludedIngredientIds") VALUES
    ('hp1', 'h1', '{am-shrimp,br-prawns,other}'),
    ('hp2', 'h2', '{am-cream}');
  INSERT INTO "member_preferences" (id, "memberId", "excludedIngredientIds", "updatedAt") VALUES
    ('mp1', 'm1', '{am-lima}', now());
`

describe(`migration ${THIS} on Postgres`, () => {
  let db: PGlite
  const rows = async <T>(query: string) => (await db.query<T>(query)).rows

  beforeAll(async () => {
    db = await migratedDatabase()
    await db.exec(FIXTURE)
    await db.exec(migrationSql(THIS))
  }, 60_000)

  it('deletes the American global rows and keeps the household row', async () => {
    const left = await rows<{ id: string }>(
      `SELECT id FROM "ingredient" WHERE id IN ('am-shrimp', 'am-cream', 'am-chili', 'am-lima', 'am-cil', 'hh-shrimp') ORDER BY id`,
    )
    expect(left.map((r) => r.id)).toEqual(['hh-shrimp'])
  })

  it('renames fresh cilantro in place and merges cilantro into it', async () => {
    const [row] = await rows<{ name: string }>(`SELECT name FROM "ingredient" WHERE id = 'am-fcil'`)
    expect(row?.name).toBe('fresh coriander')
    const components = await rows<{ id: string; ingredientId: string; quantityPerServing: number }>(
      `SELECT id, "ingredientId", "quantityPerServing" FROM "meal_component" WHERE id IN ('c-cil', 'c-fcil') ORDER BY id`,
    )
    expect(components).toEqual([
      { id: 'c-cil', ingredientId: 'am-fcil', quantityPerServing: 5 },
      { id: 'c-fcil', ingredientId: 'am-fcil', quantityPerServing: 3 },
    ])
  })

  it('adds the American quantity to a recipe that holds both rows', async () => {
    const components = await rows<{ id: string; ingredientId: string; quantityPerServing: number }>(
      `SELECT id, "ingredientId", "quantityPerServing" FROM "meal_component" WHERE "mealId" = 'meal-both' AND "ingredientId" = 'br-prawns'`,
    )
    expect(components).toEqual([
      { id: 'c-prawns', ingredientId: 'br-prawns', quantityPerServing: 150 },
    ])
  })

  it('converts grams to pieces when the British row counts pieces', async () => {
    const [component] = await rows<{ ingredientId: string; quantityPerServing: number }>(
      `SELECT "ingredientId", "quantityPerServing" FROM "meal_component" WHERE id = 'c-chili'`,
    )
    expect(component).toEqual({ ingredientId: 'br-chilli', quantityPerServing: 2 })
    const [pantry] = await rows<{ ingredientId: string; quantity: number }>(
      `SELECT "ingredientId", quantity FROM "pantry_item" WHERE id = 'p-chili'`,
    )
    expect(pantry).toEqual({ ingredientId: 'br-chilli', quantity: 4 })
  })

  it('leaves a household row with an American name alone', async () => {
    const [component] = await rows<{ ingredientId: string }>(
      `SELECT "ingredientId" FROM "meal_component" WHERE id = 'c-hh'`,
    )
    expect(component?.ingredientId).toBe('hh-shrimp')
  })

  it('folds a pantry that holds both rows into the British item', async () => {
    const pantry = await rows<{
      id: string
      ingredientId: string
      quantity: number | null
      isStaple: boolean
    }>(
      `SELECT id, "ingredientId", quantity, "isStaple" FROM "pantry_item" WHERE id LIKE 'p-%' AND id <> 'p-chili' ORDER BY id`,
    )
    expect(pantry).toEqual([
      // Untracked American amount: the British amount stays, the flag is kept.
      { id: 'p-dcream', ingredientId: 'br-cream', quantity: 100, isStaple: true },
      { id: 'p-prawns', ingredientId: 'br-prawns', quantity: 500, isStaple: true },
      { id: 'p-shrimp-2', ingredientId: 'br-prawns', quantity: 400, isStaple: false },
    ])
    const [expiry] = await rows<{ expires: string }>(
      `SELECT to_char("expiresAt", 'YYYY-MM-DD') AS expires FROM "pantry_item" WHERE id = 'p-prawns'`,
    )
    expect(expiry?.expires).toBe('2026-10-10')
  })

  it('repoints custom shopping items and excluded ids', async () => {
    const [item] = await rows<{ ingredientId: string }>(
      `SELECT "ingredientId" FROM "custom_shopping_item" WHERE id = 's-shrimp'`,
    )
    expect(item?.ingredientId).toBe('br-prawns')
    const prefs = await rows<{ id: string; ids: string[] }>(
      `SELECT id, ARRAY(SELECT unnest("excludedIngredientIds") ORDER BY 1) AS ids FROM "household_preferences" ORDER BY id`,
    )
    expect(prefs).toEqual([
      { id: 'hp1', ids: ['br-prawns', 'other'] },
      { id: 'hp2', ids: ['br-cream'] },
    ])
    const [member] = await rows<{ excludedIngredientIds: string[] }>(
      `SELECT "excludedIngredientIds" FROM "member_preferences" WHERE id = 'mp1'`,
    )
    expect(member?.excludedIngredientIds).toEqual(['br-butter'])
  })

  it('keeps every allergen and the protein type of the American row', async () => {
    const survivors = await rows<{ id: string; allergens: string; proteinType: string | null }>(
      `SELECT id, allergens::text AS allergens, "proteinType" FROM "ingredient" WHERE id IN ('br-cream', 'br-butter', 'br-prawns') ORDER BY id`,
    )
    expect(survivors).toEqual([
      { id: 'br-butter', allergens: '{}', proteinType: 'legume' },
      { id: 'br-cream', allergens: '{dairy}', proteinType: null },
      { id: 'br-prawns', allergens: '{shellfish}', proteinType: 'fish' },
    ])
  })

  it('deletes the American translations only', async () => {
    const translations = await rows<{ id: string }>(
      `SELECT id FROM "ingredient_translation" WHERE id LIKE 't-%' ORDER BY id`,
    )
    expect(translations.map((r) => r.id)).toEqual(['t-fcil', 't-prawns'])
  })

  it('changes nothing on a second run', async () => {
    const snapshot = async () =>
      JSON.stringify([
        await rows(`SELECT * FROM "meal_component" ORDER BY id`),
        await rows(`SELECT * FROM "pantry_item" ORDER BY id`),
        await rows(`SELECT id, name, allergens::text FROM "ingredient" ORDER BY id`),
      ])
    const before = await snapshot()
    await db.exec(migrationSql(THIS))
    expect(await snapshot()).toBe(before)
  })
})

describe(`migration ${THIS} without unit conversion`, () => {
  it('stops, and changes nothing, when grams cannot become pieces', async () => {
    const db = await migratedDatabase()
    await db.exec(`
      DELETE FROM "ingredient" WHERE "householdId" IS NULL AND name IN ('green chili pepper', 'green chilli');
      ${ingredient('am', 'green chili pepper', { gramsPerPiece: 30 })}
      ${ingredient('br', 'green chilli', { unit: 'piece' })}
      INSERT INTO "meal" (id, name, "suitableFor", "updatedAt") VALUES ('x', 'X', '{dinner}', now());
      INSERT INTO "meal_component" (id, "mealId", "ingredientId", "quantityPerServing", "updatedAt")
        VALUES ('c', 'x', 'am', 30, now());
    `)
    await expect(db.exec(migrationSql(THIS))).rejects.toThrow(/cannot convert green chili pepper/)
    const [component] = (
      await db.query<{ ingredientId: string }>(
        `SELECT "ingredientId" FROM "meal_component" WHERE id = 'c'`,
      )
    ).rows
    expect(component?.ingredientId).toBe('am')
  }, 60_000)
})

describe(`migration ${THIS} on a fresh database`, () => {
  it('applies after every earlier migration with no pair rows of its own', async () => {
    const db = await migratedDatabase()
    await expect(db.exec(migrationSql(THIS))).resolves.toBeDefined()
  }, 60_000)
})
