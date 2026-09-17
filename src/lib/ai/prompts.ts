import { toDateString } from '@/lib/meal-planning/dates'
import { DEFAULT_LOCALE } from '@/lib/i18n/locales'
import type { PromptInput, CandidatePools } from './types'
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
 * to pre-i18n behaviour. This is the locale-generic plumbing; the
 * Estonian-specific voice lives in the `estonianVoiceFor*` helpers below.
 */
export function localeInstruction(locale: string | null | undefined): string {
  if (!locale || locale === DEFAULT_LOCALE) return ''
  const label = LOCALE_LABELS[locale] ?? locale
  return `\n\nLOCALE: Produce all user-visible output (names, descriptions, free-text fields) in ${label}. Ingredient names stay lowercase singular base form.`
}

const ESTONIAN = 'et'

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
 * Estonian voice block for imagine-meal: meal names, descriptions, and the
 * ingredient name / originalText split. Empty for every other locale so the
 * English prompt stays byte-identical.
 */
export function estonianVoiceForImagineMeal(locale: string | null | undefined): string {
  if (locale !== ESTONIAN) return ''
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
- ingredient: name "kanafilee", originalText "500 g kanafileed"
- ingredient: name "sibul", originalText "2 sibulat"
- ingredient: name "hapukoor", originalText "2 spl hapukoort"
- ingredient: name "oliiviõli", originalText "1 spl oliiviõli" (not name "olive oil")
- ingredient: name "sool", originalText "soola maitse järgi", isVague true, vaguePhrase "to taste" (vaguePhrase is a matcher key and stays English: "to taste", "a pinch", "for garnish", "optional"; only originalText is Estonian prose)`
}

/**
 * Estonian voice block for recipe parsing: dish name, description, numbered
 * preparation notes, and nominative ingredient keys even when the source text
 * inflects them. Empty for every other locale.
 */
export function estonianVoiceForRecipeParse(locale: string | null | undefined): string {
  if (locale !== ESTONIAN) return ''
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
  if (locale !== ESTONIAN) return ''
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
    prompt += `\n- Dietary preferences (best effort): ${restrictions.join(', ')}`
  }

  prompt += `

Return exactly ${totalEntries} entries covering ${toDateString(firstEntryDate)} through ${toDateString(lastDay)}.
Each entry must include: date (YYYY-MM-DD format), mealType (breakfast/lunch/dinner), and mealId.`

  prompt += localeInstruction(locale)

  return prompt
}
