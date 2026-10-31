/**
 * The cook-question task: its scorer and its `TaskSpec`, apart from
 * `tasks.ts` and `scorers.ts` because both sit near the file-size cap
 * (HON-1506), as `adjust.ts` is.
 */

import { generateText, NoObjectGeneratedError } from 'ai'

import { COOK_QUESTION_AI_BUDGET_MS } from '../../src/lib/ai/budgets'
import { buildCookQuestionRequest } from '../../src/lib/ai/cook-question'
import { findUnexcusedKeyword, normalizeFoodName } from '../../src/lib/ai/forbidden-foods'
import { COOK_QUESTION_MODEL } from '../../src/lib/ai/models'
import type { CookQuestionCase } from './case-schema'
import { textOf } from './request-texts'
import { pass, type Scores } from './scorers'
import type { TaskSpec } from './tasks'

/**
 * Word ceilings for the answer. The off-topic one is from the first run
 * (HON-972): a decline ran 31 to 40 words because it offers help with the
 * step. The answer one is from HON-1003, after the prompt gained "never more
 * than 4" sentences and "under 80 words": over three runs of 24 on-topic
 * answers each, they measured 33 to 90 words, the longest an equipment
 * answer. So it fails an answer the cook cannot read at a glance, not a few
 * words over the prompt's 80.
 */
export const COOK_QUESTION_MAX_WORDS = { answer: 100, offTopic: 50 }

/** The prompt's "never more than 4" sentences (HON-1003). */
export const COOK_QUESTION_MAX_SENTENCES = 4

/**
 * An imperial unit right after a number: "350°F", "350F", "400 degrees
 * Fahrenheit", "2 cups", "8 oz", "a 12-inch pan". Anchored on the number, so "pound the chicken" and "a cup
 * of tea" never match, and "200 degrees" alone is read as Celsius.
 */
const IMPERIAL_UNIT =
  /\d\s*(?:°\s*f\b|f\b|degrees?\s+f(?:ahrenheit)?\b|fahrenheit|cups?\b|oz\b|ounces?\b|lbs?\b|pounds?\b|-?inch(?:es)?\b|fl\.?\s*oz)/iu

const wordCount = (text: string) => text.split(/\s+/u).filter(Boolean).length

/**
 * Sentences in a plain-text answer: a run of text ended by `.`, `!`, `?` or
 * `…` before whitespace and a capital letter or a digit, or by a line break,
 * so a second paragraph or a list line counts too. A decimal ("2.5 cm") or
 * "°C." mid-text does not split, since no whitespace follows the point. An
 * Estonian ordinal ("3. ja 4. sammus", "in steps 3 and 4") or an abbreviation
 * ("e.g. oat milk") does not split either, because a lowercase word follows.
 * Exported for tests.
 */
export function sentenceCount(text: string): number {
  return text
    .split(/(?<=[.!?…])\s+(?=[\p{Lu}\p{N}])|\n+/u)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length
}

/**
 * The model's notes to itself. One Estonian answer streamed a draft, then
 * "Let me fix this: the draft mentions a tool claim, which is not allowed.
 * Final answer:" and a second answer (HON-1506). Case-insensitive, and each
 * starts a word, so "potilet mee" does not match "let me". An English marker
 * also ends one, so "Let meat rest" does not either; an Estonian stem inflects
 * ("mustandis", "lõpliku vastuse"), so it matches as a prefix.
 */
const META_WORDS = ['final answer', 'draft', 'let me', 'the rules', 'not allowed']
const META_STEMS = ['lõplik\\p{L}* vastus', 'mustand']

const META_TEXT = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:(?:${META_WORDS.join('|')})(?![\\p{L}\\p{N}])|${META_STEMS.join('|')})`,
  'iu',
)

/**
 * Scores the plain-text answer. `answered` is always 1 here: an empty or
 * truncated answer is an error before it reaches the scorer, as production
 * shows the cook an error for it.
 */
export function scoreCookQuestion(input: CookQuestionCase, output: string): Scores {
  const {
    offTopic,
    mentionsAny,
    forbiddenKeywords,
    allowedQualifiers,
    forbiddenClaims,
    allowedClaimQualifiers,
    omitsAll,
  } = input.expected
  const text = normalizeFoodName(output)
  const words = wordCount(output)
  const noForbidden =
    findUnexcusedKeyword(
      text,
      (forbiddenKeywords ?? []).map(normalizeFoodName),
      (allowedQualifiers ?? []).map(normalizeFoodName),
    ) === null
  return {
    answered: 1,
    metricUnits: pass(!IMPERIAL_UNIT.test(output)),
    noMetaText: pass(!META_TEXT.test(output)),
    withinLength: offTopic ? null : pass(words <= COOK_QUESTION_MAX_WORDS.answer),
    withinSentences: offTopic ? null : pass(sentenceCount(output) <= COOK_QUESTION_MAX_SENTENCES),
    // An off-topic case's keywords are the answer to its question, not a
    // food, so they count here and stay out of the allergen safety check.
    offTopicDeclined: offTopic
      ? pass(words <= COOK_QUESTION_MAX_WORDS.offTopic && noForbidden)
      : null,
    avoidsForbidden: forbiddenKeywords && !offTopic ? pass(noForbidden) : null,
    avoidsClaims: forbiddenClaims
      ? pass(
          findUnexcusedKeyword(
            text,
            forbiddenClaims.map(normalizeFoodName),
            (allowedClaimQualifiers ?? []).map(normalizeFoodName),
          ) === null,
        )
      : null,
    mentionsExpected: mentionsAny
      ? pass(mentionsAny.some((phrase) => text.includes(normalizeFoodName(phrase))))
      : null,
    // The name's ingredient the household left out stays out (HON-1254).
    omitsLeftOut: omitsAll
      ? pass(omitsAll.every((name) => !text.includes(normalizeFoodName(name))))
      : null,
  }
}

export const cookQuestion: TaskSpec<'cook-question'> = {
  productionModel: COOK_QUESTION_MODEL,
  budgetMs: COOK_QUESTION_AI_BUDGET_MS,
  budgetLabel: 'COOK_QUESTION_AI_BUDGET_MS',
  // The request's 2000-token ceiling, which thinking shares; English answers
  // measured about 200 with no thinking (HON-972, HON-1490).
  dryRunOutputTokens: 2_000,
  metrics: [
    {
      key: 'answered',
      label: 'Answered without error',
      format: 'percent',
      onError: 0,
      gate: { min: 1 },
    },
    {
      key: 'metricUnits',
      label: 'Metric units only',
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'withinLength',
      label: `≤ ${COOK_QUESTION_MAX_WORDS.answer} words`,
      format: 'percent',
      onError: null,
      // The length is a prompt instruction nothing enforces, as the tips
      // counts are (HON-929): one long answer must not fail the record.
      gate: { min: 0.9 },
    },
    {
      key: 'withinSentences',
      label: `≤ ${COOK_QUESTION_MAX_SENTENCES} sentences`,
      format: 'percent',
      onError: null,
      // As the word ceiling: a prompt instruction, so one fifth sentence must
      // not fail the record (HON-1003).
      gate: { min: 0.9 },
    },
    {
      key: 'offTopicDeclined',
      label: `Off-topic declined (≤ ${COOK_QUESTION_MAX_WORDS.offTopic} words)`,
      format: 'percent',
      onError: null,
      gate: { min: 1 },
    },
    {
      key: 'avoidsForbidden',
      label: 'No forbidden suggestion',
      format: 'percent',
      // As imagine's forbidden-ingredient check: a failed call suggested
      // nothing, and `answered` already counts the failure.
      onError: null,
      regressionDrop: 0,
      safety: true,
      gate: { min: 1 },
    },
    {
      key: 'avoidsClaims',
      label: 'No unbacked claim',
      format: 'percent',
      onError: null,
      // A claim about what the cook owns, or calling the cook "the household",
      // is wrong but not unsafe, so it is no safety check, and one slip must not
      // fail the record (HON-1135, HON-1372, HON-1376, HON-1506). Five cases set
      // it up, so 3 runs give 15 scores: 0.85 passes two slips in 15 and fails three.
      gate: { min: 0.85 },
    },
    {
      key: 'noMetaText',
      label: 'No draft or note to itself',
      format: 'percent',
      onError: null,
      // The cook reads every streamed word, so one draft, or one note about the
      // rules, is the bug the check exists for (HON-1506).
      gate: { min: 1 },
    },
    {
      key: 'mentionsExpected',
      label: 'Names the expected answer',
      format: 'percent',
      onError: null,
      gate: { min: 0.9 },
    },
    {
      key: 'omitsLeftOut',
      label: "Leaves out what the changed list doesn't have",
      format: 'percent',
      onError: null,
      // As the tips gate: one mention is the bug the check exists for (HON-1254).
      gate: { min: 1 },
    },
  ],
  prepare({ input }) {
    const request = buildCookQuestionRequest({
      mealName: input.mealName,
      servings: input.servings,
      timeMinutes: input.timeMinutes,
      components: input.components,
      preparationNotes: input.preparationNotes,
      steps: input.steps,
      equipment: input.equipment,
      subject: input.subject,
      pitfalls: input.pitfalls,
      tip: input.tip,
      pantry: input.pantry,
      restrictions: input.restrictions,
      question: input.question,
      hasChanges: input.hasChanges,
      previous: input.previous,
      locale: input.locale,
    })
    return {
      // Plain text: no output schema instructs the model.
      promptText: textOf(request),
      schemaText: '',
      async generate(model) {
        // `generateText` returns the text `streamText` streams in production;
        // timed around the call, the latency is the time to the last word,
        // which is what the route's budget bounds.
        const result = await generateText({ ...request, model })
        // Production ends the stream in an error on a cut-off answer, so the
        // cook sees half an instruction and Retry. Thrown as the error class
        // the runner reads usage from, so the billed call still counts.
        if (result.finishReason === 'length' || !result.text.trim()) {
          throw new NoObjectGeneratedError({
            message:
              result.finishReason === 'length'
                ? 'Cook question answer was cut off at maxOutputTokens'
                : 'Cook question returned no text',
            text: result.text,
            response: result.response,
            usage: result.usage,
            finishReason: result.finishReason,
          })
        }
        return { object: result.text, usage: result.usage, finishReason: result.finishReason }
      },
      score: (object) => scoreCookQuestion(input, object as string),
    }
  },
}
