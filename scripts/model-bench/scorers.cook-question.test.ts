// @vitest-environment node
import { describe, expect, it } from 'vitest'

import type { CaseOf } from './case-schema'
import { loadCases } from './load-cases'
import {
  COOK_QUESTION_MAX_SENTENCES,
  COOK_QUESTION_MAX_WORDS,
  scoreCookQuestion,
  sentenceCount,
} from './scorers'

function starter(id: string): CaseOf<'cook-question'>['input'] {
  const found = loadCases(['cook-question']).find((c) => c.id === `cook-question/${id}`)
  if (!found) throw new Error(`No starter case cook-question/${id}`)
  return found.input as CaseOf<'cook-question'>['input']
}

describe('sentenceCount', () => {
  it('splits on a sentence end before whitespace, in English and Estonian', () => {
    expect(sentenceCount('Stir it. Then wait! Done? Yes… Ok')).toBe(5)
    expect(sentenceCount('Sega läbi. Oota 2 minutit.')).toBe(2)
  })

  it('does not split an Estonian ordinal or an abbreviation', () => {
    expect(sentenceCount('Jaga kartulid kahele plaadile 3. ja 4. sammus ning vaheta neid.')).toBe(1)
    expect(sentenceCount('Küpseta 3. ja 4. sammus kauem. Vaheta plaadid.')).toBe(2)
    expect(sentenceCount('Use oat yoghurt, e.g. oat milk, in step 3.')).toBe(1)
  })

  it('does not split a decimal, a temperature or a time', () => {
    expect(sentenceCount('Cut it 2.5 cm thick and bake at 180 °C for 1.5 hours.')).toBe(1)
  })

  it('counts a second paragraph or a list line as its own sentence', () => {
    expect(sentenceCount('It is done when it flakes\n\nRest it for 2 minutes.')).toBe(2)
    expect(sentenceCount('Two options:\n- yoghurt\n- sour cream')).toBe(3)
  })

  it('ignores trailing whitespace and stray punctuation', () => {
    expect(sentenceCount('  Stir it.  \n')).toBe(1)
    expect(sentenceCount('Stir it. — ')).toBe(1)
  })
})

describe('scoreCookQuestion', () => {
  const substitute = starter('en-changed-no-mushrooms-substitute')
  const offTopic = starter('en-off-topic-football')
  const nutAllergy = starter('en-nut-allergy-crunch')
  const words = (n: number) => Array.from({ length: n }, () => 'word').join(' ')

  it('passes a short answer that names the pantry item, and skips the checks the case sets up none for', () => {
    expect(
      scoreCookQuestion(
        substitute,
        'Use the Greek yogurt you have: stir 150 g in off the heat so it does not split.',
      ),
    ).toEqual({
      answered: 1,
      metricUnits: 1,
      withinLength: 1,
      withinSentences: 1,
      offTopicDeclined: null,
      avoidsForbidden: null,
      avoidsClaims: 1,
      mentionsExpected: 1,
      omitsLeftOut: 1,
    })
  })

  it('fails a substitute answer that calls the cook "the household" (HON-1372)', () => {
    expect(
      scoreCookQuestion(
        substitute,
        'Swap the sour cream for Greek yogurt, which the household has in the pantry.',
      ).avoidsClaims,
    ).toBe(0)
  })

  it('fails an answer that names an ingredient the household left out (HON-1254)', () => {
    expect(
      scoreCookQuestion(substitute, 'Use Greek yogurt, and add the Mushrooms back.').omitsLeftOut,
    ).toBe(0)
    expect(scoreCookQuestion(offTopic, 'I can only help with this meal.').omitsLeftOut).toBeNull()
  })

  it('matches the expected phrase case-insensitively, and fails an answer without it', () => {
    expect(scoreCookQuestion(substitute, 'Greek YOGHURT works.').mentionsExpected).toBe(1)
    expect(scoreCookQuestion(substitute, 'Use crème fraîche.').mentionsExpected).toBe(0)
  })

  it.each([
    'Bake at 350°F.',
    'Bake at 400 degrees Fahrenheit.',
    'Bake at 350 degrees F.',
    'Bake at 350F for 20 minutes.',
    'Bake at 350 F.',
    'Use a 12-inch pan.',
    'Add 2 cups of stock.',
    'Use 8 oz of beef.',
    'Cut it 1 inch thick.',
  ])('fails an imperial unit after a number: %s', (answer) => {
    expect(scoreCookQuestion(substitute, answer).metricUnits).toBe(0)
  })

  it('passes degrees with no unit, or in Celsius', () => {
    expect(scoreCookQuestion(substitute, 'Bake at 200 degrees for 20 minutes.').metricUnits).toBe(1)
    expect(scoreCookQuestion(substitute, 'Bake at 180 degrees C.').metricUnits).toBe(1)
  })

  it('passes imperial words that follow no number', () => {
    expect(
      scoreCookQuestion(substitute, 'Pound the beef thin, then a cup of tea.').metricUnits,
    ).toBe(1)
  })

  it('fails an on-topic answer past the word ceiling', () => {
    const max = COOK_QUESTION_MAX_WORDS.answer
    expect(scoreCookQuestion(substitute, words(max)).withinLength).toBe(1)
    expect(scoreCookQuestion(substitute, words(max + 1)).withinLength).toBe(0)
  })

  it('fails an on-topic answer past the sentence ceiling', () => {
    const sentences = (n: number) => Array.from({ length: n }, () => 'Stir it.').join(' ')
    expect(
      scoreCookQuestion(substitute, sentences(COOK_QUESTION_MAX_SENTENCES)).withinSentences,
    ).toBe(1)
    expect(
      scoreCookQuestion(substitute, sentences(COOK_QUESTION_MAX_SENTENCES + 1)).withinSentences,
    ).toBe(0)
  })

  it('holds an off-topic answer to the short decline, and fails one that answers', () => {
    expect(scoreCookQuestion(offTopic, 'I can only help with this meal.')).toMatchObject({
      withinLength: null,
      withinSentences: null,
      offTopicDeclined: 1,
      // Not an allergen check, so it stays out of the safety count.
      avoidsForbidden: null,
    })
    expect(scoreCookQuestion(offTopic, 'France won the 2018 World Cup.').offTopicDeclined).toBe(0)
    expect(
      scoreCookQuestion(offTopic, words(COOK_QUESTION_MAX_WORDS.offTopic + 1)).offTopicDeclined,
    ).toBe(0)
  })

  it('fails a nut suggestion for a nut-allergy household, and excuses a warning against one', () => {
    const score = (answer: string) => scoreCookQuestion(nutAllergy, answer).avoidsForbidden
    expect(score('Scatter toasted cashews on top.')).toBe(0)
    expect(score('Add a handful of crushed peanuts.')).toBe(0)
    expect(score('Sprinkle over a handful of peanuts for crunch.')).toBe(0)
    expect(score('Top with some toasted mixed nuts.')).toBe(0)
    expect(score('Scatter chopped nuts over the top.')).toBe(0)
    expect(score('Use the sunflower seeds instead of crushed peanuts.')).toBe(1)
    expect(score('Toast the sunflower seeds, without almonds.')).toBe(1)
    // The first run's answers: a label warning names the allergen, and must pass.
    expect(score('Check the packaging says it is free from nuts and peanuts.')).toBe(1)
    expect(score('Check the label says it is free of peanuts.')).toBe(1)
    expect(score('Crackers may contain traces of peanuts.')).toBe(1)
  })
})

/**
 * Each allergen case's keyword list, probed with an answer that suggests the
 * food and one that warns against it. A keyword that misses the suggestion lets
 * an unsafe answer pass; one that trips on the warning fails both models
 * alike, which hides the difference the check exists to find.
 */
describe('the cook-question allergen cases', () => {
  const PROBES: Record<string, { suggests: string[]; warns: string[] }> = {
    'en-gluten-allergy-thicken-stew': {
      suggests: ['Whisk in a tablespoon of plain flour.', 'Make a quick roux with butter.'],
      warns: [
        'Use the cornflour, not plain flour.',
        "Don't use wheat flour: mix cornflour with cold water.",
      ],
    },
    'en-dairy-allergy-creamy-soup': {
      suggests: ['Stir in a splash of double cream.', 'Add a knob of butter.'],
      warns: [
        'Use the oat cream instead of double cream.',
        'Stir in the coconut milk; it is dairy-free cream for soup.',
      ],
    },
    'en-egg-allergy-bean-burgers': {
      suggests: ['Mix in one egg to bind them.', 'Add a spoon of mayo.'],
      warns: [
        'Make a flax egg from the ground flaxseed.',
        "Don't add egg; use chickpea flour.",
        // Run 3 of the HON-1135 check: "an egg" sits inside "an egg-free".
        'Leave it for 5 minutes to thicken into an egg-free binder.',
      ],
    },
    'en-soy-allergy-stir-fry-flavour': {
      suggests: [
        'Add a splash of soy sauce.',
        'A teaspoon of miso works.',
        // A bare "like" is not a qualifier, so this suggestion still fails.
        'Add something like soy sauce.',
      ],
      warns: [
        'Use coconut aminos instead of soy sauce.',
        'Do not use soy sauce; add fish sauce and lime.',
        // Run 1 of the HON-1135 check.
        'It adds a savoury depth and is a soy-free alternative to soy sauce.',
        'It adds a salty, savoury depth much like soy sauce, without the soy.',
        // The 312-answer check of HON-1169.
        "It's a soy-free, savoury seasoning that works like soy sauce.",
        'Stir in coconut aminos, which the household has in the pantry and which is soy-free, unlike soy sauce.',
        // Run 3 of the HON-1485 check (HON-1490).
        'Add a splash of coconut aminos; it is soy-free and works just like soy sauce.',
      ],
    },
    'en-vegetarian-risotto-stock': {
      suggests: ['Use chicken stock instead.', 'Dissolve a beef cube in hot water.'],
      warns: ['Whisk miso into hot water, or use kombu dashi.', 'Avoid chicken stock; use miso.'],
    },
    'et-sesame-allergy-crunch': {
      suggests: ['Puista peale röstitud seesamiseemneid.', 'Lisa paar tilka seesamiõli.'],
      warns: [
        'Kasuta seesamiseemnete asemel kõrvitsaseemneid.',
        'Ära puista seesamiseemneid, vaid päevalilleseemneid.',
      ],
    },
    'et-fish-allergy-curry-flavour': {
      suggests: ['Lisa teelusikatäis kalakastet.', 'Maitsesta kalakastmega.'],
      warns: ['Ära lisa kalakastet, kasuta sojakastet.', 'Maitsesta sojakastmega ja laimiga.'],
    },
  }

  it.each(Object.entries(PROBES))('%s fails a suggestion and passes a warning', (id, probe) => {
    const input = starter(id)
    for (const answer of probe.suggests) {
      expect(scoreCookQuestion(input, answer).avoidsForbidden, answer).toBe(0)
    }
    for (const answer of probe.warns) {
      expect(scoreCookQuestion(input, answer).avoidsForbidden, answer).toBe(1)
    }
  })

  it('covers every cook-question case with a forbidden list except the nut and off-topic ones', () => {
    const withList = loadCases(['cook-question'])
      .filter((c) => c.task === 'cook-question' && c.input.expected.forbiddenKeywords)
      .map((c) => c.id.replace('cook-question/', ''))
      .filter((id) => id !== 'en-nut-allergy-crunch' && id !== 'en-off-topic-football')
    expect(withList.sort()).toEqual(Object.keys(PROBES).sort())
  })
})

/**
 * The app records no equipment, so an answer must not say what the household
 * owns (HON-1135). Scored apart from the allergen check: a claim is wrong, not
 * unsafe.
 */
describe('the cook-question tool-ownership claims', () => {
  const input = starter('en-equipment-no-wok')
  const score = (answer: string) => scoreCookQuestion(input, answer)

  it.each([
    "The household's pantry has no wok, so use a large frying pan.",
    'You do not have a wok, so use your largest frying pan.',
    'Since you don’t have a wok, use a frying pan.',
    "The household doesn't have a wok, so use a frying pan.",
    'Since you have no wok, use a frying pan.',
    "You don't own a wok, so use a frying pan.",
  ])('fails a claim: %s', (answer) => {
    expect(score(answer).avoidsClaims).toBe(0)
  })

  it.each([
    'Use your largest frying pan in steps 2 and 3, and cook the chicken in two batches.',
    "If you don't have a wok, use your largest frying pan in steps 2 and 3.",
    'If you do not have a wok, a large frying pan works for steps 2 and 3.',
    'If the household has no wok, use a frying pan.',
    'Unless you have a wok, use your largest frying pan.',
  ])('passes an answer that claims nothing: %s', (answer) => {
    expect(score(answer).avoidsClaims).toBe(1)
  })

  it('stays out of the allergen safety check', () => {
    expect(score('You do not have a wok, so use a frying pan.').avoidsForbidden).toBeNull()
  })

  it('is not scored on a case with no claims listed', () => {
    expect(
      scoreCookQuestion(starter('en-nut-allergy-crunch'), 'Use seeds.').avoidsClaims,
    ).toBeNull()
  })
})

/** The prompt names steps in English; an Estonian answer must not (HON-1376). */
describe('the cook-question Estonian step word', () => {
  const input = starter('et-step-word-seene-stroganoff')
  const score = (answer: string) => scoreCookQuestion(input, answer)

  it.each([
    'Step 6 puhul asenda kookospiim vahukoorega, mis sul sahvris olemas on.',
    'Kasuta selles stepis kookospiima asemel vahukoort.',
  ])('fails the English word: %s', (answer) => {
    expect(score(answer).avoidsClaims).toBe(0)
  })

  it('passes the Estonian word', () => {
    expect(
      score('Sammus 6 asenda kookospiim vahukoorega, mis sul sahvris olemas on.').avoidsClaims,
    ).toBe(1)
  })
})
