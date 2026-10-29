import { INGREDIENT_GROUPS } from '@/lib/household/ingredient-groups'
import { isDefaultLocale } from '@/lib/i18n/locales'
import { findSynonym } from '@/lib/ingredient-aliases'

/**
 * The rule that turns a household's "Ingredients to avoid" tags into
 * ingredient rows (HON-1321). Pure, so the unit tests read the rule and
 * `excluded-ingredients.ts` owns the query.
 *
 * A tag matches a row when its words appear, in order and as whole words, in
 * the row's English name or in one of its translated names. "mushroom" then
 * matches "shiitake mushroom", "egg" matches "egg noodles" but not
 * "eggplant", and "nut" does not match "nutmeg".
 *
 * A tag that is a group word of `ingredient-groups.ts` as a whole ("sausage",
 * "vorstid") also matches the group's rows by exact name (HON-1343), so
 * "sausage" excludes frankfurter and chorizo.
 */

/** An ingredient row with every name the rule reads. */
export interface ExclusionPoolRow {
  id: string
  name: string
  translations: readonly { locale: string; name: string }[]
}

/** The rows one tag excludes, named in the household's locale. */
export interface ExcludedMatch {
  tag: string
  ingredients: { id: string; name: string }[]
}

/**
 * The comparison key of one word: lower case, with an English plural ending
 * folded so that both forms meet ("berry" and "berries" are both "berri",
 * "tomatoes" is "tomato"). The key is not a real word. It is applied to the
 * tag and to the row alike, so only equality matters. "-us" and "-ss" words
 * ("hummus", "asparagus", "swiss") keep their "s". "leaves" and "leaf" do
 * not meet.
 */
export function wordKey(word: string): string {
  let key = word.toLowerCase()
  if (key.length > 3) {
    if (key.endsWith('ies')) key = `${key.slice(0, -3)}i`
    else if (/(?:oes|ches|shes|sses|xes|zes)$/.test(key)) key = key.slice(0, -2)
    else if (key.endsWith('s') && !/(?:ss|us|is)$/.test(key)) key = key.slice(0, -1)
  }
  if (key.length > 2 && key.endsWith('y')) key = `${key.slice(0, -1)}i`
  else if (key.endsWith('ie')) key = key.slice(0, -1)
  return key
}

function wordKeys(name: string): string[] {
  return (name.match(/\p{L}+/gu) ?? []).map(wordKey)
}

/**
 * An Estonian plural is the stem plus "d" ("seened" for "seen", "munad" for
 * "muna"), so a tag word ending in "d" also matches a translated word it
 * extends by one or two letters. Translated names only: in English this
 * would read "seed" as "see".
 */
function translatedWordMatches(tagWord: string, word: string): boolean {
  if (tagWord === word) return true
  const extra = tagWord.length - word.length
  return tagWord.endsWith('d') && extra >= 1 && extra <= 2 && tagWord.startsWith(word)
}

/** Whether `term` appears as a run of whole words in `name`. */
function containsWords(
  name: string[],
  term: string[],
  same: (tagWord: string, word: string) => boolean,
): boolean {
  if (term.length === 0) return false
  return name.some((_, start) =>
    term.every((tagWord, i) => {
      const word = name[start + i]
      return word !== undefined && same(tagWord, word)
    }),
  )
}

const sameWord = (tagWord: string, word: string) => tagWord === word

/** The group words as word keys, and each group's members in lower case. */
const GROUPS = INGREDIENT_GROUPS.map((group) => ({
  en: group.en.map(wordKeys),
  et: group.et.map(wordKeys),
  members: new Set(group.members.map((member) => member.toLowerCase())),
}))

/**
 * The rows of every group that has the whole tag as a group word. A tag that
 * only contains the word ("smoked sausage") stays narrow. Members match by
 * exact name, not as search terms, so "wieners" does not reach a "hot dog
 * bun" row.
 */
function groupRows(
  tagWords: string[],
  pool: readonly ExclusionPoolRow[],
  side: 'en' | 'et',
  same: (tagWord: string, word: string) => boolean,
): ExclusionPoolRow[] {
  const members = new Set(
    GROUPS.filter((group) =>
      group[side].some(
        (word) =>
          word.length === tagWords.length &&
          tagWords.every((tagWord, i) => {
            const groupWord = word[i]
            return groupWord !== undefined && same(tagWord, groupWord)
          }),
      ),
    ).flatMap((group) => [...group.members]),
  )
  if (members.size === 0) return []
  return pool.filter((row) => members.has(row.name.toLowerCase()))
}

/**
 * The terms a tag searches for in English: the tag, and the pool name
 * `findSynonym` gives for it ("eggplant" → "aubergine", HON-1097). The
 * singular is looked up too, because the synonym table holds singulars.
 */
function englishTerms(tag: string): string[][] {
  const singular = tag.trim().replace(/s$/i, '')
  const terms = [tag, findSynonym(tag), findSynonym(singular)].filter(
    (term): term is string => term !== undefined,
  )
  return terms.map(wordKeys)
}

/**
 * Every row of `pool` that `tag` excludes.
 *
 * Some English names are also Estonian words with another meaning: "paprika"
 * is the spice in English and bell pepper in Estonian. So the household's
 * locale decides. An English household reads the translated names only when
 * the tag matches no English name, so its "paprika" is the spice. Any other
 * household reads them too, so an Estonian "paprika" excludes bell pepper as
 * well as the spice.
 *
 * A row matched through a translated name adds its English name as a term,
 * so the Estonian name of "mushroom" excludes the same rows as "mushroom".
 * Estonian writes most kinds as one word ("austriseen" for oyster mushroom),
 * so the translated names alone would miss them.
 *
 * A tag that is a group word adds the group's rows. English group words apply
 * in every locale. Estonian group words apply where the translated names do,
 * so an English household's "vorst" still excludes the sausages.
 */
export function matchTag(
  tag: string,
  pool: readonly ExclusionPoolRow[],
  locale: string,
): ExclusionPoolRow[] {
  const byEnglish = (row: ExclusionPoolRow, search: string[][]) => {
    const name = wordKeys(row.name)
    return search.some((term) => containsWords(name, term, sameWord))
  }

  const terms = englishTerms(tag)
  const tagWords = wordKeys(tag)
  const matched = new Set(pool.filter((row) => byEnglish(row, terms)))
  for (const row of groupRows(tagWords, pool, 'en', sameWord)) matched.add(row)
  if (matched.size > 0 && isDefaultLocale(locale)) return [...matched]

  const viaTranslation = pool.filter(
    (row) =>
      !matched.has(row) &&
      row.translations.some((t) =>
        containsWords(wordKeys(t.name), tagWords, translatedWordMatches),
      ),
  )
  const englishNames = viaTranslation.map((row) => wordKeys(row.name))
  for (const row of pool) if (byEnglish(row, englishNames)) matched.add(row)
  for (const row of viaTranslation) matched.add(row)
  for (const row of groupRows(tagWords, pool, 'et', translatedWordMatches)) matched.add(row)
  return [...matched]
}

/** The row's name in `locale`, or its English name when it has no translation. */
function displayName(row: ExclusionPoolRow, locale: string): string {
  return row.translations.find((t) => t.locale === locale)?.name ?? row.name
}

/** Every tag with the rows it excludes, in tag order, each list sorted by name. */
export function matchTags(
  tags: readonly string[],
  pool: readonly ExclusionPoolRow[],
  locale: string,
): ExcludedMatch[] {
  return tags.map((tag) => ({
    tag,
    ingredients: matchTag(tag, pool, locale)
      .map((row) => ({ id: row.id, name: displayName(row, locale) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale)),
  }))
}
