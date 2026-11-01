import { describe, expect, it } from 'vitest'

import { normalizeIngredientName } from '@/lib/normalize-ingredient'
import { prisma } from '@/lib/prisma'

import { baseIngredients } from '../../../prisma/seed'
import { comprehensiveIngredients } from '../../../prisma/seed-comprehensive'
import { newIngredients } from '../../../prisma/seed-expansion'
import { importCoverageIngredients } from '../../../prisma/seed-import-coverage'
import { ingredientTranslationsEt } from '../../../prisma/seed-ingredient-translations-et'
import { applyFormGuard } from './form-modifier-guard'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'
import { matchIngredients } from './match-ingredients'
import { extracted } from './match-ingredients.fixtures'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks.
// HON-1554: a form word, English or Estonian, must not save sure as the bare row.
// Every seeded row and Estonian name is in the catalogue, so real neighbours compete.

async function seedCatalogue() {
  const names = new Set<string>()
  const rows = [
    ...baseIngredients,
    ...newIngredients,
    ...comprehensiveIngredients,
    ...importCoverageIngredients,
  ].filter((row) => !names.has(row.name) && names.add(row.name))

  // A migration may have inserted a row already, so its id is read back by name
  await prisma.ingredient.createMany({
    data: rows.map((row) => ({
      name: row.name,
      category: row.category,
      defaultUnit: row.defaultUnit,
      calories: row.calories,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
    })),
    skipDuplicates: true,
  })
  const saved = await prisma.ingredient.findMany({
    where: { householdId: null },
    select: { id: true, name: true },
  })
  const idOf = new Map(saved.map((row) => [row.name, row.id]))
  await prisma.ingredientTranslation.createMany({
    data: ingredientTranslationsEt
      .filter((row) => idOf.has(row.en))
      .map((row) => ({ ingredientId: idOf.get(row.en)!, locale: 'et', name: row.et })),
    skipDuplicates: true,
  })
}

async function matchOne(name: string) {
  const [result] = await matchIngredients([extracted(name)], 4, { locale: 'et' })
  return result!
}

describe('matchIngredients on a name with a form word', () => {
  it.each([
    ['suitsutatud paprika', 'smoked paprika'],
    ['külmutatud brokoli', 'frozen broccoli'],
    ['paprika', 'bell pepper'],
    ['sibul', 'onion'],
    ['kurk', 'cucumber'],
    ['smoked paprika', 'smoked paprika'],
    ['pickled ginger', 'pickled ginger'],
    ['roasted red peppers', 'roasted red peppers'],
    ['canned chopped tomatoes', 'tinned chopped tomatoes'],
    // No synonym: the guard finds the Estonian compound row, "suitsulõhe" and "suitsusink"
    ['suitsutatud lõhe', 'smoked salmon'],
    ['suitsutatud sink', 'smoked ham'],
    // The normalized name keeps "fillet", so its curated alias names the form
    ['chicken fillets', 'chicken breast'],
    ['skinless chicken fillets', 'chicken breast'],
    // A spice row is ground and dried, a legume row dried, so the bare row is right
    ['ground cumin', 'cumin'],
    ['dried cumin', 'cumin'],
    ['dried lentils', 'lentils'],
  ])('matches "%s" to %s, sure', async (recipeName, rowName) => {
    await seedCatalogue()

    expect(await matchOne(recipeName)).toMatchObject({
      type: 'matched',
      ingredient: { name: rowName },
      lowConfidence: false,
    })
  })

  it.each([
    ['kuivatatud sibul', 'onion'],
    ['marineeritud kurk', 'cucumber'],
    ['külmutatud lillkapsas', 'cauliflower'],
    ['pickled cucumbers', 'cucumber'],
    ['smoked cheese', 'cheese'],
    // The normalized name's alias ("prawn" → "prawns") does not name the form
    ['smoked prawns', 'prawns'],
    ['frozen shrimp', 'prawns'],
    // A form row carries every missing form: `chicken thigh fillet` is not frozen
    ['frozen chicken fillets', 'chicken thigh fillet'],
    ['frozen chicken fillets', 'chicken breast'],
  ])('does not match "%s" to the bare %s for sure', async (recipeName, bareRow) => {
    await seedCatalogue()

    expect(await matchOne(recipeName)).not.toMatchObject({
      ingredient: { name: bareRow },
      lowConfidence: false,
    })
  })

  it('offers the bare row as an alternative when no form row exists', async () => {
    await seedCatalogue()

    const lillkapsas = await matchOne('külmutatud lillkapsas')
    const cheese = await matchOne('smoked cheese')

    expect(lillkapsas).toMatchObject({ type: 'matched', lowConfidence: true })
    expect(lillkapsas.type === 'matched' && lillkapsas.alternatives?.map((a) => a.name)).toContain(
      'cauliflower',
    )
    expect(cheese).toMatchObject({ type: 'matched', lowConfidence: true })
    expect(cheese.type === 'matched' && cheese.alternatives?.[0]?.name).toBe('cheese')
  })
})

// "suitsutatud paprika" and "marineeritud kurk" are curated synonyms (HON-1553), so
// `matchIngredients` never reaches the guard for them. The guard is run here on the
// bare row the last-word search finds, as it did before the synonyms.
describe('applyFormGuard on an Estonian form name the synonyms do not cover', () => {
  const search = (name: string) => fuzzySearchIngredient(name, { locale: 'et' })

  async function guardBareRow(directName: string, bareWord: string) {
    const normalizedName = normalizeIngredientName(directName)
    const matchesByCandidate = new Map([
      [directName, await search(directName)],
      [normalizedName, await search(normalizedName)],
    ])
    return applyFormGuard({
      directName,
      aliasName: directName,
      normalizedName,
      normalizedAliasName: normalizedName,
      matches: await search(bareWord),
      matchesByCandidate,
      search,
    })
  }

  it('replaces `bell pepper` with the smoked paprika row for "suitsutatud paprika"', async () => {
    await seedCatalogue()

    const { formGuard, matches } = await guardBareRow('suitsutatud paprika', 'paprika')

    expect(formGuard.action).toBe('use')
    expect(matches[0]?.name).toBe('smoked paprika')
  })

  it('does not keep `cucumber` for "marineeritud kurk"', async () => {
    await seedCatalogue()

    const { formGuard, matches } = await guardBareRow('marineeritud kurk', 'kurk')

    expect(formGuard.action).not.toBe('keep')
    expect(matches[0]?.name).not.toBe('cucumber')
  })
})
