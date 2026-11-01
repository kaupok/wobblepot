import type { IngredientCategory } from '@/generated/prisma/enums'
import { singularize } from '@/lib/normalize-ingredient'

import type { FuzzyIngredientMatch } from './fuzzy-ingredient-match'
import { LOW_CONFIDENCE_THRESHOLD } from './recipe-confidence'

/**
 * Words for the form a food is sold in. Normalization strips some of them, but they
 * change the product: canned tomatoes are not fresh tomatoes (HON-1313). "canned"
 * and "tinned" are one form, written the catalogue's way.
 *
 * A bare meat or fish row is on the bone or whole, so "boneless" is a form too, and
 * the catalogue writes it "fillet": "boneless chicken thighs" is `chicken thigh
 * fillet` (HON-1480).
 *
 * An Estonian form word maps to the form the catalogue writes in English:
 * "suitsutatud paprika" is smoked, like "smoked paprika" (HON-1554). Every form names
 * its words in both languages, so a test can catch a missing pair (HON-1571).
 *
 * Roasting is a cooking step, not a form the shop sells, so "roasted", "röstitud" and
 * "praetud" are cooking modifiers: "roasted peanuts" is `peanuts`, sure (HON-1566).
 */
export const FORM_WORDS: Record<string, { en: string[]; et: string[] }> = {
  tinned: { en: ['canned', 'tinned'], et: ['konserveeritud', 'purgi'] },
  frozen: { en: ['frozen'], et: ['külmutatud'] },
  dried: { en: ['dried'], et: ['kuivatatud'] },
  smoked: { en: ['smoked'], et: ['suitsutatud'] },
  pickled: { en: ['pickled'], et: ['marineeritud'] },
  ground: { en: ['ground'], et: ['jahvatatud'] },
  boneless: { en: ['boneless', 'deboned', 'fillet', 'fillets'], et: ['kondita', 'filee'] },
}

const FORM_OF_WORD: Record<string, string> = Object.fromEntries(
  Object.entries(FORM_WORDS).flatMap(([form, { en, et }]) =>
    [...en, ...et].map((word) => [word, form]),
  ),
)

/**
 * The stems an Estonian catalogue name writes a form with. Estonian joins the form
 * to the food, so `smoked paprika` is "suitsupaprikapulber" and `pickled gherkins`
 * is "hapukurk": a stem anywhere in a word names the form.
 */
const ESTONIAN_FORM_STEMS: Record<string, string[]> = {
  tinned: ['konserveeritud', 'konserv'],
  frozen: ['külmutatud'],
  dried: ['kuivatatud'],
  smoked: ['suitsu'],
  pickled: ['marineeritud', 'hapu'],
  ground: ['jahvatatud'],
}

/**
 * The forms a bare row of this category may already be, so with no form row it is
 * right: `cumin` is ground and dried, `lentils` are dried (HON-1557) and `chickpeas`
 * the drained tin (HON-1549). A bare cut is the cut: "boneless pork chop" is
 * `pork chop` (HON-1480).
 */
const SHELF_FORMS_OF_CATEGORY: Partial<Record<IngredientCategory, string[]>> = {
  spice: ['dried', 'ground'],
  legume: ['dried', 'tinned'],
  carb: ['dried'],
}

function isShelfForm(form: string, match: FuzzyIngredientMatch): boolean {
  return form === 'boneless' || (SHELF_FORMS_OF_CATEGORY[match.category] ?? []).includes(form)
}

function wordsOf(name: string): string[] {
  return name.toLowerCase().trim().split(/\s+/)
}

function formsOf(name: string): Set<string> {
  return new Set(wordsOf(name).flatMap((word) => FORM_OF_WORD[word] ?? []))
}

/** True when the name carries one of the forms: "tinned chopped tomatoes" carries tinned. */
export function hasForm(name: string, forms: string[]): boolean {
  const named = formsOf(name)
  const words = wordsOf(name)
  return forms.some(
    (form) =>
      named.has(form) ||
      (ESTONIAN_FORM_STEMS[form] ?? []).some((stem) => words.some((word) => word.includes(stem))),
  )
}

/**
 * The forms the recipe name carries that the matched row lacks in either language:
 * "suitsutatud paprika" against `bell pepper` ("paprika") is smoked.
 */
export function missingForms(directName: string, match: FuzzyIngredientMatch): string[] {
  return [...formsOf(directName)].filter(
    (form) => !hasForm(match.name, [form]) && !hasForm(match.matchedName, [form]),
  )
}

/** Note words that say how to prepare the food, not which food it is. */
const PREPARATION_NOTE_WORDS = new Set([
  'and',
  'drained',
  'rinsed',
  'soaked',
  'overnight',
  'chopped',
  'diced',
  'sliced',
  'minced',
  'grated',
  'peeled',
  'halved',
  'cooked',
])

/**
 * The food part of a recipe name. A note after a comma that only says how to
 * prepare the food is dropped, so "chickpeas, drained" is "chickpeas", and
 * "drained" cannot pull it to `dried chickpeas`. A form word in the note still
 * names the product, so it moves to the front: "chickpeas, dried" is "dried
 * chickpeas" (HON-1549). A note that offers a choice or a condition ("fresh or
 * frozen", "thawed if frozen") or names two forms states no one form, so it is
 * dropped. Any other note word may name the food ("sugar, brown", "salmon,
 * fillet"), so the name is kept as written.
 */
export function foodNameOf(name: string): string {
  const [rawHead = '', ...notes] = name.split(',')
  if (notes.length === 0) return name
  const head = rawHead.trim()
  const noteWords = wordsOf(notes.join(' '))
  if (noteWords.includes('or') || noteWords.includes('if')) return head
  const isMovableForm = (word: string) =>
    FORM_OF_WORD[word] !== undefined && !word.startsWith('fillet') && word !== 'filee'
  if (!noteWords.every((word) => isMovableForm(word) || PREPARATION_NOTE_WORDS.has(word))) {
    return name
  }
  const headForms = formsOf(head)
  const noteForms = [
    ...new Set(
      noteWords.filter((word) => isMovableForm(word) && !headForms.has(FORM_OF_WORD[word]!)),
    ),
  ]
  if (new Set(noteForms.map((word) => FORM_OF_WORD[word])).size > 1) return head
  return [...noteForms, head].join(' ')
}

/** The recipe name in the catalogue's words, which say "tinned" for "canned". */
export function catalogueFormName(directName: string): string {
  return wordsOf(directName)
    .map((word) => (word === 'canned' ? 'tinned' : word))
    .join(' ')
}

/** The stem Estonian joins to a food for a form: "suitsutatud paprika" is "suitsupaprika". */
const COMPOUND_STEM_OF_WORD: Record<string, string> = {
  suitsutatud: 'suitsu',
  marineeritud: 'hapu',
}

/**
 * The recipe name as an Estonian compound, or undefined when it has no compound form
 * word. The catalogue's Estonian name joins the form to the food, so "suitsutatud
 * paprika" finds `smoked paprika` ("suitsupaprikapulber") only this way (HON-1554).
 */
export function compoundFormName(directName: string): string | undefined {
  const words = wordsOf(directName)
  const formWord = words.find((word) => COMPOUND_STEM_OF_WORD[word] !== undefined)
  const rest = words.filter((word) => word !== formWord)
  const food = rest.pop()
  if (!formWord || !food) return undefined
  return [...rest, `${COMPOUND_STEM_OF_WORD[formWord]}${food}`].join(' ')
}

/**
 * True when a fillet row lacks a cut word the recipe names between the food and
 * "fillet": "chicken leg fillet" is not `chicken fillet`, but "wild salmon fillet"
 * is `salmon fillet` (HON-1480).
 *
 * @param normalizedName - The normalized recipe name
 * @param rowName - The name the match was made on
 */
export function isOtherCutFillet(normalizedName: string, rowName: string): boolean {
  const rowWords = wordsOf(rowName).map(singularize)
  if (!rowWords.includes('fillet')) return false
  const cutWords = wordsOf(normalizedName).map(singularize)
  const from = cutWords.indexOf(rowWords[0] ?? '')
  const filletAt = cutWords.indexOf('fillet')
  const to = filletAt >= 0 ? filletAt : cutWords.length
  const cutBetween = from >= 0 && to > from ? cutWords.slice(from + 1, to) : []
  return cutBetween.some((word) => !rowWords.includes(word))
}

export type FormGuardResult =
  | { action: 'keep' }
  | { action: 'use'; matches: FuzzyIngredientMatch[] }
  | { action: 'flag'; alternatives: FuzzyIngredientMatch[] }

/**
 * Judge a match whose row lacks a form the recipe names. A form row is a row that
 * names the form and the same food, in either language: "tinned chopped tomatoes"
 * for "canned crushed tomatoes", "suitsupaprikapulber" for "suitsutatud paprika".
 *
 * - `use`: a direct-side list's top match is a form row at a sure score, so it replaces the winner.
 * - `flag`: the winner needs review. Form rows come first in the alternatives; with none,
 *   the winner's list does, so "smoked cheese" offers `cheese` but never saves it sure (HON-1554).
 * - `keep`: the winner stands: no form is missing, or with no form row the bare row may
 *   already be the form, as `cumin` is for "ground cumin".
 *
 * @param forms - The forms the winner lacks, from `missingForms`
 * @param normalizedName - The normalized recipe name; its last food word is the food, or all
 *   its words for a boneless cut
 * @param winnerList - The winning candidate's matches, top match first
 * @param directSide - Result lists for the direct name, its alias, its catalogue-form name
 *   and its Estonian compound
 *   (for a boneless cut, the normalized name with "fillet")
 */
export function guardFormMatch(
  forms: string[],
  normalizedName: string,
  winnerList: FuzzyIngredientMatch[],
  directSide: FuzzyIngredientMatch[][],
): FormGuardResult {
  if (forms.length === 0) return { action: 'keep' }

  // A cut is named by all its words: "boneless chicken thigh" is not `turkey thigh fillet`
  const normalizedWords = wordsOf(normalizedName)
    .filter((word) => FORM_OF_WORD[word] === undefined)
    .map(singularize)
  const foodWords = forms.includes('boneless') ? normalizedWords : normalizedWords.slice(-1)
  // An Estonian row joins the food into a compound: "paprika" is in "suitsupaprikapulber"
  const namesFood = (name: string) => {
    const rowWords = wordsOf(name).map(singularize)
    return foodWords.every((word) =>
      rowWords.some((rowWord) => rowWord === word || (word.length >= 4 && rowWord.includes(word))),
    )
  }
  const isFormRow = (match: FuzzyIngredientMatch) =>
    [match.name, match.matchedName].some(
      (name) => forms.every((form) => hasForm(name, [form])) && namesFood(name),
    )

  const sureLists = directSide.filter(
    (list) => list[0] && isFormRow(list[0]) && list[0].similarity >= LOW_CONFIDENCE_THRESHOLD,
  )
  const best = sureLists.sort((a, b) => b[0]!.similarity - a[0]!.similarity)[0]
  if (best) return { action: 'use', matches: best }

  const formRows = directSide
    .flat()
    .filter(isFormRow)
    .sort((a, b) => b.similarity - a.similarity)
  const winner = winnerList[0]
  if (formRows.length === 0 && winner && forms.every((form) => isShelfForm(form, winner))) {
    return { action: 'keep' }
  }

  const seen = new Set<string>()
  const alternatives = [...formRows, ...winnerList].filter((match) => {
    if (seen.has(match.id)) return false
    seen.add(match.id)
    return true
  })
  return { action: 'flag', alternatives: alternatives.slice(0, 3) }
}

/** The candidate searches `matchIngredients` ran, by name, and the names it built. */
export type FormGuardInput = {
  directName: string
  aliasName: string
  normalizedName: string
  normalizedAliasName: string
  matches: FuzzyIngredientMatch[]
  matchesByCandidate: Map<string, FuzzyIngredientMatch[]>
  search: (name: string) => Promise<FuzzyIngredientMatch[]>
}

/**
 * Run the form guard on the winning match: a recipe name with a form word must not
 * save sure as the bare row, "canned chopped tomatoes" as fresh `tomato` (HON-1313)
 * or "suitsutatud paprika" as `bell pepper` (HON-1554). A row a curated alias or
 * synonym names is the same food, so it is kept. The catalogue says "tinned" and
 * joins an Estonian form to the food, so the direct name is also searched those ways.
 */
export async function applyFormGuard(
  input: FormGuardInput,
): Promise<{ formGuard: FormGuardResult; matches: FuzzyIngredientMatch[] }> {
  const { directName, aliasName, normalizedName, normalizedAliasName, matches } = input
  const winner = matches[0]
  if (!winner) return { formGuard: { action: 'keep' }, matches }
  // A curated alias names the form when its source still carries it: the whole name's
  // alias, or the normalized name's when normalization kept every form word. So
  // "chicken fillets" ("chicken fillet" → "chicken breast") keeps `chicken breast`,
  // but "smoked prawns" ("prawn" → "prawns") is not `prawns`
  const normalizedForms = formsOf(normalizedName)
  const normalizedKeepsForms = [...formsOf(directName)].every((form) => normalizedForms.has(form))
  const aliasTargets = [
    aliasName !== directName ? aliasName : undefined,
    normalizedKeepsForms && normalizedAliasName !== normalizedName
      ? normalizedAliasName
      : undefined,
  ].filter((name): name is string => name !== undefined)
  const isAliasRow = [winner.name, winner.matchedName].some((name) =>
    aliasTargets.includes(name.toLowerCase()),
  )
  const forms = missingForms(directName, winner)
  if (forms.length === 0 || isAliasRow) return { formGuard: { action: 'keep' }, matches }

  const directSide = [input.matchesByCandidate.get(directName) ?? []]
  if (aliasName !== directName) directSide.push(input.matchesByCandidate.get(aliasName) ?? [])
  for (const formName of [catalogueFormName(directName), compoundFormName(directName)]) {
    if (formName && !input.matchesByCandidate.has(formName)) {
      directSide.push(await input.search(formName))
    }
  }
  // The catalogue names a boneless cut "<cut> fillet" (HON-1480)
  const filletName = `${normalizedName} fillet`
  if (forms.includes('boneless') && !input.matchesByCandidate.has(filletName)) {
    directSide.push(await input.search(filletName))
  }
  const formGuard = guardFormMatch(forms, normalizedName, matches, directSide)
  return { formGuard, matches: formGuard.action === 'use' ? formGuard.matches : matches }
}
