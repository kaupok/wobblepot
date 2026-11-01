import { describe, expect, it } from 'vitest'

import { normalizeIngredientName } from '@/lib/normalize-ingredient'

import { applyFormGuard, FORM_WORDS } from './form-modifier-guard'
import { fuzzySearchIngredient } from './fuzzy-ingredient-match'
import { matchIngredients } from './match-ingredients'
import { seedCatalogue } from './match-ingredients.catalogue.fixtures'
import { extracted } from './match-ingredients.fixtures'

// Runs against PGlite with pg_trgm through the `unit-db` project, with no mocks.
// HON-1554: a form word, English or Estonian, must not save sure as the bare row.
// Every seeded row and Estonian name is in the catalogue, so real neighbours compete.

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

// HON-1571: one recipe line per form word. Each line here goes red when its word
// leaves FORM_WORDS: the bare row wins without the guard, or the form row is lost.
type FormWordLine = [word: string, recipeName: string, rowName: string, sure: boolean]

const FORM_WORD_LINES: FormWordLine[] = [
  ['canned', 'canned peaches', 'peach', false],
  ['tinned', 'tinned tomatoes', 'tinned plum tomatoes', true],
  ['frozen', 'frozen cauliflower', 'cauliflower', false],
  ['dried', 'dried tomatoes', 'tomato', false],
  ['smoked', 'smoked cheese', 'cheese', false],
  ['suitsutatud', 'suitsutatud lõhe', 'smoked salmon', true],
  ['pickled', 'pickled onions', 'onion', false],
  ['ground', 'ground walnuts', 'walnuts', false],
  ['boneless', 'boneless chicken thighs', 'chicken thigh fillet', true],
  ['deboned', 'deboned chicken thighs', 'chicken thigh fillet', true],
  // "fillet" in the row name carries the boneless form
  ['fillet', 'boneless salmon', 'salmon fillet', true],
]

// A word with no matcher effect yet: each line gives the same row and flag without
// the word in FORM_WORDS, so it pins today's result, not the word. An Estonian form
// word is not stripped before the search, so its line is unsure from a weak score,
// not from the guard; a line with no form row lands sure on the exact row name. The
// catalogue writes an Estonian fillet as one compound ("lõhefilee"), which no
// boneless stem reads (HON-1579). A row is singular, so only "fillet" reads it.
const PINNED_LINES: FormWordLine[] = [
  ['konserveeritud', 'konserveeritud tomatid', 'tinned plum tomatoes', true],
  ['purgi', 'purgi kookospiim', 'coconut milk', false],
  ['külmutatud', 'külmutatud herned', 'frozen peas', true],
  ['kuivatatud', 'kuivatatud aprikoosid', 'dried apricots', true],
  ['marineeritud', 'marineeritud ingver', 'pickled ginger', true],
  ['jahvatatud', 'jahvatatud kaneel', 'cinnamon', false],
  ['fillets', 'chicken thigh fillets', 'chicken thigh fillet', true],
  // COOKING_MODIFIERS strips "kondita"; without that the line is unsure
  ['kondita', 'kondita seakarbonaad', 'pork chop', true],
  ['filee', 'lõhe filee', 'salmon fillet', false],
]

describe('matchIngredients on each form word', () => {
  it('has a recipe line for every form word', () => {
    const words = Object.values(FORM_WORDS).flatMap((form) => [...form.en, ...form.et])

    const lineWords = [...FORM_WORD_LINES, ...PINNED_LINES].map(([word]) => word)

    expect(lineWords.sort()).toEqual(words.sort())
  })

  it.each([...FORM_WORD_LINES, ...PINNED_LINES])(
    '%s: matches "%s" to %s, sure: %s',
    async (_, recipeName, rowName, sure) => {
      await seedCatalogue()

      expect(await matchOne(recipeName)).toMatchObject({
        type: 'matched',
        ingredient: { name: rowName },
        lowConfidence: !sure,
      })
    },
  )

  // The bare cut, not yet its fillet row: the guard does not find "kanakintsuliha" (HON-1579)
  it('matches "kondita kanakintsud" to chicken thigh, unsure', async () => {
    await seedCatalogue()

    expect(await matchOne('kondita kanakintsud')).toMatchObject({
      type: 'matched',
      ingredient: { name: 'chicken thigh' },
      lowConfidence: true,
    })
  })
})
