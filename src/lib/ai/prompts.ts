import { toDateString } from '@/lib/meal-planning/dates'
import { DEFAULT_LOCALE, isKnownLocale } from '@/lib/i18n/locales'
import { MealPlanResponseSchema, type PromptInput, type CandidatePools } from './types'
import { slotKey } from './slot-key'
import type { MealSlot, SlotRequirement } from '@/lib/meal-planning/slots'
import type { CandidateMeal } from '@/lib/meal-planning/candidates'
import type { MealType } from '@/generated/prisma/enums'

const LOCALE_LABELS: Record<string, string> = {
  en: 'English',
  et: 'Estonian',
}

/**
 * AI-prompt-specific date format ("Mon 2026-01-12"). Machine-stable and
 * locale-agnostic by design — the user never sees this string, and Claude
 * parses it consistently regardless of the household locale.
 */
const AI_WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const
function formatDateForPrompt(date: Date): string {
  return `${AI_WEEKDAY_SHORT[date.getDay()]} ${toDateString(date)}`
}

/**
 * Minimal localized-output instruction block appended to AI prompts. Returns
 * an empty string for the default locale so English flows are byte-identical
 * to pre-i18n behaviour, and for a locale outside `KNOWN_LOCALES`, so a locale
 * rolled back out of that list gets English output (HON-921). This is the
 * locale-generic plumbing; the Estonian-specific voice lives in the
 * `estonianVoiceFor*` helpers below.
 */
export function localeInstruction(locale: string | null | undefined): string {
  if (!locale || locale === DEFAULT_LOCALE || !isKnownLocale(locale)) return ''
  const label = LOCALE_LABELS[locale] ?? locale
  return `\n\nLOCALE: Produce all user-visible output (names, descriptions, free-text fields) in ${label}. Ingredient names stay lowercase singular base form.`
}

const ESTONIAN = 'et'

// `isKnownLocale` too, so removing `et` from `KNOWN_LOCALES` switches the voice
// blocks off even for a caller that passed the raw household locale (HON-921).
export function isEstonian(locale: string | null | undefined): boolean {
  return locale === ESTONIAN && isKnownLocale(locale)
}

/**
 * Register and formatting rules shared by every Estonian voice block. Distilled
 * from docs/AI_VOICE_ET.md — change the doc first, then mirror it here.
 */
const ESTONIAN_VOICE_RULES = `ESTONIAN VOICE:
- Casual, warm, sina-form. Present tense, active voice. Plain kitchen words (prae, keeda, hauta, sega, haki, küpseta).
- No marketing filler (tervislik, tasakaalustatud, maitsev, ideaalne, suurepärane) and no padding (palun, nüüd on aeg, ärge unustage).
- Ingredient "name" fields are Estonian too, every one of them, including oils, spices, and seasonings (olive oil → oliiviõli, black pepper → must pipar, salt → sool). Never leave an ingredient name in English. Form: lowercase nominative singular, the everyday shop word rather than the botanical or official term (brokkoli not spargelkapsas, kanakoib not kana reieliha, kanafilee not kana rinnafilee), with no parentheticals or qualifiers in the name itself. Prose after a quantity inflects to the partitive (500 g kanafileed, 2 sibulat, 1 tl soola, soola maitse järgi).
- Latin letters only, with Estonian diacritics (õ ä ö ü š ž). Never a Cyrillic or other look-alike character inside a word.
- Metric with a space before the unit (200 °C, 500 g, 2 dl), en dash in ranges (5–6 minutit), decimal comma (1,5 kg). These formats take precedence over any unit examples earlier in this prompt. Estonian abbreviations in prose: spl (tbsp), tl (tsp), tk (piece).`

/**
 * Estonian voice block for imagine-meal: meal names, descriptions, and
 * nominative ingredient names. The model writes no ingredient prose since
 * HON-897; the route rebuilds that line. Empty for every other locale so the
 * English prompt stays byte-identical.
 */
export function estonianVoiceForImagineMeal(locale: string | null | undefined): string {
  if (!isEstonian(locale)) return ''
  return `

${ESTONIAN_VOICE_RULES}
- Meal names: idiomatic Estonian, 2–4 words, sentence case (capitalise only the first word and proper nouns). Prefer compound nouns (Kanakarri, Kõrvitsasupp, Kodujuustukauss), "with" as the -ga ending (Ahjulõhe sparglitega), and ahju- for baked/roasted/sheet-pan. Never a word-for-word calque of an English name; drop appliance words (slow cooker, one-pot, skillet). Keep international dish names (Ratatouille, Pad Thai, Bolognese, teriyaki, wok).
- Descriptions: one or two sentences, present tense, what is on the plate and one thing about how it got there (mahlane, krõbe, kreemjas, kuldne, röstitud). No instructions, temperatures, or nutrition words.

ESTONIAN EXAMPLES (English-shaped draft → what to output):
- name: "Creamy Garlic Chicken Pasta" → "Kanapasta küüslaugukastmes"
- name: "Sheet Pan Chicken and Veggies" → "Ahjukana köögiviljadega"
- name: "Slow Cooker Beef Stew" → "Veiselihahautis"
- name: "Chicken Rice Bowl" → "Kanariis"
- description: "This dish contains chicken, rice and vegetables and is high in protein." → "Mahlane kanafilee aurutatud riisi ja krõmpsuvate köögiviljadega."
- description: "A healthy and balanced meal for the whole family." → "Kiire argipäeva õhtusöök, mis meeldib ka lastele."
- ingredient: name "kanafilee", quantity 500, unit "g" (not name "kanafileed")
- ingredient: name "sibul", quantity 2, unit "piece" (not name "sibulat")
- ingredient: name "hapukoor", quantity 2, unit "tbsp"
- ingredient: name "oliiviõli", quantity 1, unit "tbsp" (not name "olive oil")
- ingredient: name "sool", quantity null, unit null, vaguePhrase "to taste" (vaguePhrase is a matcher key and stays English: "to taste", "a pinch", "for garnish", "optional")`
}

/**
 * Estonian voice block for recipe parsing: dish name, description, numbered
 * preparation notes, and nominative ingredient keys even when the source text
 * inflects them. Empty for every other locale.
 */
export function estonianVoiceForRecipeParse(locale: string | null | undefined): string {
  if (!isEstonian(locale)) return ''
  return `

${ESTONIAN_VOICE_RULES}
- name: an idiomatic Estonian dish name, not a calque of the source title. Sentence case, 2–4 words. Keep international names as-is (Ratatouille, Pad Thai, Bolognese).
- description: one or two sentences, present tense, no instructions.
- preparationNotes: numbered steps, each starting with an imperative sina-form verb (Kuumuta, Haki, Prae, Lisa, Sega, Küpseta, Serveeri). Never teie-form ("Kuumutage"), never "tuleb" / "tuleks" / "peaks". Convert Fahrenheit, cups, and ounces to metric.
- Ingredient name: the nominative singular everyday word even when the source text inflects it ("2 sibulat, hakitud" → name "sibul"; "500 g kanafileed" → name "kanafilee"; "soola maitse järgi" → name "sool", isVague true, vaguePhrase "to taste").
- vaguePhrase is a matcher key, not prose: always the English phrase from the VAGUE QUANTITY DETECTION list above ("to taste", "a pinch", "for garnish", "optional"), never its Estonian equivalent. Only originalText carries the Estonian wording.

ESTONIAN EXAMPLES (source text → what to output):
- title "Shepherd's Pie" → name "Karjusepirukas"
- title "Baked Salmon with Asparagus" → name "Ahjulõhe sparglitega"
- title "Grilled Cheese Sandwich" → name "Kuum juustuvõileib"
- "Preheat the oven to 400°F and bake for 25 minutes." → "1. Kuumuta ahi 200 °C-ni.\n2. Küpseta 25 minutit."
- "Kõigepealt tuleks sibul peeneks hakkida ja pannil klaasjaks praadida." → "1. Haki sibul peeneks.\n2. Prae sibul pannil klaasjaks."
- "Fry the chicken until golden, about 5-6 minutes per side." → "Prae kana kuldpruuniks, 5–6 minutit kummaltki poolt."
- ingredient "2 sibulat, hakitud" → name "sibul", quantity 2, unit "piece", originalText "2 sibulat, hakitud"
- ingredient "500 g kanafileed" → name "kanafilee", quantity 500, unit "g", originalText "500 g kanafileed"`
}

/**
 * Estonian voice block for preparation tips (full and supplementary):
 * equipment, steps, pitfalls, tip — all in sina-form imperative. Empty for
 * every other locale.
 */
export function estonianVoiceForPrepTips(locale: string | null | undefined): string {
  if (!isEstonian(locale)) return ''
  return `

${ESTONIAN_VOICE_RULES}
- equipment: specific noun phrases (Suur ahjukindel pann, Kaanega pott, Terav nuga ja lõikelaud), not bare "Pann".
- steps: start with the verb, one action per step, sina-form imperative. Never teie-form ("Kuumutage"), never "tuleb" / "tuleks" / "peaks", never "nüüd on aeg".
- pitfalls: name the mistake and its consequence in one sentence.
- tip: one practical sentence.

ESTONIAN EXAMPLES (draft → what to output):
- step: "Kuumutage ahi 200 kraadini." → "Kuumuta ahi 200 °C-ni."
- step: "Kana tuleb pannil kuldpruuniks praadida, umbes 5–6 minutit mõlemalt poolt." → "Prae kana pannil kuldpruuniks, 5–6 minutit kummaltki poolt."
- step: "Nüüd on aeg lisada riis ja segada see hoolikalt teiste koostisosadega läbi." → "Lisa riis ja sega läbi."
- pitfall: "Don't overcrowd the pan." → "Ära pane liiga palju kana korraga pannile: liha hakkab hauduma, mitte pruunistuma."
- tip: "Let the meat rest before slicing." → "Lase lihal enne lõikamist 5 minutit puhata, siis jääb see mahlasem."`
}

/**
 * English voice block for preparation tips (full and supplementary): the
 * counterpart of `estonianVoiceForPrepTips`, so a step can be read at a glance
 * from across the counter (HON-963). Empty for Estonian, so exactly one of the
 * two blocks is non-empty for a locale and the Estonian prompt is unchanged.
 */
export function englishVoiceForPrepTips(locale: string | null | undefined): string {
  if (isEstonian(locale)) return ''
  return `

ENGLISH VOICE:
- equipment: 3–5 short noun phrases of 2–5 words each (Two large woks, Large stockpot, Chef's knife and cutting boards, Slotted spoon and tongs). No reasons and no brackets.
- steps: start with the verb. One action per step; two only when they happen at the same time ("While the water heats, slice the beef"). At most two sentences and 25 words per step. Never more than 6 steps: on a meal with many parts, fold a small task into the step it happens alongside rather than dropping it.
- short, not vague: cut reasons, asides and repetition, never the facts. Keep each step's time, heat level, doneness cue and seasoning, and the number that avoids each pitfall.
- pitfalls: name the mistake and its consequence in one sentence, specific to this dish. Each pitfall names a different problem.
- tip: one sentence that adds something new: never repeat a step, a pitfall or the user's notes.
- punctuation: never join clauses with a dash (" - ", " – " or "—"). Use a colon, a semicolon or a new sentence. Write a range with an en dash and no spaces: "60–90 seconds", "4–5 batches".

ENGLISH EXAMPLES (draft → what to output):
- equipment: "Two large 36cm flat-bottom woks or heavy skillets (to cook in batches over high heat)" → "Two large woks"
- equipment: "Sharp chef's knife and two large cutting boards (one for meat, one for vegetables)" → "Chef's knife and cutting boards"
- step: "While water heats, slice beef thinly against the grain (about 0.5cm thick) - partially freezing the steak for 10 minutes makes slicing much faster. Toss slices with part of the soy sauce and a splash of oil to marinate." → two steps: "While the water heats, slice the beef thinly against the grain." and "Toss the beef with half the soy sauce and a splash of oil."
- step: "Sear the beef for 60-90 seconds - cook in 4-5 batches so the wok stays hot." → "Sear the beef in 4–5 batches, 60–90 seconds each, so the wok stays hot."
- step: "Fry the onions in butter over a medium-low heat, stirring now and then so they don't catch, until they are soft and golden, which should take around 10-12 minutes or so." → "Fry the onions in butter over medium-low heat for 10–12 minutes, until soft and golden."
- pitfall: "Leaving the broccoli wet - it turns mushy." → "Wet broccoli steams in the wok and turns mushy, so drain it well."
- tip: "Partially freezing the steak for 10 minutes makes slicing much faster, and it also helps you get thinner, more even slices." → "Freeze the steak for 10 minutes before slicing; it cuts thinner and faster."`
}

/**
 * Format a candidate pool for the AI prompt.
 * Includes personalization flags to help AI prefer household favorites.
 */
function formatCandidates(candidates: CandidateMeal[]): Array<{
  id: string
  name: string
  proteinType: string
  kidFriendly: boolean
  isFavorite: boolean
  isCustom: boolean
}> {
  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    proteinType: c.primaryProteinType,
    kidFriendly: c.kidFriendly,
    isFavorite: c.isFavorite,
    isCustom: c.isCustom,
  }))
}

/**
 * Format required slots section of the prompt.
 */
function formatRequiredSlots(slots: SlotRequirement[], pools: CandidatePools): string {
  if (slots.length === 0) {
    return 'No required protein slots for this dietary type.'
  }

  return slots
    .map((slot) => {
      const pool = slot.proteinType === 'fish' ? pools.fish : pools.legume
      const formattedCandidates = JSON.stringify(formatCandidates(pool))
      return `- ${formatDateForPrompt(slot.date)} ${slot.mealType}: MUST be ${slot.proteinType.toUpperCase()}
  Candidates: ${formattedCandidates}`
    })
    .join('\n')
}

/**
 * Format remaining slots section grouped by meal type.
 */
function formatRemainingSlots(
  slots: MealSlot[],
  candidatesByMealType: Map<MealType, CandidateMeal[]>,
  dinnerPool: CandidateMeal[],
): string {
  if (slots.length === 0) {
    return 'No additional slots to fill.'
  }

  // Group remaining slots by meal type
  const slotsByMealType = new Map<MealType, MealSlot[]>()
  for (const slot of slots) {
    const existing = slotsByMealType.get(slot.mealType) ?? []
    existing.push(slot)
    slotsByMealType.set(slot.mealType, existing)
  }

  const sections: string[] = []

  for (const [mealType, mealSlots] of slotsByMealType) {
    const dates = mealSlots.map((s) => formatDateForPrompt(s.date)).join(', ')
    // For dinner, use the "any" pool (which is dinner candidates)
    // For other meal types, use their specific pool
    const candidates =
      mealType === 'dinner' ? dinnerPool : (candidatesByMealType.get(mealType) ?? [])
    const candidatesText = JSON.stringify(formatCandidates(candidates))

    sections.push(`${mealType.toUpperCase()} slots: ${dates}
Candidates: ${candidatesText}`)
  }

  return sections.join('\n\n')
}

/**
 * Compute the actual first date from required slots and remaining slots.
 * For partial weeks, this may be later than startDate.
 */
function getFirstEntryDate(
  requiredSlots: SlotRequirement[],
  remainingSlots: MealSlot[],
): Date | null {
  const slotDates = requiredSlots.map((s) => s.date)
  const remainingDates = remainingSlots.map((s) => s.date)
  const allDates = [...slotDates, ...remainingDates]

  if (allDates.length === 0) return null

  return allDates.reduce((earliest, d) => (d < earliest ? d : earliest))
}

/**
 * Build the complete prompt for AI meal plan generation.
 */
export function buildMealPlanPrompt(
  input: PromptInput & { candidatesByMealType?: Map<MealType, CandidateMeal[]> },
): string {
  const {
    endDate,
    totalEntries,
    requiredSlots,
    remainingSlots,
    candidatePools,
    restrictions,
    candidatesByMealType,
    pantryIngredients,
    locale,
  } = input

  // Calculate last day (endDate is exclusive, so subtract 1 day)
  const lastDay = new Date(endDate)
  lastDay.setDate(lastDay.getDate() - 1)

  // Get the actual first date (may differ from startDate for partial weeks)
  const firstEntryDate = getFirstEntryDate(requiredSlots, remainingSlots) ?? lastDay

  const slotsText = formatRequiredSlots(requiredSlots, candidatePools)
  const remainingText = formatRemainingSlots(
    remainingSlots,
    candidatesByMealType ?? new Map(),
    candidatePools.any,
  )

  // Collect all meal types being planned
  const allMealTypes = new Set<MealType>()
  for (const slot of requiredSlots) {
    allMealTypes.add(slot.mealType)
  }
  for (const slot of remainingSlots) {
    allMealTypes.add(slot.mealType)
  }
  const mealTypesStr = [...allMealTypes].join(', ')

  let prompt = `Select meals for the meal plan (${mealTypesStr}).

REQUIRED PROTEIN SLOTS (must pick from specified candidates):
${slotsText}

REMAINING SLOTS:
${remainingText}

VARIETY RULES:
- No same proteinType on consecutive days for the same meal type
- Mix kid-friendly and adult meals
- Each meal can only be used once across all slots (no duplicates)

PERSONALIZATION:
- Prefer meals marked isFavorite=true (household explicitly favorited these)
- Prefer meals marked isCustom=true (household created/imported these)
- Balance personalization with variety - don't only pick favorites`

  if (pantryIngredients && pantryIngredients.length > 0) {
    prompt += `

PANTRY (ingredients the household already has):
${pantryIngredients.join(', ')}
- When choosing between equally suitable meals, prefer ones that use these ingredients
- This is a soft preference, not a hard constraint — variety and balance still come first`
  }

  if (restrictions.length > 0) {
    // A section of its own, so the line is not read as one more bullet of the
    // PANTRY or PERSONALIZATION soft preferences above it (HON-896).
    prompt += `\n\nHOUSEHOLD RESTRICTIONS (best effort):\n- ${restrictions.join(', ')}`
  }

  prompt += `

Return exactly ${totalEntries} entries covering ${toDateString(firstEntryDate)} through ${toDateString(lastDay)}.
Each entry must include: date (YYYY-MM-DD format), mealType (breakfast/lunch/dinner), and mealId.`

  prompt += localeInstruction(locale)

  return prompt
}

/**
 * Input for `buildMealPlanRequest`: everything plan generation reads from the
 * database, already loaded. `slots` are the replaceable slots — the configured
 * slots minus any kept `completed` entry.
 */
export interface MealPlanRequestInput {
  startDate: Date
  endDate: Date
  slots: MealSlot[]
  requiredSlots: SlotRequirement[]
  candidatePools: CandidatePools
  candidatesByMealType: Map<MealType, CandidateMeal[]>
  restrictions: string[]
  pantryIngredients: string[]
  locale: string
}

/**
 * Every `generateObject` argument plan generation sends except `model` and
 * `abortSignal`. Pure, so the model benchmark (HON-795) sends the request
 * production sends without a database (HON-796).
 *
 * Derives `totalEntries` and the slots left after the required protein slots
 * here rather than in `generateMealPlan`, so a caller never has to copy that
 * logic to build the same prompt.
 */
export function buildMealPlanRequest(input: MealPlanRequestInput) {
  const { slots, requiredSlots } = input
  const requiredSlotKeys = new Set(requiredSlots.map((s) => slotKey(s.date, s.mealType)))
  const remainingSlots = slots.filter((s) => !requiredSlotKeys.has(slotKey(s.date, s.mealType)))

  return {
    schema: MealPlanResponseSchema,
    prompt: buildMealPlanPrompt({
      startDate: input.startDate,
      endDate: input.endDate,
      totalEntries: slots.length,
      requiredSlots,
      remainingSlots,
      candidatePools: input.candidatePools,
      restrictions: input.restrictions,
      candidatesByMealType: input.candidatesByMealType,
      pantryIngredients: input.pantryIngredients,
      locale: input.locale,
    }),
  }
}
