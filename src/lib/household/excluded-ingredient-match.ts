import {
  ESTONIAN_FALSE_FRIENDS,
  ESTONIAN_TAG_FORMS,
  ESTONIAN_WHOLE_WORD_ONLY,
} from '@/lib/household/estonian-tag-forms'
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
 *
 * Estonian writes most foods as compounds, so a one-word tag also matches as
 * part of a word in a translated name (HON-1477): "kana" matches
 * "kanafilee". English names keep the whole-word rule.
 */

/** An ingredient row with every name the rule reads. */
export interface ExclusionPoolRow {
  id: string
  name: string
  /** Set on a household's own row, whose `name` is in the household's language. */
  householdId?: string | null
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
  keepParts: group.keepParts === true,
}))

/** The groups that have the whole tag as a group word. */
function groupsOf(
  tagWords: string[],
  side: 'en' | 'et',
  same: (tagWord: string, word: string) => boolean,
) {
  return GROUPS.filter((group) =>
    group[side].some(
      (word) =>
        word.length === tagWords.length &&
        tagWords.every((tagWord, i) => {
          const groupWord = word[i]
          return groupWord !== undefined && same(tagWord, groupWord)
        }),
    ),
  )
}

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
  const members = new Set(groupsOf(tagWords, side, same).flatMap((group) => [...group.members]))
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

/** The shortest form the part-of-word rule reads; "või" and "oad" stay whole. */
const MIN_PART_LENGTH = 4

/** The lower-case words of a name, unfolded: the part-of-word rule reads Estonian. */
function plainWords(name: string): string[] {
  return name.toLowerCase().match(/\p{L}+/gu) ?? []
}

/**
 * The forms the Estonian part-of-word rule finds inside a word, or none when
 * the tag matches whole words only. The forms are the tag, the tag without a
 * final "d" (plural "herned") or "s" ("kapsas" → "kapsa"), and the stems of
 * `ESTONIAN_TAG_FORMS`. A multi-word tag, a group word (its group lists its
 * rows, which keeps "kala" off "kalamata oliiv") unless the group sets
 * `keepParts`, and a tag in `ESTONIAN_WHOLE_WORD_ONLY`, or its plural
 * ("pastad"), get none.
 */
function partForms(tag: string): string[] {
  const words = plainWords(tag)
  const [word] = words
  if (word === undefined || words.length > 1) return []
  if ([...ESTONIAN_WHOLE_WORD_ONLY].some((key) => readsAs(word, key))) return []
  const tagWords = [wordKey(word)]
  const isWholeWordGroup = [
    ...groupsOf(tagWords, 'en', sameWord),
    ...groupsOf(tagWords, 'et', translatedWordMatches),
  ].some((group) => !group.keepParts)
  if (isWholeWordGroup) return []

  // A plural tag reads the table too: "kurgid" gets "kurk" and "kurgi".
  const forms = [
    word,
    ...Object.entries(ESTONIAN_TAG_FORMS)
      .filter(([key]) => readsAs(word, key))
      .flatMap(([key, stems]) => [key, ...stems]),
  ]
  const stem = withoutEnding(word)
  if (stem !== word) forms.push(stem)
  return forms.filter((form) => form.length >= MIN_PART_LENGTH)
}

/** The word without a final "d" (plural) or "s", when it has 5 letters or more. */
function withoutEnding(word: string): string {
  return word.length >= 5 && /[ds]$/.test(word) ? word.slice(0, -1) : word
}

/**
 * Whether `word` is the table key `key`, one of its forms, or a plural of
 * one: "tomatid" reads as "tomat", "lambad" as "lammas", "pastad" as "pasta".
 */
function readsAs(word: string, key: string): boolean {
  return [key, withoutEnding(key), ...(ESTONIAN_TAG_FORMS[key] ?? [])].some((form) =>
    translatedWordMatches(word, form),
  )
}

/** The false friends of the tag, and of the word the tag is a plural of. */
function falseFriendsOf(tag: string): string[] {
  const word = tag.trim().toLowerCase()
  return Object.entries(ESTONIAN_FALSE_FRIENDS)
    .filter(([key]) => readsAs(word, key))
    .flatMap(([, friends]) => friends)
}

/**
 * Whether `tag` matches a translated name: as whole words, or as part of a
 * word (HON-1477). A name that holds one of the tag's false friends does not
 * match at all.
 */
function translatedNameTest(
  tag: string,
  holdsFalseFriend: (name: string) => boolean,
): (name: string) => boolean {
  const tagWords = wordKeys(tag)
  const parts = partForms(tag)
  return (name) => {
    if (holdsFalseFriend(name)) return false
    return (
      containsWords(wordKeys(name), tagWords, translatedWordMatches) ||
      plainWords(name).some((word) => parts.some((part) => word.includes(part)))
    )
  }
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
 * so the translated names alone would miss them. A row this term reaches is
 * left out when a translated name holds a false friend of the tag, so
 * "kirss" reaches "cherry" but not "cherry tomatoes".
 *
 * A tag that is a group word adds the group's rows. English group words apply
 * in every locale. Estonian group words apply where the translated names do,
 * so an English household's "vorst" still excludes the sausages.
 *
 * A household's own row has only the name the household typed. For a
 * household whose locale is not the default, that name is read like a
 * translated name, but it adds no English term: it is not English.
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

  const falseFriends = falseFriendsOf(tag)
  const holdsFalseFriend = (name: string) => {
    const lower = name.toLowerCase()
    return falseFriends.some((friend) => lower.includes(friend))
  }
  const matchesTranslated = translatedNameTest(tag, holdsFalseFriend)
  const ownNameIsTranslated = !isDefaultLocale(locale)
  const viaTranslation = pool.filter((row) => {
    if (matched.has(row)) return false
    const names = row.translations.map((t) => t.name)
    if (ownNameIsTranslated && row.householdId) names.push(row.name)
    return names.some(matchesTranslated)
  })
  const englishNames = viaTranslation
    .filter((row) => !row.householdId)
    .map((row) => wordKeys(row.name))
  for (const row of pool) {
    const blocked = row.translations.some((t) => holdsFalseFriend(t.name))
    if (!blocked && byEnglish(row, englishNames)) matched.add(row)
  }
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
